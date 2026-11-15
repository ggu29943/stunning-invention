import { clamp, lerp, easeInQuad, easeOutCubic } from './util.js';

// Sprites come from assets/sprites/hd (see tools/extract_hd.py). Each frame has
// landmarks in sprite pixels: toe [x0, x1, groundY], heel [x, y] (stiletto
// tip), sole [x, y] (centre of the red sole), shaft [x0, x1, row] (leg width
// near the top edge, used to extend the leg off-screen).
//
// All frames were drawn at the same scale on the artist's canvas, so one
// sprite->world factor (from stand_0's sole length) is used for every frame;
// per-frame normalisation would distort the lifted frames, whose diagonal
// shafts measure wider. game.soleLen is the on-screen sole length (logical px)
// of a planted boot at middle depth.

export const RAISE_TIME = 0.09;
export const STOMP_TIME = 0.075;
export const STEP_TIME = 0.26;
export const CHARGE_TIME = 0.85;
// The raised boot's pose is picked by height zone, as in the video, in both
// controls. Near the street (below FOLLOW_SIDE px) it is side-on (stand_0); in
// the air the lowest third shows the cocked-back red sole (lift_1, 05), the
// middle third the flatter sole angled down (lift_2, 09), the top third the
// toe-down lift (lift_0, 01). The stomp control's charge raises the boot
// through the zones.
const FOLLOW_SIDE = 6;
export const ZONE_FRAMES = ['lift_1', 'lift_2', 'lift_0'];
// The back leg shifts weight as the front boot presses down or grinds (both
// share the same zones: stand_1 -> twist_0 -> twist_1 at the kill line); its
// toe always stays planted, so she never stands on one foot.
export const BACK_POSES = ['stand_1', 'twist_0', 'twist_1'];

const LIFT_MULT = 1.32; // raised foot is closer to the camera

const soleLen = (m) => m.heel[0] - m.toe[0];

export class Leg {
  constructor(game, back = false) {
    this.game = game;
    this.back = back;
    this.state = 'planted';
    this.x = 0;
    this.y = 0;
    this.tx = 0;
    this.ty = 0;
    this.t = 0;
    this.fromX = 0;
    this.fromY = 0;
    this.hoverX = 0;
    this.hoverY = 0;
    this.grindT = 0;
    this.squash = 0;
    this.h = 0; // height of the boot's lowest point above the street
    this.zone = 0; // which ZONE_FRAMES pose is showing
    this.hMax = 300; // tallest height (sets the zones)
    this.dropFrom = 0; // stomp control: height the stomp falls from
    this.grindingT = 0; // drag control: >0 while the pressed boot is being slid (a grind)
  }

  /** Drag control: pick the height zone, with a little hysteresis at each border. */
  updateZone() {
    const third = this.hMax / 3;
    const raw = Math.max(0, Math.min(2, Math.floor(this.h / third)));
    if (raw !== this.zone) {
      const border = raw > this.zone ? third * raw : third * this.zone;
      if (Math.abs(this.h - border) > 6 || Math.abs(raw - this.zone) > 1) this.zone = raw;
    }
  }

  /** Tallest height for a boot over street depth y: its lowest point stays below ~42% of the screen. */
  hMaxAt(y) {
    return Math.max(90, y - this.game.H * 0.42);
  }

  /**
   * Stomp control: charging raises the boot from the low zone (p 0, still
   * clearly off the street) to the top one (p 1); each pose holds for about
   * a third of the charge.
   */
  chargeHeight(pressure, y) {
    return this.hMaxAt(y) * (0.12 + 0.83 * clamp(pressure, 0, 1));
  }

  /** Sprite scale of a lifted pose (grows as it rises toward the camera). */
  zoneScale(name, h = this.h, y = this.y) {
    const lift = clamp((h - FOLLOW_SIDE) / (this.hMax * 0.6), 0, 1);
    return this.frameScale(name, y) * lerp(1.02, LIFT_MULT, lift);
  }

  /**
   * Where a lifted pose is drawn: its foot centre lined up with the standing
   * boot's foot centre over x (no sideways jump when it lands), lowest point
   * h above the street at depth y.
   */
  zoneOrigin(name, x = this.x, y = this.y, h = this.h) {
    const m = this.meta[name];
    const s = this.zoneScale(name, h, y);
    const st = this.meta.stand_0;
    const off = (st.footc[0] - (st.toe[0] + st.heel[0]) / 2) * this.frameScale('stand_0', y);
    return { m, s, dx: x + off - m.footc[0] * s, dy: y - h - m.toe[2] * s };
  }

  /** Draw the boot lifted h above the street at (x, y): side-on near it, else the zone's pose. */
  drawLifted(ctx, assets, x, y, h, squash = 1, wob = 0, side = 'stand_0') {
    const { img, meta } = assets;
    if (h < FOLLOW_SIDE) {
      drawPlanted(ctx, img[side], meta[side], x + wob, y - h, this.frameScale(side, y), squash);
      return;
    }
    const name = ZONE_FRAMES[this.zone];
    const { m, s, dx, dy } = this.zoneOrigin(name, x, y, h);
    drawSprite(ctx, img[name], m, dx, dy, s);
    if (name !== 'lift_0') drawSmears(ctx, this.game.sticky, m, dx, dy, s);
  }

  get meta() {
    return this.game.assets.meta;
  }

  place(x, y) {
    this.h = 0;
    this.zone = 0;
    this.x = this.tx = this.hoverX = x;
    this.y = this.ty = this.hoverY = y;
    this.state = 'planted';
  }

  /** Perspective factor: further up the street = smaller. */
  depthAt(y) {
    const g = this.game;
    return (0.86 + 0.26 * clamp((y - g.bandTop) / (g.bandBot - g.bandTop), 0, 1)) * (this.back ? 0.94 : 1);
  }

  /** On-screen sole length of a planted boot standing at y. */
  soleAt(y = this.y) {
    return this.game.soleLen * this.depthAt(y);
  }

  /** Sprite -> world scale (same for every frame), for a boot standing at y. */
  frameScale(name, y = this.y) {
    return this.soleAt(y) / soleLen(this.meta.stand_0);
  }



  /** Footprint ellipse (kill zone) plus the stiletto tip, for a boot at x, y. */
  footprint(x = this.x, y = this.y, pressure = 0.5) {
    const L = this.soleAt(y);
    const rx = (L / 2) * (0.8 + 0.3 * pressure);
    const ry = rx * 0.24;
    const m = this.meta.stand_0;
    const s = this.frameScale('stand_0', y);
    const ax = (m.toe[0] + m.heel[0]) / 2;
    return {
      x,
      y: y - ry * 0.35,
      rx,
      ry,
      heelX: x + (m.heel[0] - ax) * s,
      heelY: y + (m.heel[1] - m.toe[2]) * s,
      heelR: Math.max(7, L * 0.045),
    };
  }

  /**
   * Area that starts a grind: the boot and leg *above the street*. Touches on
   * the street itself always aim a stomp, so rapid tapping never turns into
   * an accidental grind.
   */
  hitBox() {
    // the drawn leg (shaft of stand_0) plus some finger slop
    const m = this.meta.stand_0;
    const s = this.frameScale('stand_0');
    const ax = (m.toe[0] + m.heel[0]) / 2;
    const pad = this.soleAt() * 0.15;
    return {
      x0: this.x + (m.shaft[0] - ax) * s - pad,
      x1: this.x + (m.shaft[1] - ax) * s + pad,
      y0: 0,
      y1: this.game.bandTop - 4,
    };
  }

  raise(tx, ty) {
    this.fromX = this.x;
    this.fromY = this.y;
    this.tx = tx;
    this.ty = ty;
    this.hoverX = tx;
    this.hoverY = ty;
    this.state = 'raising';
    this.t = 0;
    this.h = 0;
    this.zone = 0;
  }

  aim(tx, ty) {
    this.tx = tx;
    this.ty = ty;
  }

  stomp() {
    if (this.state !== 'hover' && this.state !== 'raising') return false;
    this.state = 'stomping';
    this.t = 0;
    this.dropFrom = this.h;
    return true;
  }

  /**
   * Drag control: the boot follows the finger. The game sets x and h (sole
   * height above the street at depth y) every frame.
   */
  follow() {
    if (this.state !== 'planted' && this.state !== 'follow') return false;
    if (this.state === 'planted') this.h = 0;
    this.state = 'follow';
    return true;
  }

  /**
   * Drag control: a point on the boot's underside (frac -1..1 = left..right
   * along the sole), where the sticky strands are drawn from. Side-on it is
   * the bottom edge; in the sole view it is on the red sole itself.
   */
  underside(frac) {
    const h = this.h;
    const name = ZONE_FRAMES[this.zone];
    if (this.state === 'follow' && h >= FOLLOW_SIDE && name !== 'lift_0') {
      const { m, s, dx, dy } = this.zoneOrigin(name);
      let [ux, uy, a, b] = m.soleAxis;
      if (ux < 0) {
        ux = -ux;
        uy = -uy;
      }
      // a little below the axis, toward the sole's lower edge
      const px = m.sole[0] + ux * a * frac * 0.7 - uy * b * 0.35;
      const py = m.sole[1] + uy * a * frac * 0.7 + ux * b * 0.35;
      return [dx + px * s, dy + py * s];
    }
    return [this.x + frac * this.soleAt() * 0.4, this.y - h - 1];
  }

  /** Drag control: a following boot that is clearly in the air is drawn above the ants. */
  drawOnTop() {
    return this.isAirborne() || (this.state === 'follow' && this.h >= FOLLOW_SIDE);
  }

  stepTo(x, y) {
    this.fromX = this.x;
    this.fromY = this.y;
    this.tx = x;
    this.ty = y;
    this.state = 'stepping';
    this.t = 0;
  }

  /** Returns 'landed' on the frame a stomp or step touches the ground. */
  update(dt, pressure = 0) {
    this.t += dt;
    if (this.squash > 0) this.squash = Math.max(0, this.squash - dt * 6);
    switch (this.state) {
      case 'raising': {
        const k = Math.min(1, dt * 22);
        this.hoverX = lerp(this.hoverX, this.tx, k);
        this.hoverY = lerp(this.hoverY, this.ty, k);
        this.hMax = this.hMaxAt(this.hoverY);
        this.h = this.chargeHeight(pressure, this.hoverY) * easeOutCubic(clamp(this.t / RAISE_TIME, 0, 1));
        this.updateZone();
        if (this.t >= RAISE_TIME) {
          this.state = 'hover';
          this.t = 0;
        }
        break;
      }
      case 'hover': {
        const k = Math.min(1, dt * 18);
        this.hoverX = lerp(this.hoverX, this.tx, k);
        this.hoverY = lerp(this.hoverY, this.ty, k);
        // charging lifts the boot up through the pose zones
        this.hMax = this.hMaxAt(this.hoverY);
        this.h += (this.chargeHeight(pressure, this.hoverY) - this.h) * Math.min(1, dt * 16);
        this.updateZone();
        break;
      }
      case 'stomping': {
        const k = Math.min(1, dt * 30);
        this.hoverX = lerp(this.hoverX, this.tx, k);
        this.hoverY = lerp(this.hoverY, this.ty, k);
        // falls back down through the zones
        this.h = this.dropFrom * (1 - easeInQuad(clamp(this.t / STOMP_TIME, 0, 1)));
        this.updateZone();
        if (this.t >= STOMP_TIME) {
          this.x = this.tx;
          this.y = this.ty;
          this.h = 0;
          this.zone = 0;
          this.state = 'planted';
          this.squash = 1;
          return 'landed';
        }
        break;
      }
      case 'stepping': {
        if (this.t >= STEP_TIME) {
          this.x = this.tx;
          this.y = this.ty;
          this.state = 'planted';
          this.squash = 0.6;
          return 'landed';
        }
        break;
      }
      case 'grinding':
        this.grindT += dt;
        break;
      default:
        break;
    }
    return null;
  }

  /** y used for depth sorting with the ants. Raised legs are drawn on top. */
  sortY() {
    if (this.state === 'stepping') return lerp(this.fromY, this.ty, clamp(this.t / STEP_TIME, 0, 1));
    return this.y;
  }

  isAirborne() {
    return this.state === 'raising' || this.state === 'hover' || this.state === 'stomping';
  }

  draw(ctx, assets, pressure) {
    const { img, dark, meta } = assets;
    const pick = (name) => (this.back ? dark[name] || img[name] : img[name]);
    switch (this.state) {
      case 'planted':
      case 'grinding': {
        let name = this.back ? 'stand_1' : 'stand_0';
        let wob = 0;
        if (this.state === 'grinding') {
          const f = Math.floor(this.grindT / 0.11) % 4;
          name = f === 1 || f === 2 ? 'twist_0' : 'stand_0';
          wob = Math.sin(this.grindT * 40) * 2.5;
        }
        const s = this.frameScale(name);
        if (this.back) {
          // the back leg shifts its weight while the front boot presses (drag
          // control); every pose keeps its toe tip planted on the same spot
          const pose = BACK_POSES[this.game.backPose ? this.game.backPose() : 0];
          const ref = meta.stand_1;
          const tipX = this.x - ((ref.toe[0] + ref.heel[0]) / 2 - ref.toe[0]) * s;
          const m = meta[pose];
          const sy = 1 - this.squash * 0.035;
          drawSprite(ctx, pick(pose), m, tipX - m.toe[0] * s, this.y - m.toe[2] * s * sy, s, sy);
          break;
        }
        drawPlanted(ctx, pick(name), meta[name], this.x + wob, this.y, s, 1 - this.squash * 0.035);
        break;
      }
      case 'follow': {
        // on the street it compresses and trembles with pressure; slid, it
        // grinds with the same twist as the stomp control's grind
        const onGround = this.h <= 0.01;
        let wob = onGround ? (Math.random() - 0.5) * pressure * pressure * 2.2 : 0;
        let side = 'stand_0';
        if (onGround && this.grindingT > 0) {
          const f = Math.floor(this.grindT / 0.11) % 4;
          side = f === 1 || f === 2 ? 'twist_0' : 'stand_0';
          wob += Math.sin(this.grindT * 40) * 2.5;
        }
        const squash = onGround ? 1 - pressure * 0.07 - this.squash * 0.035 : 1;
        this.drawLifted(ctx, assets, this.x, this.y, this.h, squash, wob, side);
        break;
      }
      case 'stepping': {
        // back leg hops: toe-down frame along an arc, then plants
        const k = clamp(this.t / STEP_TIME, 0, 1);
        const x = lerp(this.fromX, this.tx, easeOutCubic(k));
        const yGround = lerp(this.fromY, this.ty, k);
        // toe is back on the ground exactly when the frame switches to stand_1
        const lift = Math.sin(Math.min(1, k / 0.85) * Math.PI);
        const name = k < 0.85 ? 'lift_0' : 'stand_1';
        const s = this.frameScale(name, yGround);
        if (name === 'lift_0') {
          const m = meta.lift_0;
          // anchor on the toe tip, which leaves/meets the ground
          const tipX = m.toe[0];
          const dx = x - (soleLen(meta.stand_1) * this.frameScale('stand_1', yGround)) / 2 - tipX * s;
          const dy = yGround - lift * 60 * (this.game.soleLen / 205) - m.toe[2] * s;
          drawSprite(ctx, pick(name), m, dx, dy, s);
        } else {
          drawPlanted(ctx, pick(name), meta[name], x, yGround - lift * 20, s, 1);
        }
        break;
      }
      case 'raising':
      case 'hover':
      case 'stomping': {
        // same height zones as the drag control; charging trembles the boot
        const baseX =
          this.state === 'raising'
            ? lerp(this.fromX, this.hoverX, easeOutCubic(clamp(this.t / RAISE_TIME, 0, 1)))
            : this.hoverX;
        const tremble = this.state === 'hover' ? pressure * pressure * 3 : 0;
        const x = baseX + (Math.random() - 0.5) * tremble;
        const y = this.hoverY + (Math.random() - 0.5) * tremble * 0.5;
        this.drawLifted(ctx, assets, x, y, this.h);
        break;
      }
      default:
        break;
    }
  }
}

/**
 * Draw a boot sprite with its top at dy. The leg is continued upward by
 * stretching the shaft row (the first row that is solid edge to edge, see
 * tools/extract_hd.py) to above the screen; everything above that row in the
 * sprite (the wavy hand-cut top) is replaced by the stretched row, so the
 * leg never looks hollow or notched.
 */
function drawSprite(ctx, image, m, dx, dy, s, sy = 1) {
  const top = -40;
  const row = m.shaft[2];
  // Start the sprite two rows below the stretched row: filtering at a drawImage
  // edge samples the source row above it, and the rows above `row` are the dark
  // hand-cut outline (a 1 px dark seam line otherwise, most visible on the back leg).
  const cut = row + 2;
  const yCut = dy + cut * s * sy;
  if (yCut > top) ctx.drawImage(image, 0, row, m.w, 2, dx, top, m.w * s, yCut - top + 1);
  ctx.drawImage(image, 0, cut, m.w, m.h - cut, dx, yCut, m.w * s, (m.h - cut) * s * sy);
}

/**
 * Squashed ants stuck to the red sole (drag control's sticky mechanic),
 * painted in the sole's own frame: u along its long axis, v across it.
 */
function drawSmears(ctx, sticky, m, dx, dy, s) {
  if (!sticky || !sticky.smears.length || !m.soleAxis) return;
  const [ux, uy, a, b] = m.soleAxis;
  const base = ctx.globalAlpha;
  for (const sm of sticky.smears) {
    const px = m.sole[0] + ux * a * sm.u * 0.8 - uy * b * sm.v * 0.7;
    const py = m.sole[1] + uy * a * sm.u * 0.8 + ux * b * sm.v * 0.7;
    const x = dx + px * s;
    const y = dy + py * s;
    const r = sm.r * s;
    ctx.globalAlpha = base * clamp(sm.life / 1.5, 0, 1) * 0.92;
    ctx.fillStyle = '#16050a';
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.6, r, Math.atan2(uy, ux), 0, Math.PI * 2);
    ctx.fill();
    // a few splayed legs
    ctx.strokeStyle = '#16050a';
    ctx.lineWidth = Math.max(0.8, r * 0.25);
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const ang = sm.seed + i * 1.7;
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(ang) * r * 2.4, y + Math.sin(ang) * r * 1.4);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = base;
}

function drawPlanted(ctx, image, m, x, y, s, squashY) {
  const ax = (m.toe[0] + m.heel[0]) / 2;
  const ay = m.toe[2];
  drawSprite(ctx, image, m, x - ax * s, y - ay * s * squashY, s, squashY);
}
