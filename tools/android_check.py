#!/usr/bin/env python3
"""Emulator check of the Android app, run by .github/workflows/android-check.yml
while an emulator is up: installs dist/apk/heelstomp.apk (built with
APK_WEB_DEBUG=true), starts it, plays a little through adb, looks into the
page over the WebView's DevTools socket and writes report.json, screenshots
(sheet.jpg) and the app's log to --out. Exits 1 if a check failed.

Needs: adb on PATH, pip packages websocket-client and pillow.
"""
import argparse
import io
import json
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import websocket
from PIL import Image

PKG = 'com.heelstomp.app'
ACTIVITY = PKG + '/.MainActivity'
ORIGIN = 'https://appassets.androidplatform.net'


def adb(*args, check=True, binary=False, timeout=120):
    r = subprocess.run(['adb', *args], capture_output=True, timeout=timeout)
    if check and r.returncode != 0:
        raise RuntimeError(f"adb {' '.join(args)} failed: {r.stderr.decode(errors='replace')}")
    return r.stdout if binary else r.stdout.decode(errors='replace')


class Page:
    """Runtime.evaluate on the game's page through the WebView DevTools socket."""

    def __init__(self):
        self.ws = None
        self.n = 0

    def connect(self, timeout=60):
        if self.ws:
            try:
                self.ws.close()
            except Exception:
                pass
            self.ws = None
        end = time.time() + timeout
        last = None
        while time.time() < end:
            socks = re.findall(r'@(webview_devtools_remote_\d+)', adb('shell', 'cat', '/proc/net/unix', check=False))
            if socks:
                adb('forward', 'tcp:9222', 'localabstract:' + socks[-1], check=False)
                try:
                    pages = json.load(urllib.request.urlopen('http://127.0.0.1:9222/json', timeout=5))
                    for p in pages:
                        if p.get('url', '').startswith(ORIGIN) and p.get('webSocketDebuggerUrl'):
                            self.ws = websocket.create_connection(
                                p['webSocketDebuggerUrl'], timeout=30, suppress_origin=True)
                            return
                except Exception as e:  # socket not ready yet
                    last = e
            time.sleep(1)
        raise RuntimeError(f'no DevTools page for the game ({last})')

    def eval(self, expr):
        self.n += 1
        self.ws.send(json.dumps({'id': self.n, 'method': 'Runtime.evaluate', 'params': {
            'expression': expr, 'returnByValue': True, 'awaitPromise': True}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get('id') == self.n:
                res = msg.get('result', {})
                if 'exceptionDetails' in res:
                    raise RuntimeError(json.dumps(res['exceptionDetails'])[:400])
                return res.get('result', {}).get('value')

    def wait(self, expr, timeout=20):
        end = time.time() + timeout
        while time.time() < end:
            try:
                if self.eval(expr):
                    return True
            except Exception:
                pass
            time.sleep(0.3)
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apk', default='dist/apk/heelstomp.apk')
    ap.add_argument('--out', default='android-check')
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    results = []
    info = {}
    shots = []

    def check(name, ok, detail=''):
        results.append({'check': name, 'ok': bool(ok), 'detail': detail})
        print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail else ''), flush=True)

    def shot(label):
        png = adb('exec-out', 'screencap', '-p', binary=True)
        (out / f'{len(shots)}_{label}.png').write_bytes(png)
        shots.append((label, png))

    def tap_css(page, x, y):
        dpr = page.eval('devicePixelRatio')
        adb('shell', 'input', 'tap', str(round(x * dpr)), str(round(y * dpr)))

    def tap_el(page, sel):
        r = page.eval(f"(() => {{ const b = document.querySelector('{sel}').getBoundingClientRect();"
                      " return [b.left + b.width / 2, b.top + b.height / 2]; }})()")
        tap_css(page, *r)

    info['device'] = {k: adb('shell', 'getprop', p).strip() for k, p in
                      [('android', 'ro.build.version.release'), ('sdk', 'ro.build.version.sdk'),
                       ('model', 'ro.product.model')]}
    info['display'] = adb('shell', 'wm', 'size').strip() + ' / ' + adb('shell', 'wm', 'density').strip()
    adb('install', '-r', args.apk, timeout=300)
    adb('logcat', '-c', check=False)
    adb('shell', 'am', 'start', '-W', '-n', ACTIVITY)
    page = Page()
    page.connect()

    # ---- starts and shows the menu, landscape, full screen
    booted = page.wait("!!(window.__game && !document.getElementById('menu').hidden)", 30)
    check('game boots to the main menu', booted)
    env = page.eval("""(() => ({
        ua: navigator.userAgent, w: innerWidth, h: innerHeight, dpr: devicePixelRatio,
        landscape: matchMedia('(orientation: landscape)').matches,
        rotateShown: getComputedStyle(document.getElementById('rotate')).display !== 'none',
        fsHidden: document.getElementById('btn-fs').hidden,
        vibrate: typeof navigator.vibrate,
        storage: (() => { try { localStorage.setItem('k', '1'); return localStorage.getItem('k') === '1'; } catch (e) { return false; } })(),
        audio: typeof (window.AudioContext || window.webkitAudioContext),
        loadMsg: document.getElementById('load-msg').textContent,
    }))()""")
    info['page'] = env
    print('page:', json.dumps(env, ensure_ascii=False), flush=True)
    check('landscape, no rotate-the-phone screen', env['landscape'] and not env['rotateShown'])
    check('fullscreen button hidden in the app', env['fsHidden'])
    check('localStorage works', env['storage'])
    check('navigator.vibrate available', env['vibrate'] == 'function')
    chrome = re.search(r'Chrome/(\d+)', env['ua'])
    info['webview'] = int(chrome.group(1)) if chrome else None
    disp = re.findall(r'(\d+)x(\d+)', info['display'])
    if disp:
        long_side = max(int(disp[-1][0]), int(disp[-1][1]))
        covered = env['w'] * env['dpr'] / long_side
        check('page covers the whole screen width', covered > 0.98, f'{covered:.3f} of {long_side}px')
    time.sleep(1)
    shot('menu')

    # ---- a round: tap 60 秒挑战, stomp a few times
    tap_el(page, '#btn-timed')
    check('tap starts a round', page.wait("window.__game.state === 'play'", 8))
    page.eval("""(() => { const o = navigator.vibrate.bind(navigator); window.__vib = [];
        navigator.vibrate = (p) => { const r = o(p); window.__vib.push([p, r]); return r; }; })()""")
    for i in range(4):
        # aim at a live ant on the street; hold to charge, release to stomp
        pos = page.eval("""(() => { const g = window.__game;
            // clear of the planted boot (a press there grinds instead)
            const a = g.swarm.ants.filter((a) => a.x > 120 && a.x < g.W - 120 && Math.abs(a.x - g.foot.x) > g.soleLen)
              .sort((p, q) => Math.abs(p.x - g.W / 2) - Math.abs(q.x - g.W / 2))[0];
            const x = a ? a.x : g.W / 2, y = a ? a.y : (g.bandTop + g.bandBot) / 2;
            return [x * g.scale + g.offX, y * g.scale + g.offY]; })()""")
        dpr = env['dpr']
        x, y = str(round(pos[0] * dpr)), str(round(pos[1] * dpr))
        adb('shell', 'input', 'swipe', x, y, x, y, '650')
        time.sleep(0.9)
    sess = page.eval('JSON.parse(JSON.stringify(window.__game.session))')
    vib = page.eval('window.__vib')
    info['session'] = sess
    info['vibrate_calls'] = vib[:12]
    check('touch stomps register', sess.get('stomps', 0) >= 3, f"stomps {sess.get('stomps')} kills {sess.get('kills')}")
    check('vibration accepted by the WebView', any(r for _, r in vib), f'{len(vib)} calls')
    shot('play')

    # ---- back button: pause / resume / menu
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
    check('back pauses the round', page.wait("window.__game.state === 'pause'", 5))
    time.sleep(0.6)
    shot('back_pause')
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
    check('back again resumes', page.wait("window.__game.state === 'play'", 5))

    # ---- home and back: the round pauses, nothing reloads
    page.eval('window.__marker = 42')
    adb('shell', 'input', 'keyevent', 'KEYCODE_HOME')
    time.sleep(2)
    hidden = page.eval("({hidden: document.hidden, state: window.__game.state})")
    check('in the background: page hidden, round paused', hidden['hidden'] and hidden['state'] == 'pause', json.dumps(hidden))
    adb('shell', 'am', 'start', '-W', '-n', ACTIVITY)
    time.sleep(1.5)
    back = page.eval("({hidden: document.hidden, state: window.__game.state, marker: window.__marker})")
    check('back in front: same page, still paused', not back['hidden'] and back['state'] == 'pause' and back['marker'] == 42, json.dumps(back))

    # ---- main menu: back sends the app to the background
    tap_el(page, '#btn-menu')
    page.wait("window.__game.state === 'menu'", 5)
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
    time.sleep(1.5)
    focus = adb('shell', 'dumpsys', 'window', check=False)
    m = re.search(r'mCurrentFocus=.*', focus)
    check('back on the main menu leaves the app', m is not None and PKG not in m.group(0), m.group(0) if m else '')
    adb('shell', 'am', 'start', '-W', '-n', ACTIVITY)
    time.sleep(1)

    # ---- a camera cutout: the page gets its insets
    overlays = adb('shell', 'cmd', 'overlay', 'list', check=False)
    cut = [o for o in re.findall(r'(com\.android\.internal\.display\.cutout\.emulation\.\w+)', overlays)]
    pick = next((o for k in ('hole', 'punch', 'corner', 'tall', 'double') for o in cut if k in o), None)
    if pick:
        adb('shell', 'cmd', 'overlay', 'enable', pick, check=False)
        time.sleep(4)
        page.connect()
        page.wait("!!(window.__game && document.readyState === 'complete')", 20)
        time.sleep(1)
        ins = page.eval("""(() => { const cs = getComputedStyle(document.documentElement);
            const v = (n) => cs.getPropertyValue(n).trim();
            return { app: [v('--app-inset-top'), v('--app-inset-right'), v('--app-inset-bottom'), v('--app-inset-left')],
                     safe: window.__game.safe, menuPad: getComputedStyle(document.getElementById('menu')).paddingLeft + ' / ' + getComputedStyle(document.getElementById('menu')).paddingRight }; })()""")
        info['cutout'] = {'overlay': pick, **ins}
        side = max(ins['safe']['l'], ins['safe']['r'])
        check('camera cutout: the game keeps clear of it', side > 0, json.dumps(ins))
        shot('cutout')
        adb('shell', 'cmd', 'overlay', 'disable', pick, check=False)
    else:
        info['cutout'] = 'no cutout overlay on this image'

    # ---- the app's log
    log = adb('logcat', '-d', '-v', 'brief', check=False)
    (out / 'logcat.txt').write_text(log)
    mine = [ln for ln in log.splitlines() if 'HeelStomp' in ln or 'chromium' in ln or 'AndroidRuntime' in ln]
    (out / 'app-log.txt').write_text('\n'.join(mine))
    errors = [ln for ln in mine if 'console ERROR' in ln or 'Uncaught' in ln or 'FATAL' in ln]
    check('no errors in the app log', not errors, ' | '.join(errors[:5]))
    vibs = adb('shell', 'dumpsys', 'vibrator_manager', check=False)
    if not vibs.strip() or "Can't find service" in vibs:
        vibs = adb('shell', 'dumpsys', 'vibrator', check=False)
    (out / 'vibrator.txt').write_text(vibs)
    info['vibrator_mentions_app'] = PKG in vibs

    # ---- sheet of screenshots (small) for a quick look
    thumbs = []
    for label, png in shots:
        im = Image.open(io.BytesIO(png)).convert('RGB')
        im.thumbnail((640, 640))
        thumbs.append(im)
    if thumbs:
        w = max(t.width for t in thumbs)
        sheet = Image.new('RGB', (w, sum(t.height for t in thumbs) + 6 * len(thumbs)), (255, 255, 255))
        yy = 0
        for t in thumbs:
            sheet.paste(t, (0, yy))
            yy += t.height + 6
        sheet.save(out / 'sheet.jpg', quality=80)

    report = {'info': info, 'results': results}
    (out / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1))
    failed = [r['check'] for r in results if not r['ok']]
    print('SUMMARY', json.dumps({'webview': info.get('webview'), 'android': info['device'], 'failed': failed}, ensure_ascii=False))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
