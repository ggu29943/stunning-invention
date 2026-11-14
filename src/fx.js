import { rand, clamp } from './util.js';

const MAX_PARTICLES = 500;

export class FX {
  constructor() {
    this.parts = [];
    this.texts = [];
    this.rings = [];
    this.shakeT = 0;
    this.shakeAmp = 0;
    this.flash = 0;
    this.decals = null;
    this.decalFade = 0;
  }

  resize(W, H, top, res = 2) {
    this.top = top;
    this.dw = W;
    this.dh = H - top;
    const c = document.createElement('canvas');
    c.width = Math.ceil(W * res);
    c.height = Math.ceil((H - top) * res);
    this.decals = c;
    this.dctx = c.getContext('2d');
    this.dctx.scale(res, res);
  }

  clear() {
    this.parts.length = 0;
    this.texts.length = 0;
    this.rings.length = 0;
    this.shakeT = 0;
    this.flash = 0;
    this.dctx?.clearRect(0, 0, this.decals.width, this.decals.height);
  }

  shake(amp, dur = 0.25) {
    this.shakeAmp = Math.max(this.shakeAmp * (this.shakeT > 0 ? 1 : 0), amp);
    this.shakeT = Math.max(this.shakeT, dur);
  }

  offset() {
    if (this.shakeT <= 0) return [0, 0];
    const a = this.shakeAmp * clamp(this.shakeT / 0.25, 0, 1);
    return [rand(-a, a), rand(-a, a)];
  }

  dust(x, y, power, scale = 1) {
    const n = Math.round((10 + power * 22) * scale);
    for (let i = 0; i < n && this.parts.length < MAX_PARTICLES; i++) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      this.parts.push({
        kind: 'dust',
        x: x + rand(-50, 50) * scale,
        y: y + rand(-6, 6),
        vx: dir * rand(40, 160 + power * 160) * scale,
        vy: rand(-40, -5),
        life: rand(0.35, 0.8),
        age: 0,
        r: rand(4, 10) * scale,
      });
    }
  }

  debris(x, y, n) {
    for (let i = 0; i < n && this.parts.length < MAX_PARTICLES; i++) {
      this.parts.push({
        kind: 'bit',
        x,
        y: y - 3,
        vx: rand(-90, 90),
        vy: rand(-170, -60),
        life: rand(0.4, 0.75),
        age: 0,
        r: rand(1, 2.2),
        floor: y + rand(-2, 4),
      });
    }
  }

  ring(x, y, rx, ry, color = 'rgba(255,255,255,0.9)', life = 0.35) {
    this.rings.push({ x, y, rx, ry, color, life, age: 0 });
  }

  text(x, y, str, { color = '#ffe14f', size = 16, life = 0.9, vy = -40, bold = true } = {}) {
    this.texts.push({ x, y, str, color, size, life, age: 0, vy, bold });
    if (this.texts.length > 60) this.texts.shift();
  }

  /** Permanent (slowly fading) squash mark painted onto the street. */
  splat(x, y, s) {
    const g = this.dctx;
    if (!g) return;
    const ly = y - this.top;
    g.save();
    g.translate(x, ly);
    g.fillStyle = Math.random() < 0.5 ? 'rgba(40, 6, 14, 0.85)' : 'rgba(20, 8, 24, 0.9)';
    g.beginPath();
    g.ellipse(0, 0, 4.5 * s, 2 * s, rand(-0.3, 0.3), 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.ellipse(rand(-8, 8) * s, rand(-2.5, 2.5) * s, rand(0.6, 1.6) * s, rand(0.4, 0.9) * s, 0, 0, Math.PI * 2);
      g.fill();
    }
    // a couple of stray legs
    g.strokeStyle = 'rgba(10, 4, 14, 0.9)';
    g.lineWidth = 0.7;
    g.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = rand(0, Math.PI * 2);
      g.moveTo(0, 0);
      g.lineTo(Math.cos(a) * 6 * s, Math.sin(a) * 2.5 * s);
    }
    g.stroke();
    g.restore();
  }

  /** Cracked asphalt for full-power stomps. */
  crack(x, y, size) {
    const g = this.dctx;
    if (!g) return;
    g.save();
    g.translate(x, y - this.top);
    g.strokeStyle = 'rgba(8, 4, 12, 0.75)';
    g.lineWidth = 1.2;
    for (let i = 0; i < 7; i++) {
      let a = rand(0, Math.PI * 2);
      let px = 0;
      let py = 0;
      g.beginPath();
      g.moveTo(px, py);
      const len = rand(0.5, 1) * size;
      for (let k = 0; k < 4; k++) {
        a += rand(-0.6, 0.6);
        px += Math.cos(a) * len / 4;
        py += Math.sin(a) * len / 4 * 0.3;
        g.lineTo(px, py);
      }
      g.stroke();
    }
    g.restore();
  }

  update(dt) {
    if (this.shakeT > 0) this.shakeT -= dt;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3);
    for (const p of this.parts) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'dust') {
        p.vx *= Math.pow(0.04, dt);
        p.vy *= Math.pow(0.2, dt);
        p.r += dt * 18;
      } else {
        p.vy += 520 * dt;
        if (p.y > p.floor) {
          p.y = p.floor;
          p.vy *= -0.3;
          p.vx *= 0.5;
        }
      }
    }
    this.parts = this.parts.filter((p) => p.age < p.life);
    for (const t of this.texts) {
      t.age += dt;
      t.y += t.vy * dt;
      t.vy *= Math.pow(0.15, dt);
    }
    this.texts = this.texts.filter((t) => t.age < t.life);
    for (const r of this.rings) r.age += dt;
    this.rings = this.rings.filter((r) => r.age < r.life);

    // slowly wash the street clean
    this.decalFade += dt;
    if (this.decalFade > 2 && this.dctx) {
      this.decalFade = 0;
      const g = this.dctx;
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = 'rgba(0,0,0,0.05)';
      g.fillRect(0, 0, this.decals.width, this.decals.height);
      g.globalCompositeOperation = 'source-over';
    }
  }

  drawDecals(ctx) {
    if (this.decals) ctx.drawImage(this.decals, 0, this.top, this.dw, this.dh);
  }

  drawBack(ctx) {
    for (const r of this.rings) {
      const k = r.age / r.life;
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 3 * (1 - k) + 1;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.rx * (0.6 + k * 0.8), r.ry * (0.6 + k * 0.8), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawFront(ctx) {
    for (const p of this.parts) {
      const k = p.age / p.life;
      if (p.kind === 'dust') {
        ctx.globalAlpha = 0.45 * (1 - k);
        ctx.fillStyle = '#b7a2c8';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.globalAlpha = 1 - k * k;
        ctx.fillStyle = '#0c0610';
        ctx.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r);
      }
    }
    ctx.globalAlpha = 1;
  }

  drawTexts(ctx) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      const k = t.age / t.life;
      const pop = t.age < 0.08 ? 0.6 + (t.age / 0.08) * 0.6 : 1.2 - Math.min(0.2, (t.age - 0.08) * 2);
      ctx.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      ctx.font = `${t.bold ? '900' : '600'} ${Math.round(t.size * pop)}px ui-monospace, "SF Mono", Menlo, "PingFang SC", "Microsoft YaHei", monospace`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(20, 6, 26, 0.9)';
      ctx.strokeText(t.str, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, t.x, t.y);
    }
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'alphabetic';
  }
}
