import { clamp, rand, chance, store, ellipseDist } from './util.js';
import { loadAssets } from './assets.js';
import { buildScene, drawNeons } from './scene.js';
import { Swarm, drawAnt, depthScale } from './ants.js';
import { Leg, CHARGE_TIME } from './foot.js';
import { FX } from './fx.js';
import { Records, newSession } from './stats.js';
import { drawHUD, pauseButtonRect, egoLevel } from './hud.js';
import * as sfx from './audio.js';

const SETTINGS_KEY = 'heelstomp.settings.v1';
const TIME_LIMIT = 60;
const COMBO_WINDOW = 1.6;

const $ = (id) => document.getElementById(id);

class Game {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.assets = assets;
    this.settings = { sound: true, vibrate: true, ...store.get(SETTINGS_KEY, {}) };
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

    this.pointer = null; // { id, x, y, mode: 'aim' | 'grind', queued, released }

    this.layout();
    this.placeLegs();
    this.swarm.reset();
    this.bindInput();
    window.addEventListener('pagehide', () => this.records.dirty && this.records.save());
    window.addEventListener('resize', () => this.layout());
    window.visualViewport?.addEventListener('resize', () => this.layout());
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
    if (cssW === this.cssW && cssH === this.cssH && this.scene) return;
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
    const cs = getComputedStyle(document.documentElement);
    const inset = (n) => (parseFloat(cs.getPropertyValue(n)) || 0) / this.scale;
    this.safe = { t: inset('--sat'), r: inset('--sar'), b: inset('--sab'), l: inset('--sal') };
    this.offX = (cssW - this.W * this.scale) / 2;
    this.offY = (cssH - this.H * this.scale) / 2;
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
      // keep everything on screen after a rotation / resize
      const mapY = (y) => this.bandTop + ((y - prevBandTop) / (prevBandBot - prevBandTop)) * (this.bandBot - this.bandTop);
      const mapX = (x) => (x / prevW) * this.W;
      for (const a of this.swarm.ants) {
        a.x = mapX(a.x);
        a.y = mapY(a.y);
      }
      for (const leg of [this.foot, this.backLeg]) {
        leg.place(clamp(mapX(leg.x), 60, this.W - 60), clamp(mapY(leg.y), this.bandTop + 18, this.bandBot));
      }
      this.cancelPointer();
    }
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
    this.lastLevel = 0;
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
    this.state = 'menu';
    this.pressure = 0;
    ui.refreshMenu(this);
    ui.show('menu');
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
      if (this.pointer && this.pointer.id === e.pointerId) this.cancelPointer();
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
    if (foot.state === 'stomping' || foot.state === 'grinding') {
      this.pointer.queued = true;
    } else {
      this.beginAim(tx, ty);
    }
  }

  beginAim(tx, ty) {
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
      return;
    }
    if (p.queued) {
      // finger lifted before the previous stomp landed: fire a quick stomp
      p.released = true;
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
    if (this.foot.state === 'grinding') this.foot.state = 'planted';
    if (this.foot.state === 'raising' || this.foot.state === 'hover') {
      // put the foot back down without scoring (a released stomp still lands)
      this.foot.place(this.foot.tx, this.foot.ty);
    }
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
    this.fx.dust(fp.x, foot.y, p, foot.plantScale());
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
    this.fx.dust(fp.x, leg.y, 0.1, leg.plantScale() * 0.7);
    this.fx.shake(2.5, 0.12);
    sfx.stomp(0.15);
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
    }
    this.render();
    requestAnimationFrame((t) => this.frame(t));
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
    this.redMix += clamp(wantRed - this.redMix, -dt * 3, dt * 5);
  }

  update(dt) {
    this.lastDt = dt;
    this.elapsed += dt;
    const foot = this.foot;
    const ptr = this.pointer;

    // charge pressure while the foot is raised and the finger is down
    if (ptr && ptr.mode === 'aim' && !ptr.queued && (foot.state === 'hover' || foot.state === 'raising')) {
      this.pressure = Math.min(1, this.pressure + dt / CHARGE_TIME);
      sfx.updateCharge(this.pressure);
      if (this.pressure >= 1 && !this.fullAnnounced) {
        this.fullAnnounced = true;
        sfx.ding(false);
        this.vibrate(15);
      }
    } else if (!foot.isAirborne()) {
      this.pressure = Math.max(0, this.pressure - dt * 4);
    }

    const threat = foot.isAirborne() ? foot.footprint(foot.hoverX, foot.hoverY, this.pressure) : null;
    this.swarm.update(dt, threat);

    if (foot.update(dt, this.pressure) === 'landed') {
      this.impact();
      if (ptr && ptr.queued) {
        // a touch arrived while we were stomping: start the next one now
        ptr.queued = false;
        const [tx, ty] = this.aimPoint(ptr.x, ptr.y);
        this.beginAim(tx, ty);
        if (ptr.released) {
          this.release();
          this.pointer = null;
        }
      }
    }
    if (foot.state === 'grinding' && ptr && ptr.mode === 'grind') {
      this.grind(dt, ptr);
    } else if (foot.state === 'planted' && ptr && ptr.mode === 'aim' && ptr.queued) {
      // queued touch landed on a grinding foot that has since been released
      ptr.queued = false;
      const [tx, ty] = this.aimPoint(ptr.x, ptr.y);
      this.beginAim(tx, ty);
      if (ptr.released) {
        this.release();
        this.pointer = null;
      }
    }

    if (this.stepDelay > 0) {
      this.stepDelay -= dt;
      if (this.stepDelay <= 0 && this.backLeg.state === 'planted') this.maybeStepBackLeg();
    }
    if (this.backLeg.update(dt, 0) === 'landed') this.backLanded();

    this.feetBlockAnts();

    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.finishCombo();
    }
    this.tickPortrait(dt);
    this.fx.update(dt);
    this.records.update(dt);

    if (this.mode === 'timed' && this.elapsed >= this.timeLimit) this.end();
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

  /** Walking ants turn away instead of walking through a planted boot. */
  feetBlockAnts() {
    for (const leg of [this.foot, this.backLeg]) {
      if (leg.state !== 'planted') continue;
      const fp = leg.footprint(leg.x, leg.y, 0);
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
      if (!leg.isAirborne()) items.push({ y: leg.sortY() + (leg.back ? -0.5 : 0.5), leg });
    }
    items.sort((p, q) => p.y - q.y);
    for (const it of items) {
      if (it.a) drawAnt(ctx, this, it.a);
      else it.leg.draw(ctx, this.assets, this.pressure, this.time);
    }

    this.fx.drawFront(ctx);
    // the raised foot is closest to the camera
    if (foot.isAirborne()) foot.draw(ctx, this.assets, this.pressure, this.time);
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
    const fsOk = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
    $('btn-fs').hidden = !fsOk;
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
    $('over-title').textContent = g.mode === 'timed' ? '时间到！' : '结算';
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

  document.addEventListener('click', (e) => {
    if (e.target.closest?.('button') && ui.shownAt && performance.now() - ui.shownAt < 450) {
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
