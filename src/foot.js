import { clamp, lerp, easeInQuad, easeOutCubic } from './util.js';

// Sprites come from assets/sprites/hd (see tools/extract_hd.py). Each frame has
// landmarks in sprite pixels: toe [x0, x1, groundY], heel [x, y] (stiletto
// tip), sole [x, y] (centre of the red sole), shaft [x0, x1, row] (leg width
// near the top edge, used to extend the leg off-screen).
//
// Frames were drawn at slightly different sizes, so every frame is normalised
// to stand_0: planted frames by sole length (toe tip -> heel tip), lifted
// frames by shaft width. game.soleLen is the on-screen sole length (logical
// px) of a planted boot at middle depth.

export const RAISE_TIME = 0.09;
export const STOMP_TIME = 0.075;
export const STEP_TIME = 0.26;
export const CHARGE_TIME = 0.85;

const LIFT_MULT = 1.32; // raised foot is closer to the camera

const soleLen = (m) => m.heel[0] - m.toe[0];
const shaftW = (m) => m.shaft[1] - m.shaft[0];

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

  /** Sprite -> world scale for a frame, for a boot standing at y. */
  frameScale(name, y = this.y) {
    const meta = this.meta;
    const ref = meta.stand_0;
    const m = meta[name];
    const base = this.soleAt(y) / soleLen(ref);
    if (name.startsWith('lift')) return base * (shaftW(ref) / shaftW(m));
    return base * (soleLen(ref) / soleLen(m));
  }

  hoverHeight(pressure) {
    return (150 + 70 * pressure) * (this.game.soleLen / 205);
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
    const L = this.soleAt();
    return { x0: this.x - L * 0.6, x1: this.x + L * 0.65, y0: 0, y1: this.game.bandTop - 4 };
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

  stepTo(x, y) {
    this.fromX = this.x;
    this.fromY = this.y;
    this.tx = x;
    this.ty = y;
    this.state = 'stepping';
    this.t = 0;
  }

  /** Returns 'landed' on the frame a stomp or step touches the ground. */
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
        drawPlanted(ctx, pick(name), meta[name], this.x + wob, this.y, s, 1 - this.squash * 0.035);
        break;
      }
      case 'stepping': {
        // back leg hops: toe-down frame along an arc, then plants
        const k = clamp(this.t / STEP_TIME, 0, 1);
        const x = lerp(this.fromX, this.tx, easeOutCubic(k));
        const yGround = lerp(this.fromY, this.ty, k);
        const lift = Math.sin(k * Math.PI);
        const name = k < 0.85 ? 'lift_0' : 'stand_1';
        const s = this.frameScale(name, yGround);
        if (name === 'lift_0') {
          const m = meta.lift_0;
          // anchor on the toe tip, which leaves/meets the ground
          const tipX = m.toe[0];
          const dx = x - (soleLen(meta.stand_1) * this.frameScale('stand_1', yGround)) / 2 - tipX * s;
          const dy = yGround - lift * 60 * (this.game.soleLen / 205) - m.toe[2] * s;
          drawShaft(ctx, pick(name), m, dx, dy, s);
          ctx.drawImage(pick(name), dx, dy, m.w * s, m.h * s);
        } else {
          drawPlanted(ctx, pick(name), meta[name], x, yGround - lift * 20, s, 1);
        }
        break;
      }
      case 'raising':
      case 'hover':
      case 'stomping': {
        let lift = 1;
        if (this.state === 'raising') lift = easeOutCubic(clamp(this.t / RAISE_TIME, 0, 1));
        if (this.state === 'stomping') lift = 1 - easeInQuad(clamp(this.t / STOMP_TIME, 0, 1));
        const name = pressure >= 0.6 ? 'lift_1' : 'lift_2';
        const m = meta[name];
        const sGround = this.frameScale(name, this.hoverY);
        const s = sGround * lerp(1.02, LIFT_MULT, lift);
        const tremble = this.state === 'hover' ? pressure * pressure * 3 : 0;
        const baseX =
          this.state === 'raising'
            ? lerp(this.fromX, this.hoverX, easeOutCubic(clamp(this.t / RAISE_TIME, 0, 1)))
            : this.hoverX;
        // On landing the sole centre sits where it is in the planted pose.
        const st = meta.stand_0;
        const soleAbove = (st.toe[2] - st.sole[1]) * this.frameScale('stand_0', this.hoverY) * 0.6;
        const groundSole = this.hoverY - soleAbove;
        const sx = baseX + (Math.random() - 0.5) * tremble;
        const sy = lerp(groundSole, this.hoverY - this.hoverHeight(pressure), lift) + (Math.random() - 0.5) * tremble;
        const dx = sx - m.sole[0] * s;
        const dy = sy - m.sole[1] * s;
        drawShaft(ctx, img[name], m, dx, dy, s);
        ctx.drawImage(img[name], dx, dy, m.w * s, m.h * s);
        break;
      }
      default:
        break;
    }
  }
}

/**
 * Continue the leg above the sprite's top edge (when the boot does not reach
 * the top of the screen) by stretching a thin slice of the shaft upward.
 */
function drawShaft(ctx, image, m, dx, dy, s) {
  const top = -40;
  const row = m.shaft ? m.shaft[2] : 4;
  const destBottom = dy + (row + 2) * s;
  if (destBottom > top) {
    ctx.drawImage(image, 0, row, m.w, 3, dx, top, m.w * s, destBottom - top);
  }
}

function drawPlanted(ctx, image, m, x, y, s, squashY) {
  const ax = (m.toe[0] + m.heel[0]) / 2;
  const ay = m.toe[2];
  const dx = x - ax * s;
  const dy = y - ay * s * squashY;
  drawShaft(ctx, image, m, dx, dy, s);
  ctx.drawImage(image, dx, dy, m.w * s, m.h * s * squashY);
}
