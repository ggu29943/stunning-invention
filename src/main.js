import { clamp, rand, randi, chance, store, ellipseDist } from './util.js';
import { loadAssets } from './assets.js';
import { buildScene, drawNeons } from './scene.js';
import { Swarm, drawAnt, depthScale } from './ants.js';
import { Leg, CHARGE_TIME } from './foot.js';
import { FX } from './fx.js';
import { Records, newSession, RECORDS_KEY } from './stats.js';
import { drawHUD, pauseButtonRect, egoLevel } from './hud.js';
import * as sfx from './audio.js';

const SETTINGS_KEY = 'heelstomp.settings.v1';
const TIME_LIMIT = 60;
const COMBO_WINDOW = 1.6;
// drag control: pressure zones while the front boot presses on the street.
// The back leg shifts its weight at BACK_P1 (twist_0) and again at KILL_AT
// (twist_1), which is also where the pinned ants are crushed.
export const BACK_P1 = 0.35;
export const KILL_AT = 0.7;
const LIFT_HYST = 5; // px the sole must rise before a pressed boot counts as lifted
const PRESS_HINTS = 3; // show the "press down" hint on the first touchdowns of a round
const STICK_CHANCE = 0.3; // drag control: chance a crushing press gets the sole sticky
const MAX_STRANDS = 12;
const MAX_SMEARS = 22;

const $ = (id) => document.getElementById(id);

class Game {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.assets = assets;
    this.settings = { sound: true, vibrate: true, control: 'charge', sticky: true, ...store.get(SETTINGS_KEY, {}) };
    this.settings.sticky = this.settings.sticky !== false;
    this.stickChance = STICK_CHANCE;
    if (this.settings.control !== 'drag') this.settings.control = 'charge';
    sfx.setMuted(!this.settings.sound);

    this.fx = new FX();
    this.swarm = new Swarm(this);
    this.foot = new Leg(this, false);
    this.backLeg = new Leg(this, true);
    this.records = new Records();
    this.session = newSession();

    this.state = 'menu';
    this.mode = 'endless';
    this.timeLimit = TIME_LIMIT;
    this.time = 0;
    this.elapsed = 0;
    this.pressure = 0;
    this.stompPressure = 0;
    this.combo = 0;
    this.comboT = 0;
    this.comboWindow = COMBO_WINDOW;
    this.comboPulse = 0;
    this.portraitPulse = 0;
    this.redMix = 0;
    this.moodT = 0;
    this.gain = 0;
    this.gainT = 0;
    this.hitstop = 0;
    this.stepDelay = -1;
    this.fullAnnounced = false;
    this.lastLevel = 0;

    this.pointer = null; // { id, x, y, mode: 'aim' | 'follow' | 'grind', queued, released }
    this.killAt = KILL_AT;
    this.backP1 = BACK_P1;
    this.press = null; // drag control: the boot's current stay on the street
    // drag control: crushed ants glued between sole and street (strands) and
    // squashed onto the sole (smears)
    this.sticky = { strands: [], smears: [], anchorX: 0 };

    // env(safe-area-inset-*) resolved on a real property, so every engine returns px
    this.insetProbe = document.createElement('div');
    this.insetProbe.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    document.body.appendChild(this.insetProbe);
    this.layout();
    this.placeLegs();
    this.swarm.reset();
    this.bindInput();
    window.addEventListener('pagehide', () => this.records.dirty && this.records.save());
    window.addEventListener('resize', () => this.layout());
    window.visualViewport?.addEventListener('resize', () => this.layout());
    screen.orientation?.addEventListener?.('change', () => this.layout());
    window.addEventListener('orientationchange', () => setTimeout(() => this.layout(), 250));
    // another tab saved records: merge them so neither tab overwrites the other
    window.addEventListener('storage', (e) => {
      if (e.key !== RECORDS_KEY) return;
      this.records.merge(); // no write here, or two tabs would echo each other
      if (this.state === 'menu') ui.refreshMenu(this);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'play') this.pause();
        if (this.records.dirty) this.records.save();
        sfx.suspendAudio();
      }
    });

    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------------ layout
  layout() {
    const vv = window.visualViewport;
    const cssW = Math.max(1, Math.round(vv ? vv.width : window.innerWidth));
    const cssH = Math.max(1, Math.round(vv ? vv.height : window.innerHeight));
    if (cssW === this.cssW && cssH === this.cssH && this.scene) {
      // same size, but a 180° rotation can move the notch to the other side
      this.readInsets();
      return;
    }
    const prevW = this.W;
    const prevBandTop = this.bandTop;
    const prevBandBot = this.bandBot;
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.portrait = cssH > cssW;
    if (this.portrait) {
      this.W = 540;
      this.H = clamp(Math.round((540 * cssH) / cssW), 760, 1300);
    } else {
      this.H = 540;
      this.W = clamp(Math.round((540 * cssW) / cssH), 720, 1400);
    }
    this.scale = Math.min(cssW / this.W, cssH / this.H);
    this.offX = (cssW - this.W * this.scale) / 2;
    this.offY = (cssH - this.H * this.scale) / 2;
    this.readInsets();
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;

    this.bandBot = this.H - (this.portrait ? 70 : 34);
    this.bandTop = this.bandBot - (this.portrait ? 150 : 112);
    // on-screen sole length of a planted boot (sets how big the boots are)
    this.soleLen = this.portrait ? 165 : 205;
    this.walkTop = this.bandTop - 30;
    this.scene = buildScene(this.W, this.H, { walkTop: this.walkTop, bandTop: this.bandTop, bandBot: this.bandBot });
    this.fx.resize(this.W, this.H, this.walkTop);

    if (prevW) {
      // a drag-control press ends before the boots are re-placed (place()
      // would otherwise leave ants pinned for good); strands cannot survive
      // the street moving under them
      if (this.foot.state === 'follow') this.endFollow();
      this.clearSticky();
      // keep everything on screen after a rotation / resize
      const mapY = (y) => this.bandTop + ((y - prevBandTop) / (prevBandBot - prevBandTop)) * (this.bandBot - this.bandTop);
      const mapX = (x) => (x / prevW) * this.W;
      for (const a of this.swarm.ants) {
        a.x = mapX(a.x);
        a.y = mapY(a.y);
      }
      for (const leg of [this.foot, this.backLeg]) {
        const falling = leg.state === 'stomping' ? { t: leg.t, tx: mapX(leg.tx), ty: mapY(leg.ty) } : null;
        leg.place(clamp(mapX(leg.x), 60, this.W - 60), clamp(mapY(leg.y), this.bandTop + 18, this.bandBot));
        if (falling) {
          // a released stomp keeps falling onto its (remapped) target
          const [tx, ty] = this.aimPoint(falling.tx, falling.ty);
          leg.tx = leg.hoverX = tx;
          leg.ty = leg.hoverY = ty;
          leg.state = 'stomping';
          leg.t = falling.t;
        }
      }
      // the gap between the feet was scaled with the width (a landscape -> portrait
      // turn leaves the back leg half inside the front boot): restore the stance
      const f = this.foot;
      const b = this.backLeg;
      const fx = f.state === 'stomping' ? f.tx : f.x;
      const fy = f.state === 'stomping' ? f.ty : f.y;
      const gap = Math.abs(b.x - fx);
      if (b.state === 'planted' && (gap < this.soleLen * 0.7 || gap > Math.max(this.soleLen * 1.35, this.W * 0.32))) {
        const side = b.x >= fx ? 1 : -1;
        let tx = fx + side * this.soleLen * 0.95;
        if (tx < 60 || tx > this.W - 60) tx = fx - side * this.soleLen * 0.95;
        b.place(clamp(tx, 60, this.W - 60), clamp(fy - 30, this.bandTop + 16, this.bandBot - 10));
      }
      this.cancelPointer();
    }
  }

  /** Safe-area insets in logical px, minus what the letterbox margin already covers. */
  readInsets() {
    const cs = getComputedStyle(this.insetProbe);
    const px = (v) => parseFloat(v) || 0;
    this.safe = {
      t: Math.max(0, px(cs.paddingTop) - this.offY) / this.scale,
      r: Math.max(0, px(cs.paddingRight) - this.offX) / this.scale,
      b: Math.max(0, px(cs.paddingBottom) - this.offY) / this.scale,
      l: Math.max(0, px(cs.paddingLeft) - this.offX) / this.scale,
    };
  }

  placeLegs() {
    const y = this.bandTop + (this.bandBot - this.bandTop) * 0.75;
    this.foot.place(this.W * (this.portrait ? 0.4 : 0.45), y);
    this.backLeg.place(this.foot.x + this.soleLen * 0.95, y - 30);
  }

  // ------------------------------------------------------------------ flow
  start(mode) {
    sfx.initAudio();
    sfx.click();
    this.mode = mode;
    this.state = 'play';
    this.elapsed = 0;
    this.session = newSession();
    this.records.beginSession();
    this.combo = 0;
    this.comboT = 0;
    this.pressure = 0;
    this.gainT = 0;
    this.redMix = 0;
    this.moodT = 0;
    this.portraitPulse = 0;
    this.lastLevel = 0;
    this.press = null;
    this.pressHints = 0;
    this.clearSticky();
    this.stepDelay = -1;
    this.fx.clear();
    this.placeLegs();
    this.swarm.reset();
    this.cancelPointer();
    ui.show(null);
  }

  pause() {
    if (this.state !== 'play') return;
    this.state = 'pause';
    this.cancelPointer();
    sfx.stopCharge();
    ui.show('pause');
  }

  resume() {
    if (this.state !== 'pause') return;
    sfx.initAudio();
    this.state = 'play';
    this.last = performance.now();
    ui.show(null);
  }

  end() {
    this.cancelPointer();
    sfx.stopCharge();
    this.settleLegs(true); // a stomp released before the end still counts
    this.finishCombo();
    this.records.check(this.session);
    this.records.save();
    this.state = 'over';
    ui.results(this);
    ui.show('over');
  }

  toMenu() {
    if (this.records.dirty) this.records.save();
    this.cancelPointer();
    sfx.stopCharge();
    this.settleLegs(false);
    this.state = 'menu';
    this.pressure = 0;
    ui.refreshMenu(this);
    ui.show('menu');
  }

  /** Nothing may hang in mid-air once the round stops updating. */
  settleLegs(score) {
    const f = this.foot;
    if (f.state === 'stomping') {
      f.place(f.tx, f.ty);
      if (score) this.impact();
    }
    if (f.state === 'follow') this.endFollow();
    const b = this.backLeg;
    if (b.state === 'stepping') b.place(b.tx, b.ty);
  }

  saveSettings() {
    store.set(SETTINGS_KEY, this.settings);
    sfx.setMuted(!this.settings.sound);
  }

  vibrate(pattern) {
    if (!this.settings.vibrate) return;
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* unsupported */
    }
  }

  // ------------------------------------------------------------------ input
  toWorld(e) {
    const r = this.canvas.getBoundingClientRect();
    return [(e.clientX - r.left - this.offX) / this.scale, (e.clientY - r.top - this.offY) / this.scale];
  }

  aimPoint(x, y) {
    return [clamp(x, 40, this.W - 40), clamp(y, this.bandTop + 18, this.bandBot)];
  }

  bindInput() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', (e) => {
      if (!this.pointer || this.pointer.id !== e.pointerId) return;
      // drag control: the boot settles down as if the finger lifted
      if (this.pointer.mode === 'follow') this.onUp(e);
      else this.cancelPointer();
    });
    c.addEventListener('lostpointercapture', (e) => this.onUp(e));
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'p') {
        if (this.state === 'play') this.pause();
        else if (this.state === 'pause') this.resume();
      }
    });
  }

  onDown(e) {
    if (this.state !== 'play') return;
    e.preventDefault();
    if (this.pointer) return; // one foot, one finger
    const [x, y] = this.toWorld(e);
    const pb = pauseButtonRect(this);
    if (x >= pb.x - 8 && x <= pb.x + pb.w + 8 && y >= pb.y - 8 && y <= pb.y + pb.h + 8) {
      this.pause();
      return;
    }
    sfx.initAudio();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const foot = this.foot;
    const drag = this.settings.control === 'drag';
    if (drag) {
      // drag control: the whole screen steers the boot (no grind hot-spot;
      // sliding a pressed boot grinds)
      this.pointer = { id: e.pointerId, x, y, mode: 'follow', queued: false, released: false };
      if (foot.state === 'stomping' || foot.state === 'grinding') this.pointer.queued = true;
      else this.startFollow();
      return;
    }
    const hb = foot.hitBox();
    if (foot.state === 'planted' && x >= hb.x0 && x <= hb.x1 && y >= hb.y0 && y <= hb.y1) {
      this.pointer = { id: e.pointerId, x, y, mode: 'grind' };
      foot.state = 'grinding';
      foot.grindT = 0;
      this.grindX = x - foot.x;
      return;
    }
    this.pointer = { id: e.pointerId, x, y, mode: 'aim', queued: false, released: false };
    const [tx, ty] = this.aimPoint(x, y);
    if (foot.state === 'stomping' || foot.state === 'grinding' || foot.state === 'follow') {
      this.pointer.queued = true;
    } else {
      this.beginAim(tx, ty);
    }
  }

  beginAim(tx, ty) {
    // lifting the boot for a stomp tears any sticky strands at once
    if (this.sticky.strands.length) this.snapAll();
    this.press = null;
    this.pressure = 0;
    this.fullAnnounced = false;
    this.foot.raise(tx, ty);
    sfx.startCharge();
  }

  onMove(e) {
    const p = this.pointer;
    if (!p || p.id !== e.pointerId) return;
    e.preventDefault();
    const [x, y] = this.toWorld(e);
    p.x = x;
    p.y = y;
    if (p.mode === 'aim' && !p.queued) {
      const [tx, ty] = this.aimPoint(x, y);
      this.foot.aim(tx, ty);
    }
  }

  onUp(e) {
    const p = this.pointer;
    if (!p || p.id !== e.pointerId) return;
    if (p.mode === 'grind') {
      if (this.foot.state === 'grinding') this.foot.state = 'planted';
      this.pointer = null;
      this.stepDelay = 0.1; // let the back leg clear a foot that was slid next to it
      return;
    }
    if (p.queued) {
      // finger lifted before the previous stomp landed: fire a quick stomp
      p.released = true;
      return;
    }
    if (p.mode === 'follow') {
      // on the street the boot just stands there; in the air it settles down
      this.pointer = null;
      if (this.foot.state === 'follow' && this.foot.h <= 0.01) this.endFollow();
      return;
    }
    this.release();
    this.pointer = null;
  }

  release() {
    sfx.stopCharge();
    if (this.foot.isAirborne()) {
      this.stompPressure = Math.max(0.15, this.pressure);
      this.foot.stomp();
    }
  }

  cancelPointer() {
    if (this.pointer) {
      try {
        this.canvas.releasePointerCapture(this.pointer.id);
      } catch {
        /* ignore */
      }
    }
    this.pointer = null;
    if (this.foot.state === 'grinding') {
      this.foot.state = 'planted';
      this.stepDelay = 0.1;
    }
    if (this.foot.state === 'follow') this.endFollow();
    if (this.foot.state === 'raising' || this.foot.state === 'hover') {
      // put the foot back where it was lifted from, without scoring (a released stomp still lands)
      this.foot.place(this.foot.fromX, this.foot.fromY);
    }
    this.press = null;
    this.pressure = 0;
    sfx.stopCharge();
  }

  // ------------------------------------------------------------------ scoring
  killAnt(a, flags) {
    const s = this.session;
    let mult = 1;
    const tags = [];
    if (a.state === 'panic' || a.scream > 0 || a.state === 'stun') {
      s.screams++;
      mult *= 2;
      tags.push('scream');
    }
    if (a.wounded) {
      s.trash++;
      mult *= 1.5;
      tags.push('trash');
    }
    if (flags.heel) {
      s.heel++;
      mult *= 3;
    }
    if (flags.full) {
      s.fullKills++;
      mult *= 2;
    }
    this.combo++;
    this.comboT = COMBO_WINDOW;
    this.comboPulse = 1;
    if (this.combo > s.maxCombo) s.maxCombo = this.combo;
    const comboMult = 1 + Math.floor(this.combo / 10) * 0.5;
    const ego = Math.max(1, Math.round(mult * comboMult * (flags.base ?? 1)));
    s.kills++;
    s.ego += ego;
    this.fx.splat(a.x, a.y, depthScale(this, a.y) * a.size);
    return ego;
  }

  finishCombo() {
    this.combo = 0;
    this.comboT = 0;
  }

  impact() {
    const foot = this.foot;
    const p = this.stompPressure;
    const full = p >= 1;
    const fp = foot.footprint(foot.x, foot.y, p);
    const s = this.session;
    s.stomps++;

    const hits = this.swarm.query(fp.x, fp.y, fp.rx, fp.ry, full ? 2.8 : 1.5);
    const dead = [];
    let ego = 0;
    let heelKills = 0;
    for (const { a, d } of hits) {
      const heel = Math.hypot((a.x - fp.heelX) / 1.4, a.y - fp.heelY) < fp.heelR * 1.6;
      if (d < 1 || heel) {
        ego += this.killAnt(a, { heel: heel && d >= 0.55, full });
        if (heel && d >= 0.55) heelKills++;
        dead.push(a);
      } else if (d < 1.3 && !a.wounded && chance(0.65)) {
        a.wounded = true;
        this.swarm.panic(a, fp.x, fp.y, true);
        a.panicT = 0.4;
      } else if (full && d >= 1.5) {
        this.swarm.stun(a, rand(0.9, 1.5));
      } else {
        this.swarm.panic(a, fp.x, fp.y, chance(0.5));
      }
    }
    this.swarm.remove(dead);

    if (dead.length) {
      this.fx.debris(fp.x, foot.y, Math.min(40, dead.length * 2));
      s.stompKills = Math.max(s.stompKills, dead.length);
      s.stompEgo = Math.max(s.stompEgo, ego);
      this.gain = ego;
      this.gainT = 1.6;
      this.portraitPulse = Math.min(1, 0.4 + dead.length * 0.05);
      if (full || dead.length >= 8) this.moodT = 2.2;
      this.fx.text(fp.x, foot.y - 70, `+${ego}`, { size: 18 + Math.min(18, dead.length), color: full ? '#ff4fa3' : '#ffe14f' });
      if (dead.length >= 2) {
        this.fx.text(fp.x, foot.y - 98, `×${dead.length}`, { size: 14, color: '#fff', life: 0.7 });
      }
    }
    if (full) {
      this.fx.text(fp.x, foot.y - 128, '满压!', { size: 24, color: '#ff4f7a', life: 1 });
      this.fx.crack(fp.x, foot.y - 6, 90);
      this.fx.ring(fp.x, fp.y, fp.rx * 2.6, fp.ry * 2.6, 'rgba(255, 80, 130, 0.9)', 0.45);
      this.hitstop = 0.07;
      this.fx.flash = 0.35;
    }
    if (heelKills) this.fx.text(fp.heelX, fp.heelY - 40, '鞋跟暴击!', { size: 15, color: '#7ef0ff', life: 0.9 });

    this.fx.ring(fp.x, fp.y, fp.rx * 1.1, fp.ry * 1.1, 'rgba(255,255,255,0.7)', 0.3);
    this.fx.dust(fp.x, foot.y, p, foot.soleAt() / 165);
    this.fx.shake(3 + 9 * p + Math.min(5, dead.length * 0.15), 0.18 + p * 0.2);
    sfx.stomp(p);
    sfx.crunch(dead.length);
    if (full) sfx.ding(false);
    this.vibrate(full ? [35, 25, 45] : Math.round(12 + 25 * p));

    this.records.check(s);
    this.checkLevel();
    this.stepDelay = 0.18;
  }

  backLanded() {
    const leg = this.backLeg;
    const fp = leg.footprint(leg.x, leg.y, 0.2);
    const hits = this.swarm.query(fp.x, fp.y, fp.rx, fp.ry, 1.4);
    const dead = [];
    let ego = 0;
    for (const { a, d } of hits) {
      if (d < 1) {
        ego += this.killAnt(a, {});
        dead.push(a);
      } else {
        this.swarm.panic(a, fp.x, fp.y, chance(0.4));
      }
    }
    this.swarm.remove(dead);
    if (dead.length) {
      this.fx.text(fp.x, leg.y - 60, `+${ego}`, { size: 15, color: '#ffe14f' });
      this.records.check(this.session);
      this.checkLevel();
    }
    this.fx.dust(fp.x, leg.y, 0.1, (leg.soleAt() / 165) * 0.7);
    this.fx.shake(2.5, 0.12);
    sfx.heelTap(0.4);
    sfx.crunch(dead.length);
  }

  maybeStepBackLeg() {
    const f = this.foot;
    const b = this.backLeg;
    const gap = b.x - f.x;
    const far = Math.abs(gap) > Math.max(this.soleLen * 1.35, this.W * 0.32);
    const close = Math.abs(gap) < this.soleLen * 0.7;
    if (!far && !close) return;
    let side = gap >= 0 ? 1 : -1;
    const step = this.soleLen * 0.95;
    let tx = f.x + side * step;
    if (tx < 60 || tx > this.W - 60) {
      side = -side;
      tx = f.x + side * step;
    }
    const ty = clamp(f.y - 30, this.bandTop + 16, this.bandBot - 10);
    b.stepTo(clamp(tx, 60, this.W - 60), ty);
  }

  checkLevel() {
    const lv = egoLevel(this.session.ego);
    if (lv > this.lastLevel) {
      this.lastLevel = lv;
      this.portraitPulse = 1;
      sfx.ding(true);
      // centred, clear of the portrait and the "+N" gain readout under it
      this.fx.text(this.W / 2, this.H * 0.2, `自尊 Lv.${lv}`, { size: 26, color: '#ffe14f', life: 1.4, vy: -16 });
    }
  }

  // ------------------------------------------------------------------ loop
  frame(now) {
    // re-arm first: an exception in this frame must not stop the loop for good
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    if (this.state === 'play') {
      if (this.hitstop > 0) {
        this.hitstop -= dt;
        this.fx.update(dt * 0.2);
      } else {
        this.update(dt);
      }
    } else if (this.state === 'menu') {
      this.ambient(dt);
    } else {
      // pause / results: let the portrait settle instead of freezing mid cross-fade
      this.tickPortrait(dt);
    }
    this.render();
  }

  /** Menu backdrop: ants keep walking, nothing scores. */
  ambient(dt) {
    this.lastDt = dt;
    this.elapsed = Math.min(this.elapsed + dt, 20);
    this.swarm.update(dt, null);
    this.feetBlockAnts();
    this.fx.update(dt);
    this.tickPortrait(dt);
  }

  tickPortrait(dt) {
    this.portraitPulse = Math.max(0, this.portraitPulse - dt * 2.5);
    this.comboPulse = Math.max(0, this.comboPulse - dt * 5);
    this.gainT = Math.max(0, this.gainT - dt);
    // portrait mood: cross-fade to the red-eyed face while the pressure is
    // full and for a moment after a big stomp
    this.moodT = Math.max(0, this.moodT - dt);
    const wantRed = (this.state === 'play' && this.pressure >= 1) || this.moodT > 0 ? 1 : 0;
    this.redMix += clamp(wantRed - this.redMix, -dt * 8, dt * 12);
  }

  update(dt) {
    this.lastDt = dt;
    this.elapsed += dt;
    const foot = this.foot;
    const ptr = this.pointer;

    // drag control: the boot follows the finger (sets its own pressure)
    if (foot.state === 'follow') {
      this.followUpdate(dt, ptr);
    } else if (ptr && ptr.mode === 'aim' && !ptr.queued && (foot.state === 'hover' || foot.state === 'raising')) {
      this.pressure = Math.min(1, this.pressure + dt / CHARGE_TIME);
      sfx.updateCharge(this.pressure);
      if (this.pressure >= 1 && !this.fullAnnounced) {
        this.fullAnnounced = true;
        sfx.ding(false);
        this.vibrate(15);
      }
    } else if (foot.state === 'grinding' && ptr && ptr.mode === 'grind') {
      // grinding bears down harder the longer it is held (the back leg lifts
      // once it passes the kill line); it crushes from the start, as before
      this.pressure = Math.min(1, this.pressure + dt / CHARGE_TIME);
    } else if (!foot.isAirborne()) {
      this.pressure = Math.max(0, this.pressure - dt * 4);
    }

    let threat = foot.isAirborne() ? foot.footprint(foot.hoverX, foot.hoverY, this.pressure) : null;
    if (foot.state === 'follow' && foot.h > 0.01 && foot.h < 150) threat = this.dragFootprint(0.3);
    this.swarm.update(dt, threat);

    const ev = foot.update(dt, this.pressure);
    if (ev === 'landed') {
      this.impact();
      // a touch arrived while we were stomping: start it now
      if (ptr && ptr.queued) this.startQueued(ptr);
    }
    if (foot.state === 'grinding' && ptr && ptr.mode === 'grind') {
      this.grind(dt, ptr);
    } else if (foot.state === 'planted' && ptr && (ptr.mode === 'aim' || ptr.mode === 'follow') && ptr.queued) {
      // queued touch landed on a grinding foot that has since been released
      this.startQueued(ptr);
    }

    if (this.stepDelay > 0) {
      this.stepDelay -= dt;
      if (this.stepDelay <= 0 && this.backLeg.state === 'planted') this.maybeStepBackLeg();
    }
    if (this.backLeg.update(dt, 0) === 'landed') this.backLanded();

    this.feetBlockAnts();
    this.releaseStrays();
    this.stickyUpdate(dt);

    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.finishCombo();
    }
    this.tickPortrait(dt);
    this.fx.update(dt);
    this.records.update(dt);

    if (this.mode === 'timed' && this.elapsed >= this.timeLimit) this.end();
  }

  /** Start a press that waited for the previous stomp; a finger on the leg grinds, as a fresh press there would. */
  startQueued(ptr) {
    const foot = this.foot;
    ptr.queued = false;
    if (ptr.mode === 'follow') {
      if (ptr.released) this.pointer = null;
      else this.startFollow();
      return;
    }
    const hb = foot.hitBox();
    if (ptr.x >= hb.x0 && ptr.x <= hb.x1 && ptr.y >= hb.y0 && ptr.y <= hb.y1) {
      if (ptr.released) {
        // a quick tap on the leg: same as a fresh tap there (a grind of no length)
        this.pointer = null;
        return;
      }
      ptr.mode = 'grind';
      foot.state = 'grinding';
      foot.grindT = 0;
      this.grindX = ptr.x - foot.x;
      return;
    }
    const [tx, ty] = this.aimPoint(ptr.x, ptr.y);
    this.beginAim(tx, ty);
    if (ptr.released) {
      this.release();
      this.pointer = null;
    }
  }

  // ------------------------------------------------------------ drag control
  // The boot follows the finger. Its sole stays a "grip" below the finger, so
  // the finger holds the ankle and never covers the ants. Above the street the
  // finger sets x and the sole's height; pushing on past the street raises the
  // pressure. Touching down pins the ants under the sole (alive); at KILL_AT
  // they are crushed, some sticking to the sole; lifting again tears the
  // sticky strands one by one.

  /** Street depth the dragged boot walks along. */
  dragY() {
    return this.bandTop + (this.bandBot - this.bandTop) * 0.62;
  }

  /**
   * The dragged boot walks one depth line, so its footprint spans most of the
   * street's depth (otherwise ants near the kerbs could never be reached).
   */
  dragFootprint(p = this.pressure, x = this.foot.x) {
    const fp = this.foot.footprint(x, this.dragY(), p);
    fp.y = (this.bandTop + this.bandBot) / 2;
    fp.ry = (this.bandBot - this.bandTop) * 0.5 + 8; // kerb to kerb
    return fp;
  }

  /** Is the front boot grinding (either control)? */
  isGrinding() {
    const f = this.foot;
    return f.state === 'grinding' || (f.state === 'follow' && f.h <= 0.01 && f.grindingT > 0);
  }

  /**
   * Which BACK_POSES pose the back leg shows. While the front boot grinds it
   * has two: still (0), or lifted off the street once the grind is past the
   * kill line (3: all the weight on the grinding boot). While a dragged boot
   * presses it has three (0..2).
   */
  backPose() {
    const f = this.foot;
    if (this.isGrinding()) return this.pressure >= KILL_AT ? 3 : 0;
    if (this.settings.control !== 'drag' || f.state !== 'follow' || f.h > 0.01) return 0;
    if (this.pressure >= KILL_AT) return 2;
    if (this.pressure >= BACK_P1) return 1;
    return 0;
  }

  /** Where the finger wants the boot: x, sole height above the street, pressure. */
  followTargets(ptr) {
    const grip = this.soleLen * 0.25;
    const contact = this.dragY();
    const sole = ptr.y + grip;
    // full pressure is always reachable: the travel left below the touchdown
    // point, capped to a comfortable range
    const range = clamp(this.H - (contact - grip) - 10, 40, 110);
    const h = contact - sole;
    return {
      x: clamp(ptr.x, 40, this.W - 40),
      // within half a pixel counts as on the street (float noise must not
      // leave the boot hovering a hair above it)
      h: h < 0.5 ? 0 : h,
      p: clamp((sole - contact) / range, 0, 1),
    };
  }

  /** A finger went down in drag control: the boot starts following it. */
  startFollow() {
    const foot = this.foot;
    if (foot.state !== 'planted' && foot.state !== 'follow') return;
    const y = this.dragY();
    if (Math.abs(foot.y - y) > 0.5) {
      // coming from the stomp control, where the boot can stand at any depth
      foot.place(foot.x, y);
    }
    foot.follow();
    this.pressure = 0;
    this.press = foot.h <= 0.01 ? this.newPress() : null;
  }

  newPress() {
    return { pinned: [], crushed: false, full: false, kills: 0, ego: 0, maxP: 0, tick: 0 };
  }

  followUpdate(dt, ptr) {
    const foot = this.foot;
    const st = this.sticky;
    const steering = ptr && ptr.mode === 'follow' && !ptr.queued;
    const t = steering ? this.followTargets(ptr) : { x: foot.x, h: 0, p: 0 };
    // tallest pose: the boot's lowest point no higher than ~42% of the screen
    // (as in the video, the raised boot stays in view); the zones split it in thirds
    foot.hMax = foot.hMaxAt(this.dragY());
    const wasDown = foot.h <= 0.01;
    const held = st.strands.length > 0;
    if (wasDown && t.h <= LIFT_HYST) {
      // on the street (finger jitter near the kerb does not count as a lift):
      // a pressed boot slides only slowly, never into the back leg; pressure follows
      const maxStep = 140 * dt;
      let nx = foot.x + clamp(t.x - foot.x, -maxStep, maxStep);
      const b = this.backLeg;
      const keep = this.soleLen * 0.75;
      if (b.state === 'planted' && Math.abs(nx - b.x) < keep && Math.abs(nx - b.x) < Math.abs(foot.x - b.x)) nx = foot.x;
      // sliding a pressed boot is a grind, like the stomp control's
      if (Math.abs(nx - foot.x) > 0.3) foot.grindingT = 0.22;
      foot.x = nx;
      foot.h = 0;
      this.pressure += (t.p - this.pressure) * Math.min(1, dt * 14);
      if (Math.abs(t.p - this.pressure) < 0.002) this.pressure = t.p;
    } else {
      // in the air: follow the finger; glued strands hold the boot back so
      // the player has to pull to tear them
      const reach = Math.min(t.h, foot.hMax);
      const wantH = held ? reach * 0.42 : reach;
      const wantX = held ? st.anchorX + (t.x - st.anchorX) * 0.35 : t.x;
      const k = Math.min(1, dt * (held ? 12 : 24));
      foot.x += (wantX - foot.x) * k;
      foot.h += (wantH - foot.h) * k;
      if (t.h <= 0 && foot.h < 1) foot.h = 0;
      this.pressure += (0 - this.pressure) * Math.min(1, dt * 14);
    }
    foot.x = clamp(foot.x, 40, this.W - 40);
    if (foot.h > 0.01) foot.updateZone();
    else foot.zone = 0;
    const isDown = foot.h <= 0.01;

    if (!steering) {
      // finger gone: once back on the street the boot simply stands
      if (isDown) this.endFollow();
      return;
    }
    if (!wasDown && isDown) this.touchdown();
    else if (wasDown && !isDown) this.liftoff();
    if (!isDown) foot.grindingT = 0;
    if (foot.grindingT > 0) {
      foot.grindingT = Math.max(0, foot.grindingT - dt);
      foot.grindT += dt;
      s_grindFx(this, foot, dt);
    }
    if (isDown) this.pressing(dt);
  }

  /** The dragged boot reached the street: ants under it are pinned, alive. */
  touchdown() {
    const foot = this.foot;
    const press = (this.press = this.newPress());
    this.session.stomps++;
    // the back leg stays put while the boot presses (it is shifting its
    // weight); it only hops aside if the boot came down right on top of it
    const b = this.backLeg;
    if (b.state === 'planted' && Math.abs(b.x - foot.x) < this.soleLen * 0.7) this.maybeStepBackLeg();
    sfx.heelTap(0.3);
    this.vibrate(8);
    this.fx.dust(foot.x, foot.y, 0, (foot.soleAt() / 165) * 0.5);
    const fp = this.dragFootprint(KILL_AT);
    for (const { a, d } of this.swarm.query(fp.x, fp.y, fp.rx, fp.ry, 1.5)) {
      if (d < 1 && a.state !== 'trapped') {
        a.state = 'trapped';
        a.scream = 1;
        press.pinned.push(a);
      } else if (a.state !== 'trapped') {
        this.swarm.panic(a, fp.x, fp.y, d < 1.2);
      }
    }
    if (press.pinned.length) sfx.squeak();
    if (this.pressHints < PRESS_HINTS) {
      this.pressHints++;
      this.fx.text(foot.x, foot.y - 130, '↓ 继续往下按', { size: 16, color: '#ffffff', life: 1.4, vy: 22 });
    }
  }

  /** The dragged boot left the street: whatever is still alive gets away. */
  liftoff() {
    this.freePinned();
    this.press = null;
    this.records.check(this.session);
  }

  freePinned() {
    const press = this.press;
    if (!press) return;
    const foot = this.foot;
    const hurt = press.maxP >= 0.3; // squeezed hard enough, they limp
    for (const a of press.pinned) {
      if (this.swarm.ants.includes(a)) this.swarm.release(a, foot.x, foot.y, hurt);
    }
    press.pinned = [];
  }

  /** End drag control's hold: the boot stands where it is (pause, finger up, etc). */
  endFollow() {
    const foot = this.foot;
    this.freePinned();
    this.press = null;
    if (foot.state === 'follow') {
      foot.h = 0;
      foot.state = 'planted';
    }
    this.pressure = 0;
  }

  /** Every frame the dragged boot is on the street. */
  pressing(dt) {
    const foot = this.foot;
    const press = this.press || (this.press = this.newPress());
    const s = this.session;
    const p = this.pressure;
    press.maxP = Math.max(press.maxP, p);
    if (p > 0.05) {
      s.crush += dt;
      this.fx.shake(0.4 + p * 1.4, 0.05);
    }
    // haptic ticks as the pressure builds
    const step = Math.floor(p * 5);
    if (step > press.tick) this.vibrate(5 + step * 3);
    press.tick = step;
    // a sliding boot lets go of pinned ants it no longer covers
    const fp = this.dragFootprint(p);
    for (const a of press.pinned) {
      if (this.swarm.ants.includes(a) && ellipseDist(a.x, a.y, fp.x, fp.y, fp.rx, fp.ry) > 1.1) {
        this.swarm.release(a, foot.x, foot.y, p >= 0.3);
      }
    }
    press.pinned = press.pinned.filter((a) => a.state === 'trapped');
    if (!press.crushed && p >= KILL_AT) this.crush();
    if (press.crushed && p >= KILL_AT) {
      // while it presses past the kill line, whatever gets under the sole
      // (the boot sliding, ants walking in) is crushed too, like a grind:
      // it scores, but does not count toward this press's one-stomp records
      const dead = [];
      let ego = 0;
      for (const { a } of this.swarm.query(fp.x, fp.y, fp.rx, fp.ry, 1)) {
        ego += this.killAnt(a, { full: p >= 1, base: 1.5 });
        dead.push(a);
      }
      if (dead.length) {
        this.swarm.remove(dead);
        this.fx.debris(fp.x + rand(-30, 30), foot.y, dead.length * 2);
        this.fx.text(fp.x, foot.y - 60, `+${ego}`, { size: 15, color: '#ffe14f', life: 0.6 });
        sfx.crunch(dead.length);
        this.checkLevel();
      }
      if (!press.full && p >= 1) this.fullPress();
    }
    if (p > 0.05) this.records.check(s);
  }

  /** Pressure reached the kill line: everything pinned under the boot dies. */
  crush() {
    const foot = this.foot;
    const press = this.press;
    const p = this.pressure;
    press.crushed = true;
    const fp = this.dragFootprint(p);
    const victims = new Set(press.pinned.filter((a) => this.swarm.ants.includes(a)));
    const near = [];
    for (const { a, d } of this.swarm.query(fp.x, fp.y, fp.rx, fp.ry, 1.4)) {
      if (d < 1) victims.add(a);
      else if (!victims.has(a)) near.push(a);
    }
    const dead = [...victims];
    let ego = 0;
    for (const a of dead) ego += this.killAnt(a, { full: p >= 1 });
    this.stickSome(dead);
    this.swarm.remove(dead);
    press.pinned = [];
    press.kills += dead.length;
    press.ego += ego;
    for (const a of near) {
      if (a.state === 'trapped') continue;
      if (!a.wounded && chance(0.5)) a.wounded = true;
      this.swarm.panic(a, fp.x, fp.y, true);
    }
    if (dead.length) {
      this.fx.debris(fp.x, foot.y, Math.min(40, dead.length * 2));
      this.fx.text(fp.x, foot.y - 70, `+${ego}`, { size: 18 + Math.min(18, dead.length), color: '#ffe14f' });
      if (dead.length >= 2) this.fx.text(fp.x, foot.y - 98, `×${dead.length}`, { size: 14, color: '#fff', life: 0.7 });
    }
    this.fx.ring(fp.x, fp.y, fp.rx * 1.1, fp.ry * 1.1, 'rgba(255,255,255,0.6)', 0.3);
    this.fx.shake(2.5 + Math.min(4, dead.length * 0.2), 0.2);
    sfx.crunch(Math.max(3, dead.length));
    this.vibrate(dead.length ? 30 : 12);
    this.notePress();
  }

  /** Pressure reached 100% after crushing: the 满压 flourish. */
  fullPress() {
    const foot = this.foot;
    this.press.full = true;
    const fp = this.dragFootprint(1);
    for (const { a, d } of this.swarm.query(fp.x, fp.y, fp.rx, fp.ry, 2.8)) {
      if (d >= 1.3 && a.state !== 'trapped') this.swarm.stun(a, rand(0.9, 1.5));
    }
    this.fx.text(fp.x, foot.y - 128, '满压!', { size: 24, color: '#ff4f7a', life: 1 });
    this.fx.crack(fp.x, foot.y - 6, 90);
    this.fx.ring(fp.x, fp.y, fp.rx * 2.6, fp.ry * 2.6, 'rgba(255, 80, 130, 0.9)', 0.45);
    this.fx.flash = 0.25;
    this.hitstop = 0.05;
    this.fx.shake(6, 0.25);
    sfx.ding(false);
    this.vibrate([30, 20, 40]);
    this.moodT = 2.2;
  }

  /** Per-press records, ego readout and portrait reaction after kills. */
  notePress() {
    const press = this.press;
    const s = this.session;
    s.stompKills = Math.max(s.stompKills, press.kills);
    s.stompEgo = Math.max(s.stompEgo, press.ego);
    if (press.kills) {
      this.gain = press.ego;
      this.gainT = 1.6;
      this.portraitPulse = Math.min(1, 0.4 + press.kills * 0.05);
      if (press.kills >= 8) this.moodT = 2.2;
    }
    this.records.check(s);
    this.checkLevel();
  }

  // ------------------------------------------------------------ sticky sole
  /**
   * Sometimes (stickChance per crushing press, drag control, setting on) a
   * few of the crushed ants glue the sole to the street.
   */
  stickSome(dead) {
    if (this.settings.control !== 'drag' || !this.settings.sticky || !dead.length) return;
    if (Math.random() >= this.stickChance) return;
    const n = Math.min(dead.length, randi(2, 6));
    const pickFrom = [...dead];
    for (let i = 0; i < n; i++) {
      const a = pickFrom.splice(Math.floor(Math.random() * pickFrom.length), 1)[0];
      this.stick(a);
    }
  }

  /** Glue one crushed ant between sole and street; counts only if it actually sticks. */
  stick(a) {
    const st = this.sticky;
    const foot = this.foot;
    const half = foot.soleAt() * 0.4;
    let stuck = false;
    if (st.strands.length < MAX_STRANDS) {
      // the goo joins the sole to the street right under it (whatever depth
      // the ant died at), so a fresh strand starts unstretched
      st.strands.push({
        gx: clamp(a.x, foot.x - half, foot.x + half),
        gy: foot.y + rand(-5, 5),
        frac: clamp((a.x - foot.x) / half, -1, 1),
        maxLen: rand(45, 100) * (this.soleLen / 205),
        blob: chance(0.6),
        wob: rand(0, 6),
      });
      st.anchorX = foot.x;
      stuck = true;
    }
    if (st.smears.length < MAX_SMEARS) {
      st.smears.push({ u: rand(-0.9, 0.9), v: rand(-0.8, 0.8), r: rand(5, 9), life: rand(7, 11), seed: rand(0, 6) });
      stuck = true;
    }
    if (stuck) this.session.stuck = (this.session.stuck || 0) + 1;
  }

  /** Where strand i leaves the boot's lowest edge (its stretch is measured from here). */
  strandTop(sd) {
    const foot = this.foot;
    return [foot.x + sd.frac * foot.soleAt() * 0.4, foot.y - foot.h - 1];
  }

  stickyUpdate(dt) {
    const st = this.sticky;
    const foot = this.foot;
    // stuck smears dry up and drip off the raised sole
    for (const sm of st.smears) sm.life -= dt * (foot.h > 30 ? 1.6 : 0.4);
    if (foot.state === 'follow' && foot.h > 30 && st.smears.length && Math.random() < dt * 1.2) {
      this.fx.goo(foot.x + rand(-0.3, 0.3) * foot.soleAt(), foot.y - foot.h, 3, foot.y + rand(-6, 6));
    }
    st.smears = st.smears.filter((sm) => sm.life > 0);
    if (!st.strands.length) return;
    if (foot.state !== 'follow' && foot.state !== 'planted') {
      // the boot was lifted some other way (stomp control): tear everything
      this.snapAll();
      return;
    }
    const keep = [];
    for (const sd of st.strands) {
      const [px, py] = this.strandTop(sd);
      if (Math.hypot(px - sd.gx, py - sd.gy) > sd.maxLen) {
        const [ax, ay] = foot.underside(sd.frac);
        this.snap(sd, ax, ay, true);
      } else keep.push(sd);
    }
    const tore = keep.length < st.strands.length;
    st.strands = keep;
    if (tore && !keep.length) {
      // the last strand gave way: the boot springs free
      this.fx.text(foot.x, foot.y - foot.h - 40, '拽开!', { size: 20, color: '#ff8fb8', life: 1 });
      this.vibrate([12, 10, 24]);
      this.checkLevel();
    }
  }

  /** One strand tears: goo flies, a little ego for the effort. */
  snap(sd, ax, ay, sound) {
    const mx = (ax + sd.gx) / 2;
    const my = (ay + sd.gy) / 2;
    this.fx.goo(mx, my, 5, sd.gy + rand(-4, 4));
    this.session.ego += 2;
    this.fx.text(mx, my - 10, '+2', { size: 12, color: '#ffb3cf', life: 0.5 });
    if (sound) sfx.snap();
    this.vibrate(8);
  }

  snapAll() {
    const st = this.sticky;
    for (const sd of st.strands) {
      const [ax, ay] = this.foot.underside(sd.frac);
      this.snap(sd, ax, ay, false);
    }
    if (st.strands.length) sfx.snap();
    st.strands = [];
  }

  clearSticky() {
    this.sticky.strands = [];
    this.sticky.smears = [];
  }

  /** Glue strands between sole and street, sagging and thinning as they stretch. */
  drawStrands(ctx) {
    const st = this.sticky;
    if (!st.strands.length) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (const sd of st.strands) {
      // how far it is stretched comes from the boot's actual separation
      const [px, py] = this.strandTop(sd);
      const len = Math.hypot(px - sd.gx, py - sd.gy);
      if (len < 3) continue;
      const k = clamp(len / sd.maxLen, 0, 1);
      // but it is drawn from the sole itself
      const [ax, ay] = this.foot.underside(sd.frac);
      const sag = Math.sin(this.time * 3 + sd.wob) * 3 * (1 - k);
      const mx = (ax + sd.gx) / 2 + sag;
      const my = (ay + sd.gy) / 2;
      // dark goo with a wet highlight, thinning as it stretches
      const w = Math.max(1, 5.5 * (1 - k * 0.75));
      ctx.strokeStyle = `rgba(20, 4, 10, ${0.95 - k * 0.25})`;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(mx, my, sd.gx, sd.gy);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255, 170, 200, ${0.35 - k * 0.2})`;
      ctx.lineWidth = Math.max(0.5, w * 0.3);
      ctx.beginPath();
      ctx.moveTo(ax - w * 0.2, ay);
      ctx.quadraticCurveTo(mx - w * 0.2, my, sd.gx - w * 0.2, sd.gy);
      ctx.stroke();
      // a glob where it meets the street
      ctx.fillStyle = 'rgba(20, 4, 10, 0.9)';
      ctx.beginPath();
      ctx.ellipse(sd.gx, sd.gy, w * 1.1, w * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      if (sd.blob) {
        // an ant dangling on the strand
        const bx = ax + (sd.gx - ax) * 0.55 + sag * 0.5;
        const by = ay + (sd.gy - ay) * 0.55;
        ctx.fillStyle = '#12060c';
        ctx.beginPath();
        ctx.ellipse(bx, by, 4.2, 2.8, 0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#12060c';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const ang = sd.wob + i * 2.1 + Math.sin(this.time * 9 + i) * 0.3;
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + Math.cos(ang) * 5, by + Math.sin(ang) * 3);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  grind(dt, ptr) {
    const foot = this.foot;
    const s = this.session;
    s.crush += dt;
    // drag the planted heel slowly toward the finger
    const want = clamp(ptr.x - this.grindX, 50, this.W - 50);
    const maxStep = 140 * dt;
    foot.x += clamp(want - foot.x, -maxStep, maxStep);
    const fp = foot.footprint(foot.x, foot.y, 0);
    const dead = [];
    let ego = 0;
    for (const { a } of this.swarm.query(fp.x, fp.y, fp.rx * 0.9, fp.ry * 1.1, 1)) {
      ego += this.killAnt(a, { base: 1.5 });
      dead.push(a);
    }
    if (dead.length) {
      this.swarm.remove(dead);
      this.fx.debris(fp.x + rand(-30, 30), foot.y, dead.length * 2);
      this.fx.text(fp.x, foot.y - 60, `+${ego}`, { size: 15, color: '#ffe14f', life: 0.6 });
      sfx.crunch(dead.length);
      this.vibrate(8);
      this.checkLevel();
    }
    if (Math.random() < dt * 12) this.fx.dust(fp.x + rand(-40, 40), foot.y, 0, 0.35);
    this.fx.shake(1.2, 0.05);
    this.records.check(s);
  }

  /** Safety net: no ant stays pinned unless a press is actually holding it. */
  releaseStrays() {
    const holding = this.foot.state === 'follow' && this.press ? this.press.pinned : null;
    for (const a of this.swarm.ants) {
      if (a.state === 'trapped' && !(holding && holding.includes(a))) {
        this.swarm.release(a, this.foot.x, this.foot.y, false);
      }
    }
  }

  /** Walking ants turn away instead of walking through a planted boot. */
  feetBlockAnts() {
    for (const leg of [this.foot, this.backLeg]) {
      // a dragged boot standing on the street blocks too, until it has
      // crushed (from then on ants walking in die instead)
      const dragDown = leg === this.foot && leg.state === 'follow' && leg.h <= 0.01 && this.pressure < KILL_AT;
      if (leg.state !== 'planted' && !dragDown) continue;
      const fp = dragDown ? this.dragFootprint(0) : leg.footprint(leg.x, leg.y, 0);
      for (const a of this.swarm.ants) {
        if (a.state !== 'walk') continue;
        const d = ellipseDist(a.x, a.y, fp.x, fp.y, fp.rx * 1.05, fp.ry * 1.25);
        if (d < 1) {
          // head the other way, nudged toward the nearer edge of the boot
          a.dir = a.x < fp.x ? -1 : 1;
          a.x += a.dir * 90 * this.lastDt;
          a.y += (a.y < fp.y ? -36 : 36) * this.lastDt;
        }
      }
    }
  }

  // ------------------------------------------------------------------ render
  render() {
    const ctx = this.ctx;
    const k = this.dpr * this.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#07030b';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const [sx, sy] = this.state === 'play' ? this.fx.offset() : [0, 0];
    ctx.setTransform(k, 0, 0, k, this.dpr * this.offX + sx * k, this.dpr * this.offY + sy * k);
    ctx.save();
    ctx.beginPath();
    ctx.rect(-20, -20, this.W + 40, this.H + 40);
    ctx.clip();

    // backdrop
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.scene.canvas, 0, 0, this.scene.canvas.width * 3, this.scene.canvas.height * 3);
    ctx.imageSmoothingEnabled = true;
    drawNeons(ctx, this.scene.neons, this.time);
    this.fx.drawDecals(ctx);

    // aim shadow on the street
    const foot = this.foot;
    if (foot.state === 'follow' && foot.h > 0.01) {
      const fp = this.dragFootprint(0);
      const near = clamp(1 - foot.h / 160, 0, 1);
      ctx.fillStyle = `rgba(0, 0, 0, ${0.15 + 0.35 * near})`;
      ctx.beginPath();
      ctx.ellipse(fp.x, fp.y, fp.rx, fp.ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (foot.isAirborne()) {
      const fp = foot.footprint(foot.hoverX, foot.hoverY, this.pressure);
      const lift = foot.state === 'stomping' ? 1 - foot.t / 0.075 : 1;
      ctx.fillStyle = `rgba(0, 0, 0, ${0.25 + 0.3 * this.pressure + (1 - lift) * 0.2})`;
      ctx.beginPath();
      ctx.ellipse(fp.x, fp.y, fp.rx, fp.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = this.pressure >= 1 ? `rgba(255, 60, 110, ${0.6 + Math.sin(this.time * 25) * 0.3})` : 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.ellipse(fp.x, fp.y, fp.rx, fp.ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    this.fx.drawBack(ctx);

    // depth-sorted: ants and planted legs
    const items = this.swarm.ants.map((a) => ({ y: a.y, a }));
    for (const leg of [this.backLeg, this.foot]) {
      if (!leg.drawOnTop()) items.push({ y: leg.sortY() + (leg.back ? -0.5 : 0.5), leg });
    }
    items.sort((p, q) => p.y - q.y);
    // sticky strands hang under the sole, behind both boots (and the ants
    // in front of them), never across a boot
    this.drawStrands(ctx);
    for (const it of items) {
      if (it.a) drawAnt(ctx, this, it.a);
      else it.leg.draw(ctx, this.assets, this.pressure, this.time);
    }

    this.fx.drawFront(ctx);
    // the raised foot is closest to the camera
    if (foot.drawOnTop()) foot.draw(ctx, this.assets, this.pressure, this.time);
    this.fx.drawTexts(ctx);

    if (this.fx.flash > 0) {
      ctx.fillStyle = `rgba(255, 200, 220, ${this.fx.flash * 0.5})`;
      ctx.fillRect(-20, -20, this.W + 40, this.H + 40);
    }
    ctx.restore();

    if (this.state !== 'menu') {
      ctx.setTransform(k, 0, 0, k, this.dpr * this.offX, this.dpr * this.offY);
      drawHUD(ctx, this, this.assets);
    }
  }
}

/** Dust and a little shake while a boot grinds (shared feel for both controls). */
function s_grindFx(game, foot, dt) {
  if (Math.random() < dt * 12) game.fx.dust(foot.x + rand(-40, 40), foot.y, 0, 0.35);
  game.fx.shake(1.2, 0.05);
}

// ---------------------------------------------------------------------- UI
const ui = {
  game: null,
  show(name) {
    if (name === 'over') this.shownAt = performance.now();
    for (const id of ['menu', 'pause', 'over', 'loading']) {
      $(id).hidden = id !== name;
    }
  },
  refreshMenu(g) {
    const b = g.records.best;
    $('best').textContent = b.kills
      ? `最佳：单局击杀 ${b.kills} · 最高连杀 ${b.maxCombo} · 单脚 ${b.stompKills}`
      : '还没有纪录，去踩出第一个吧';
    $('btn-sound').setAttribute('aria-pressed', String(g.settings.sound));
    $('btn-sound').textContent = g.settings.sound ? '声音：开' : '声音：关';
    $('btn-vibrate').setAttribute('aria-pressed', String(g.settings.vibrate));
    $('btn-vibrate').textContent = g.settings.vibrate ? '震动：开' : '震动：关';
    this.refreshControl(g);
    const fsOk = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
    $('btn-fs').hidden = !fsOk;
  },
  /** Control-mode button labels and the matching how-to lines. */
  refreshControl(g) {
    const drag = g.settings.control === 'drag';
    const label = drag ? '操控：拖动压' : '操控：蓄力踩';
    for (const id of ['btn-control', 'btn-control2']) $(id).textContent = label;
    // the sticky-sole switch only matters for the drag control
    for (const id of ['btn-sticky', 'btn-sticky2']) {
      const b = $(id);
      b.hidden = !drag;
      b.textContent = g.settings.sticky ? '粘鞋：开' : '粘鞋：关';
      b.setAttribute('aria-pressed', String(g.settings.sticky));
    }
    const lines = drag
      ? [
          ['按住拖动', '：脚跟着手指走'],
          ['放到地上', '压住蚂蚁，先不死'],
          ['继续往下按', '加力，过致死线踩扁'],
          ['往上拖', '抬脚，没死的会逃走'],
        ]
      : [
          ['按住', '屏幕抬脚蓄力，拖动瞄准'],
          ['松手', '踩下，蓄满压力范围更大'],
          ['按住腿', '（街道上方）原地碾压，左右拖动'],
          ['', '踩惊慌的、受伤的蚂蚁，自尊加成更高'],
        ];
    const ul = $('howto');
    ul.textContent = '';
    for (const [b, rest] of lines) {
      const li = document.createElement('li');
      if (b) {
        const strong = document.createElement('b');
        strong.textContent = b;
        li.append(strong);
      }
      li.append(rest);
      ul.append(li);
    }
  },
  results(g) {
    const s = g.session;
    const broken = g.records.broken;
    const rows = [
      ['kills', '击杀', s.kills],
      ['ego', '自尊', s.ego],
      ['maxCombo', '最高连杀', s.maxCombo],
      ['stompKills', '单脚最多击杀', s.stompKills],
      ['stompEgo', '单脚最多自尊', s.stompEgo],
      ['fullKills', '满压击杀', s.fullKills],
      ['screams', '惨叫中断', s.screams],
      ['trash', '补刀清理', s.trash],
      ['heel', '鞋跟暴击', s.heel],
      ['crush', '碾压时长', `${s.crush.toFixed(1)} 秒`],
      ['stuck', '粘在鞋底', s.stuck || 0],
      [null, '逃走的蚂蚁', g.swarm.escaped],
    ];
    const list = $('stats');
    list.textContent = '';
    for (const [key, label, val] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = String(val);
      if (key && broken.has(key) && Number(s[key]) > 0) {
        const star = document.createElement('span');
        star.className = 'new';
        star.textContent = '新纪录';
        dd.append(' ', star);
      }
      list.append(dt, dd);
    }
    // 结算本局 from the pause menu ends a 60 s round early: not "time's up"
    $('over-title').textContent = g.mode === 'timed' && g.elapsed >= g.timeLimit ? '时间到！' : '结算';
  },
};

function toggleFullscreen() {
  const d = document;
  const el = d.documentElement;
  try {
    if (d.fullscreenElement || d.webkitFullscreenElement) {
      (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    } else {
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      const p = req?.call(el, { navigationUI: 'hide' });
      p?.then?.(() => screen.orientation?.lock?.('landscape').catch(() => {}))?.catch?.(() => {});
    }
  } catch {
    /* not supported */
  }
}

async function boot() {
  ui.show('loading');
  let assets;
  try {
    assets = await loadAssets((k) => {
      $('load-bar').style.width = `${Math.round(k * 100)}%`;
    });
  } catch (err) {
    $('load-msg').textContent = `加载失败：${err.message}。请通过 http 服务器打开（不能直接双击 html）。`;
    return;
  }
  const game = new Game($('game'), assets);
  ui.game = game;
  window.__game = game; // handy for debugging in the console

  // Results-card ghost clicks: a finger held through the end of a round lands
  // its click on whatever button appeared under it. Ignore a pointer click
  // whose press began before the card was shown (however long it was held),
  // and any click in the first 450 ms (double taps on 结算本局).
  // Use the event's own timestamp (when the finger landed), not the time the
  // handler ran: if the main thread is busy as the round ends, a press made
  // before the card appeared can be handled after it. Engines that report an
  // epoch-based timeStamp fall back to performance.now().
  const pressTime = (e) => {
    const now = performance.now();
    return e.timeStamp > 0 && e.timeStamp <= now ? e.timeStamp : now;
  };
  const downAt = new Map(); // pointerId -> time of its pointerdown
  let lastDown = -Infinity;
  document.addEventListener('pointerdown', (e) => {
    lastDown = pressTime(e);
    downAt.set(e.pointerId, lastDown);
  }, true);
  document.addEventListener('touchstart', (e) => { lastDown = pressTime(e); }, { capture: true, passive: true });
  document.addEventListener('click', (e) => {
    if (!e.target.closest?.('button') || !ui.shownAt) return;
    const pressed = downAt.get(e.pointerId) ?? lastDown;
    const stale = e.detail > 0 && pressed < ui.shownAt; // detail 0 = keyboard / programmatic
    if (stale || performance.now() - ui.shownAt < 450) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);
  $('btn-timed').addEventListener('click', () => game.start('timed'));
  $('btn-endless').addEventListener('click', () => game.start('endless'));
  $('btn-sound').addEventListener('click', () => {
    game.settings.sound = !game.settings.sound;
    game.saveSettings();
    sfx.initAudio();
    sfx.click();
    ui.refreshMenu(game);
  });
  $('btn-vibrate').addEventListener('click', () => {
    game.settings.vibrate = !game.settings.vibrate;
    game.saveSettings();
    game.vibrate(20);
    ui.refreshMenu(game);
  });
  $('btn-fs').addEventListener('click', toggleFullscreen);
  const toggleControl = () => {
    // a press/aim in progress was already cancelled by pause(); switch cleanly
    game.cancelPointer();
    game.settings.control = game.settings.control === 'drag' ? 'charge' : 'drag';
    game.clearSticky();
    game.saveSettings();
    sfx.initAudio();
    sfx.click();
    ui.refreshControl(game);
  };
  $('btn-control').addEventListener('click', toggleControl);
  $('btn-control2').addEventListener('click', toggleControl);
  const toggleSticky = () => {
    game.settings.sticky = !game.settings.sticky;
    if (!game.settings.sticky) game.clearSticky();
    game.saveSettings();
    sfx.initAudio();
    sfx.click();
    ui.refreshControl(game);
  };
  $('btn-sticky').addEventListener('click', toggleSticky);
  $('btn-sticky2').addEventListener('click', toggleSticky);
  $('btn-resume').addEventListener('click', () => game.resume());
  $('btn-finish').addEventListener('click', () => game.end());
  $('btn-restart').addEventListener('click', () => game.start(game.mode));
  $('btn-menu').addEventListener('click', () => game.toMenu());
  $('btn-again').addEventListener('click', () => game.start(game.mode));
  $('btn-menu2').addEventListener('click', () => game.toMenu());

  ui.refreshMenu(game);
  ui.show('menu');
}

boot();
