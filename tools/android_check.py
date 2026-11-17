#!/usr/bin/env python3
"""Emulator check of the Android app, run by .github/workflows/android-check.yml
while an emulator is up: installs dist/apk/heelstomp.apk (built with
APK_WEB_DEBUG=true), starts it, plays a little through adb, looks into the
page over the WebView's DevTools socket and checks the screen itself
(screenshots: does it show the menu, does it move during a round). With
--update-url (the app built as version 1 with that update source) it also
checks the "new version" dialog. Writes report.json, the screenshots (and
sheet.jpg) and the app's log to --out. Exits 1 if a check failed.

Needs: adb on PATH, pip packages websocket-client and pillow.
"""
import argparse
import io
import json
import re
import subprocess
import sys
import time
import traceback
import urllib.request
from pathlib import Path

import websocket
from PIL import Image, ImageChops

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


# frames the page draws per second (requestAnimationFrame), and its visibility
FPS_JS = """new Promise((done) => { let n = 0; const t0 = performance.now();
  const tick = () => { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
    else done({ fps: Math.round(n * 1000 / (performance.now() - t0)), vis: document.visibilityState }); };
  requestAnimationFrame(tick); setTimeout(() => done({ fps: 0, vis: document.visibilityState }), 4000); })"""


def pink_share(png):
    """Share of strongly pink pixels (the menu's buttons) in the middle of the screen."""
    im = Image.open(io.BytesIO(png)).convert('RGB')
    w, h = im.size
    im = im.crop((w // 4, h // 4, 3 * w // 4, 3 * h // 4)).resize((200, 100))
    px = list(im.getdata())
    return sum(1 for r, g, b in px if r > 200 and g < 120 and 50 < b < 170) / len(px)


def moved_share(a, b):
    """Share of pixels that changed between two screenshots."""
    ia = Image.open(io.BytesIO(a)).convert('L').resize((480, 216))
    ib = Image.open(io.BytesIO(b)).convert('L').resize((480, 216))
    diff = ImageChops.difference(ia, ib).point(lambda v: 255 if v > 24 else 0)
    return sum(1 for v in diff.getdata() if v) / (480 * 216)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apk', default='dist/apk/heelstomp.apk')
    ap.add_argument('--out', default='android-check')
    ap.add_argument('--update-url', default='', help='the APK_UPDATE_URL the app was built with (as version 1)')
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    results = []
    info = {}
    shots = []
    page = Page()

    def check(name, ok, detail=''):
        results.append({'check': name, 'ok': bool(ok), 'detail': detail})
        print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail else ''), flush=True)

    def section(name, fn):
        try:
            fn()
        except Exception as e:
            check(f'{name}: ran to the end', False, f'{type(e).__name__}: {e}'[:300])
            traceback.print_exc()

    def settle():
        """Two drawn frames and a moment more, so the screen shows the page as it is."""
        try:
            page.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))')
        except Exception:
            pass
        time.sleep(1.2)

    def shot(label):
        png = adb('exec-out', 'screencap', '-p', binary=True)
        (out / f'{len(shots)}_{label}.png').write_bytes(png)
        shots.append((label, png))
        return png

    def ui_nodes():
        """Texts on screen with the centre of their boxes (uiautomator), dialogs included."""
        adb('shell', 'rm', '-f', '/sdcard/ui.xml', check=False)
        adb('shell', 'uiautomator', 'dump', '/sdcard/ui.xml', check=False, timeout=60)
        xml = adb('shell', 'cat', '/sdcard/ui.xml', check=False)
        nodes = {}
        for m in re.finditer(r'text="([^"]+)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml):
            nodes[m.group(1)] = ((int(m.group(2)) + int(m.group(4))) // 2, (int(m.group(3)) + int(m.group(5))) // 2)
        return nodes

    def update_dialog(timeout):
        """The app's "new version" dialog, if it shows within timeout: its texts."""
        end = time.time() + timeout
        while True:
            nodes = ui_nodes()
            if '有新版本' in nodes:
                return nodes
            if time.time() >= end:
                return None
            time.sleep(1)

    def focused_window():
        m = re.search(r'mCurrentFocus=.*', adb('shell', 'dumpsys', 'window', check=False))
        return m.group(0) if m else ''

    def tap_css(x, y):
        dpr = page.eval('devicePixelRatio')
        adb('shell', 'input', 'tap', str(round(x * dpr)), str(round(y * dpr)))

    def tap_el(sel):
        r = page.eval("(() => { const b = document.querySelector(" + json.dumps(sel) + ").getBoundingClientRect();"
                      " return [b.left + b.width / 2, b.top + b.height / 2]; })()")
        tap_css(*r)

    try:
        info['device'] = {k: adb('shell', 'getprop', p).strip() for k, p in
                          [('android', 'ro.build.version.release'), ('sdk', 'ro.build.version.sdk'),
                           ('model', 'ro.product.model')]}
        info['display'] = adb('shell', 'wm', 'size').strip() + ' / ' + adb('shell', 'wm', 'density').strip()
        # the system's one-time "Viewing full screen / Got it" panel would cover
        # the game and hold its drawing; a real phone shows it once per app
        adb('shell', 'settings', 'put', 'secure', 'immersive_mode_confirmations', 'confirmed', check=False)
        adb('install', '-r', args.apk, timeout=300)
        adb('logcat', '-c', check=False)
        t0 = time.time()
        adb('shell', 'am', 'start', '-W', '-n', ACTIVITY)
        page.connect()

        # ---- built as version 1 with the live site as its update source: it
        # must offer the build that is there, and 以后再说 must put it away
        def update_offer():
            nodes = update_dialog(30)
            check('update dialog appears', nodes is not None)
            if not nodes:
                return
            msg = next((t for t in nodes if t.startswith('新版本')), '')
            check('update dialog names both versions', re.match(r'新版本 \d+（现在装的是 1）', msg) is not None, msg[:24])
            time.sleep(0.5)
            shot('update_dialog')
            line = re.search(r'update offered: (\d+) \(installed 1\) (\S+)', adb('logcat', '-d', '-s', 'HeelStomp:I', check=False))
            url = line.group(2) if line else ''
            info['update'] = {'offered': line.group(1) if line else None, 'url': url}
            ok = False
            detail = url
            if url.startswith(args.update_url + 'heelstomp.apk?v='):
                try:
                    req = urllib.request.Request(url, method='HEAD')
                    with urllib.request.urlopen(req, timeout=30) as r:
                        detail = f"{url} -> {r.status} {r.headers.get('Content-Type')} {r.headers.get('Content-Length')} bytes"
                        ok = r.status == 200 and 'android' in (r.headers.get('Content-Type') or '')
                except Exception as e:
                    detail = f'{url} -> {e}'
            check('its download link is the APK on the site', ok, detail)
            adb('shell', 'input', 'tap', *map(str, nodes['以后再说']))
            time.sleep(1.5)
            check('以后再说 closes it, back in the game', '有新版本' not in ui_nodes() and PKG in focused_window(), focused_window())

        if args.update_url:
            section('update', update_offer)

        # ---- starts and shows the menu, landscape, full screen
        def start():
            booted = page.wait("!!(window.__game && !document.getElementById('menu').hidden)", 40)
            info['boot_seconds'] = round(time.time() - t0, 1)
            check('game boots to the main menu', booted, f"{info['boot_seconds']} s after launch")
            env = page.eval("""(() => ({
                ua: navigator.userAgent, w: innerWidth, h: innerHeight, dpr: devicePixelRatio,
                landscape: matchMedia('(orientation: landscape)').matches,
                rotateShown: getComputedStyle(document.getElementById('rotate')).display !== 'none',
                fsHidden: document.getElementById('btn-fs').hidden,
                vibrate: typeof navigator.vibrate,
                storage: (() => { try { localStorage.setItem('k', '1'); return localStorage.getItem('k') === '1'; } catch (e) { return false; } })(),
                audio: typeof (window.AudioContext || window.webkitAudioContext),
                vis: document.visibilityState,
            }))()""")
            info['page'] = env
            print('page:', json.dumps(env, ensure_ascii=False), flush=True)
            chrome = re.search(r'Chrome/(\d+)', env['ua'])
            info['webview'] = int(chrome.group(1)) if chrome else None
            check('page visible', env['vis'] == 'visible', env['vis'])
            check('landscape, no rotate-the-phone screen', env['landscape'] and not env['rotateShown'])
            check('fullscreen button hidden in the app', env['fsHidden'])
            check('localStorage works', env['storage'])
            check('navigator.vibrate available', env['vibrate'] == 'function')
            disp = re.findall(r'(\d+)x(\d+)', info['display'])
            if disp:
                long_side = max(int(disp[-1][0]), int(disp[-1][1]))
                covered = env['w'] * env['dpr'] / long_side
                check('page covers the whole screen width', covered > 0.98, f'{covered:.3f} of {long_side}px')
            gap = page.eval("""(() => { const a = document.getElementById('btn-timed').getBoundingClientRect(),
                b = document.getElementById('btn-endless').getBoundingClientRect();
                return Math.round(Math.max(b.left - a.right, b.top - a.bottom)); })()""")
            check('space between the two play buttons', gap >= 8, f'{gap} px')
            fps = page.eval(FPS_JS)
            info['menu_fps'] = fps
            # emulators draw in software (a few frames a second); 0 means drawing stopped
            check('page keeps drawing on the menu', fps['fps'] >= 1, json.dumps(fps))
            settle()
            png = shot('menu')
            share = pink_share(png)
            check('the screen shows the menu (its pink buttons)', share > 0.01, f'pink share {share:.3f}')

        section('start', start)

        # ---- a round: tap 60 秒挑战, stomp a few times; the screen must move
        def play():
            tap_el('#btn-timed')
            check('tap starts a round', page.wait("window.__game.state === 'play'", 8))
            page.eval("""(() => { const o = navigator.vibrate.bind(navigator); window.__vib = [];
                navigator.vibrate = (p) => { const r = o(p); window.__vib.push([p, r]); return r; }; })()""")
            fps = page.eval(FPS_JS)
            info['play_fps'] = fps
            check('page keeps drawing in a round', fps['fps'] >= 1, json.dumps(fps))
            a = shot('play_a')
            time.sleep(1.0)
            b = shot('play_b')
            moved = moved_share(a, b)
            check('the screen moves during a round', moved > 0.002, f'{moved:.4f} of the pixels changed in 1 s')
            dpr = page.eval('devicePixelRatio')
            for _ in range(4):
                # aim at a live ant on the street, clear of the planted boot (a
                # press there grinds); hold to charge, release to stomp
                pos = page.eval("""(() => { const g = window.__game;
                    const a = g.swarm.ants.filter((a) => a.x > 120 && a.x < g.W - 120 && Math.abs(a.x - g.foot.x) > g.soleLen)
                      .sort((p, q) => Math.abs(p.x - g.W / 2) - Math.abs(q.x - g.W / 2))[0];
                    const x = a ? a.x : g.W / 2, y = a ? a.y : (g.bandTop + g.bandBot) / 2;
                    return [x * g.scale + g.offX, y * g.scale + g.offY]; })()""")
                x, y = str(round(pos[0] * dpr)), str(round(pos[1] * dpr))
                adb('shell', 'input', 'swipe', x, y, x, y, '650')
                time.sleep(0.9)
            sess = page.eval('JSON.parse(JSON.stringify(window.__game.session))')
            vib = page.eval('window.__vib')
            info['session'] = sess
            info['vibrate_calls'] = vib[:12]
            check('touch stomps register', sess.get('stomps', 0) >= 3, f"stomps {sess.get('stomps')} kills {sess.get('kills')}")
            check('vibration accepted by the WebView', any(r for _, r in vib), f'{len(vib)} calls')
            settle()
            shot('stomps')

        section('play', play)

        # ---- back button: pause / resume
        def back_key():
            adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
            check('back pauses the round', page.wait("window.__game.state === 'pause'", 5))
            settle()
            shot('back_pause')
            adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
            check('back again resumes', page.wait("window.__game.state === 'play'", 5))

        section('back', back_key)

        # ---- something covers the game (here the notification shade): the
        # round pauses, and stays paused until 继续
        def covered():
            adb('shell', 'cmd', 'statusbar', 'expand-notifications', check=False)
            paused = page.wait("window.__game.state === 'pause'", 6)
            check('covered by the notification shade: round paused', paused, focused_window())
            adb('shell', 'cmd', 'statusbar', 'collapse', check=False)
            time.sleep(1.5)
            still = page.eval("({hidden: document.hidden, state: window.__game.state})")
            check('shade closed: still paused, page visible', still['state'] == 'pause' and not still['hidden'], json.dumps(still))
            tap_el('#btn-resume')
            check('继续 resumes', page.wait("window.__game.state === 'play'", 5))

        section('covered', covered)

        # ---- home and back: the round pauses, nothing reloads
        def home():
            page.eval('window.__marker = 42')
            adb('shell', 'input', 'keyevent', 'KEYCODE_HOME')
            time.sleep(2)
            hidden = page.eval("({hidden: document.hidden, state: window.__game.state})")
            check('in the background: page hidden, round paused', hidden['hidden'] and hidden['state'] == 'pause', json.dumps(hidden))
            adb('shell', 'am', 'start', '-W', '-n', ACTIVITY)
            time.sleep(1.5)
            back = page.eval("({hidden: document.hidden, state: window.__game.state, marker: window.__marker})")
            check('back in front: same page, still paused', not back['hidden'] and back['state'] == 'pause' and back['marker'] == 42, json.dumps(back))

        section('home', home)

        # ---- main menu: back sends the app to the background
        def leave():
            tap_el('#btn-menu')
            page.wait("window.__game.state === 'menu'", 5)
            adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
            time.sleep(1.5)
            focus = adb('shell', 'dumpsys', 'window', check=False)
            m = re.search(r'mCurrentFocus=.*', focus)
            check('back on the main menu leaves the app', m is not None and PKG not in m.group(0), m.group(0) if m else '')
            adb('shell', 'am', 'start', '-W', '-n', ACTIVITY)
            time.sleep(1)

        section('leave', leave)

        # ---- a camera cutout: the page gets its insets
        def cutout():
            overlays = adb('shell', 'cmd', 'overlay', 'list', check=False)
            cut = re.findall(r'(com\.android\.internal\.display\.cutout\.emulation\.\w+)', overlays)
            pick = next((o for k in ('hole', 'punch', 'corner', 'tall', 'double') for o in cut if k in o), None)
            if not pick:
                info['cutout'] = 'no cutout overlay on this image'
                return
            adb('shell', 'cmd', 'overlay', 'enable', pick, check=False)
            try:
                time.sleep(4)
                page.connect()
                page.wait("!!(window.__game && !document.getElementById('menu').hidden)", 30)
                if args.update_url:
                    again = update_dialog(12)  # the activity restarted: it offers the update again
                    if again:
                        adb('shell', 'input', 'tap', *map(str, again['以后再说']))
                time.sleep(1)
                ins = page.eval("""(() => { const cs = getComputedStyle(document.documentElement);
                    const v = (n) => cs.getPropertyValue(n).trim();
                    const menu = getComputedStyle(document.getElementById('menu'));
                    return { app: [v('--app-inset-top'), v('--app-inset-right'), v('--app-inset-bottom'), v('--app-inset-left')],
                             safe: window.__game.safe, menuPad: [menu.paddingLeft, menu.paddingRight] }; })()""")
                info['cutout'] = {'overlay': pick, **ins}
                side = max(ins['safe']['l'], ins['safe']['r'])
                check('camera cutout: the game keeps clear of it', side > 0, json.dumps(ins))
                settle()
                shot('cutout')
            finally:
                adb('shell', 'cmd', 'overlay', 'disable', pick, check=False)

        section('cutout', cutout)
    except Exception as e:
        check('check ran', False, f'{type(e).__name__}: {e}'[:300])
        traceback.print_exc()
    finally:
        # ---- the app's log, frame stats, vibrator history, a sheet of screenshots
        log = adb('logcat', '-d', '-v', 'brief', check=False)
        (out / 'logcat.txt').write_text(log)
        mine = [ln for ln in log.splitlines() if 'HeelStomp' in ln or 'chromium' in ln or 'AndroidRuntime' in ln]
        (out / 'app-log.txt').write_text('\n'.join(mine))
        errors = [ln for ln in mine if 'console ERROR' in ln or 'Uncaught' in ln or 'FATAL' in ln]
        check('no errors in the app log', not errors, ' | '.join(errors[:5]))
        gfx = adb('shell', 'dumpsys', 'gfxinfo', PKG, check=False)
        (out / 'gfxinfo.txt').write_text(gfx)
        m = re.search(r'Total frames rendered: (\d+)', gfx)
        info['frames_rendered'] = int(m.group(1)) if m else None
        vibs = adb('shell', 'dumpsys', 'vibrator_manager', check=False)
        if not vibs.strip() or "Can't find service" in vibs:
            vibs = adb('shell', 'dumpsys', 'vibrator', check=False)
        (out / 'vibrator.txt').write_text(vibs)
        info['vibrator_mentions_app'] = PKG in vibs

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

        (out / 'report.json').write_text(json.dumps({'info': info, 'results': results}, ensure_ascii=False, indent=1))
        failed = [r['check'] for r in results if not r['ok']]
        print('SUMMARY', json.dumps({'webview': info.get('webview'), 'android': info.get('device'),
                                     'failed': failed}, ensure_ascii=False), flush=True)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
