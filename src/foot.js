import { clamp, lerp, easeInQuad, easeOutCubic } from './util.js';

// Planted frames share the same sheet column, so one anchor (between toe and
// heel, on the ground line) lines them all up.
const PLANT_ANCHOR_X = 71;
const PLANT_SCALE = 1.25;
const LIFT_SCALE = 1.5;

export const RAISE_TIME = 0.09;
export const STOMP_TIME = 0.075;
export const CHARGE_TIME = 0.85;

/**
 * One leg. States:
 *   planted  - standing on the street
 *   raising  - lifting toward the aim point
 *   hover    - raised, sole facing the street, following the finger
 *   stomping - falling onto the street
 *   grinding - planted and twisting while held
 *   stepping - (back leg) hopping to a new spot
 */
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

  place(x, y) {
    this.x = this.tx = this.hoverX = x;
    this.y = this.ty = this.hoverY = y;
    this.state = 'planted';
  }

  depth() {
    const g = this.game;
    return clamp((this.y - g.bandTop) / (g.bandBot - g.bandTop), 0, 1);
  }

  depthAt(y) {
    const g = this.game;
    return 0.88 + 0.24 * clamp((y - g.bandTop) / (g.bandBot - g.bandTop), 0, 1);
  }

  plantScale(y = this.y) {
    return PLANT_SCALE * this.depthAt(y) * (this.back ? 0.94 : 1);
  }

  hoverHeight(pressure) {
    return 175 + 80 * pressure;
  }

  /** Footprint ellipse (kill zone) for a planted foot at x, y. */
  footprint(x = this.x, y = this.y, pressure = 0.5) {
    const s = this.plantScale(y);
    return {
      x: x,
      y: y - 14 * s,
      rx: (62 + 26 * pressure) * s,
      ry: (16 + 7 * pressure) * s,
      heelX: x + (141 - PLANT_ANCHOR_X) * s,
      heelY: y - (242 - 208) * s,
      heelR: 9 * s,
    };
  }

  /**
   * Area that starts a grind: the boot and leg *above the street*. Touches on
   * the street itself always aim a stomp, so rapid tapping never turns into
   * an accidental grind.
   */
  hitBox() {
    const s = this.plantScale();
    return { x0: this.x - 70 * s, x1: this.x + 85 * s, y0: 0, y1: this.game.bandTop - 4 };
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
  update(dt, pressure) {
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
        if (this.t >= 0.24) {
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
    if (this.state === 'stepping') return lerp(this.fromY, this.ty, this.t / 0.24);
    return this.y;
  }

  isAirborne() {
    return this.state === 'raising' || this.state === 'hover' || this.state === 'stomping';
  }

  draw(ctx, assets, pressure, time) {
    const { img, dark, meta } = assets;
    switch (this.state) {
      case 'planted':
      case 'grinding': {
        let name = 'stand_0';
        let wob = 0;
        if (this.state === 'grinding') {
          const f = Math.floor(this.grindT / 0.11) % 4;
          name = f === 1 || f === 2 ? 'twist_0' : 'stand_0';
          wob = Math.sin(this.grindT * 40) * 2.5;
        } else if (!this.back) {
          // tiny idle sway between near-identical frames
          const f = Math.floor(time * 2.2) % 6;
          name = f === 5 ? 'stand_2' : 'stand_0';
        }
        const s = this.plantScale();
        const sq = 1 - this.squash * 0.04;
        drawPlanted(ctx, this.back ? dark[name] : img[name], meta[name], this.x + wob, this.y, s, sq);
        break;
      }
      case 'stepping': {
        const k = clamp(this.t / 0.24, 0, 1);
        const x = lerp(this.fromX, this.tx, easeOutCubic(k));
        const y = lerp(this.fromY, this.ty, k) - Math.sin(k * Math.PI) * 46;
        drawPlanted(ctx, dark.stand_0, meta.stand_0, x, y, this.plantScale(lerp(this.fromY, this.ty, k)), 1);
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
        const ps = this.plantScale(this.hoverY);
        const s = lerp(ps * 1.02, ps * LIFT_SCALE / PLANT_SCALE * 1.25, lift);
        const tremble = this.state === 'hover' ? pressure * pressure * 3 : 0;
        const fromX = this.state === 'raising' ? lerp(this.fromX, this.hoverX, easeOutCubic(clamp(this.t / RAISE_TIME, 0, 1))) : this.hoverX;
        const sx = fromX + (Math.random() - 0.5) * tremble;
        // sole centre sits above the aim point; on landing it reaches the
        // height the sole has in the planted pose
        const groundSole = this.hoverY - 12 * ps;
        const sy = lerp(groundSole, this.hoverY - this.hoverHeight(pressure), lift) + (Math.random() - 0.5) * tremble;
        drawLifted(ctx, img[name], m, sx, sy, s);
        break;
      }
      default:
        break;
    }
  }
}

function drawShaft(ctx, image, m, dx, dy, s) {
  // stretch a thin slice from near the top of the boot up past the screen edge
  const top = -40;
  const sliceY = 6;
  const destBottom = dy + (sliceY + 2) * s;
  if (destBottom > top) {
    ctx.drawImage(image, 0, sliceY, m.w, 3, dx, top, m.w * s, destBottom - top);
  }
}

function drawPlanted(ctx, image, m, x, y, s, squashY) {
  const ay = m.toe ? m.toe[2] : m.h;
  const dx = x - PLANT_ANCHOR_X * s;
  const h = m.h * s * squashY;
  const dy = y - ay * s * squashY;
  drawShaft(ctx, image, m, dx, dy, s);
  ctx.drawImage(image, dx, dy, m.w * s, h);
}

function drawLifted(ctx, image, m, x, y, s) {
  const [sx, sy] = m.sole;
  const dx = x - sx * s;
  const dy = y - sy * s;
  drawShaft(ctx, image, m, dx, dy, s);
  ctx.drawImage(image, dx, dy, m.w * s, m.h * s);
}
