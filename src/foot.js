import { clamp, lerp, easeInQuad, easeOutCubic } from './util.js';

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

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
export const LOWER_TIME = 0.26; // drag control: the boot is set down gently

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
  }

  get meta() {
    return this.game.assets.meta;
  }

  place(x, y) {
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

  hoverHeight(pressure) {
    // sole centre height above the aim point; even at zero pressure the
    // stiletto clears the street by a visible gap
    return (190 + 70 * pressure) * (this.game.soleLen / 205);
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
  }

  aim(tx, ty) {
    this.tx = tx;
    this.ty = ty;
  }

  stomp() {
    if (this.state !== 'hover' && this.state !== 'raising') return false;
    this.state = 'stomping';
    this.t = 0;
    return true;
  }

  /** Drag control: set the raised boot down gently (no impact). */
  lower() {
    if (this.state !== 'hover' && this.state !== 'raising') return false;
    this.state = 'lowering';
    this.t = 0;
    return true;
  }

  stepTo(x, y) {
    this.fromX = this.x;
    this.fromY = this.y;
    this.tx = x;
    this.ty = y;
    this.state = 'stepping';
    this.t = 0;
  }

  /**
   * Returns 'landed' on the frame a stomp or step touches the ground, and
   * 'placed' when a gently lowered boot reaches it (it is then 'pressing').
   */
  update(dt) {
    this.t += dt;
    if (this.squash > 0) this.squash = Math.max(0, this.squash - dt * 6);
    switch (this.state) {
      case 'raising': {
        const k = Math.min(1, dt * 22);
        this.hoverX = lerp(this.hoverX, this.tx, k);
        this.hoverY = lerp(this.hoverY, this.ty, k);
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
        break;
      }
      case 'stomping': {
        const k = Math.min(1, dt * 30);
        this.hoverX = lerp(this.hoverX, this.tx, k);
        this.hoverY = lerp(this.hoverY, this.ty, k);
        if (this.t >= STOMP_TIME) {
          this.x = this.tx;
          this.y = this.ty;
          this.state = 'planted';
          this.squash = 1;
          return 'landed';
        }
        break;
      }
      case 'lowering': {
        const k = Math.min(1, dt * 20);
        this.hoverX = lerp(this.hoverX, this.tx, k);
        this.hoverY = lerp(this.hoverY, this.ty, k);
        if (this.t >= LOWER_TIME) {
          this.x = this.tx;
          this.y = this.ty;
          this.state = 'pressing';
          this.grindT = 0;
          this.squash = 0.25;
          return 'placed';
        }
        break;
      }
      case 'pressing':
        this.grindT += dt;
        break;
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
    return this.state === 'raising' || this.state === 'hover' || this.state === 'stomping' || this.state === 'lowering';
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
        drawPlanted(ctx, pick(name), meta[name], this.x + wob, this.y, s, 1 - this.squash * 0.035);
        break;
      }
      case 'pressing': {
        // planted and pushing down: the boot compresses toward the street and
        // trembles more as the pressure rises
        const s = this.frameScale('stand_0');
        const shake = pressure * pressure * 2.2;
        const wob = (Math.random() - 0.5) * shake;
        const squash = 1 - pressure * 0.07 - this.squash * 0.035;
        drawPlanted(ctx, img.stand_0, meta.stand_0, this.x + wob, this.y, s, squash);
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
      case 'stomping':
      case 'lowering': {
        let lift = 1;
        if (this.state === 'raising') lift = easeOutCubic(clamp(this.t / RAISE_TIME, 0, 1));
        if (this.state === 'stomping') lift = 1 - easeInQuad(clamp(this.t / STOMP_TIME, 0, 1));
        if (this.state === 'lowering') lift = 1 - easeInOut(clamp(this.t / LOWER_TIME, 0, 1));
        const name = pressure >= 0.6 ? 'lift_1' : 'lift_2';
        const m = meta[name];
        const sGround = this.frameScale(name, this.hoverY);
        const s = sGround * lerp(1.02, LIFT_MULT, lift);
        const tremble = this.state === 'hover' ? pressure * pressure * 3 : 0;
        const baseX =
          this.state === 'raising'
            ? lerp(this.fromX, this.hoverX, easeOutCubic(clamp(this.t / RAISE_TIME, 0, 1)))
            : this.hoverX;
        // on landing the lowest point of the lift frame (toe[2]) meets the street
        const groundSole = this.hoverY - (m.toe[2] - m.sole[1]) * s;
        const sx = baseX + (Math.random() - 0.5) * tremble;
        const sy = lerp(groundSole, this.hoverY - this.hoverHeight(pressure), lift) + (Math.random() - 0.5) * tremble;
        const dx = sx - m.sole[0] * s;
        const dy = sy - m.sole[1] * s;
        drawSprite(ctx, img[name], m, dx, dy, s);
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

function drawPlanted(ctx, image, m, x, y, s, squashY) {
  const ax = (m.toe[0] + m.heel[0]) / 2;
  const ay = m.toe[2];
  drawSprite(ctx, image, m, x - ax * s, y - ay * s * squashY, s, squashY);
}
