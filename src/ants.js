import { clamp, rand, chance, ellipseDist } from './util.js';
import * as sfx from './audio.js';

const MAX_ANTS = 240;
let nextId = 1;

export class Swarm {
  constructor(game) {
    this.game = game;
    this.ants = [];
    this.spawnAcc = 0;
    this.crowdTimer = 3;
    this.escaped = 0;
  }

  reset() {
    this.ants.length = 0;
    this.spawnAcc = 0;
    this.crowdTimer = 2.5;
    this.escaped = 0;
    // start with a crowd already on the crossing
    const { W } = this.game;
    for (let i = 0; i < 45; i++) this.spawn(rand(40, W - 40), chance(0.5) ? 1 : -1);
  }

  spawn(x, dir, depth = Math.random()) {
    if (this.ants.length >= MAX_ANTS) return null;
    const g = this.game;
    const a = {
      id: nextId++,
      x,
      y: g.bandTop + 6 + depth * (g.bandBot - g.bandTop - 10),
      dir,
      vx: 0,
      vy: 0,
      speed: rand(20, 36),
      size: rand(0.85, 1.3),
      state: 'walk',
      phase: rand(0, 10),
      panicT: 0,
      stunT: 0,
      scream: 0,
      wounded: false,
      crumb: chance(0.14),
      wander: rand(0, 10),
    };
    this.ants.push(a);
    return a;
  }

  /** Spawns a clump of ants entering from one side. */
  crowd(n) {
    const g = this.game;
    const side = chance(0.5) ? -1 : 1;
    const depth = Math.random();
    for (let i = 0; i < n; i++) {
      const x = side < 0 ? -10 - rand(0, 160) : g.W + 10 + rand(0, 160);
      this.spawn(x, -side, clamp(depth + rand(-0.35, 0.35), 0, 1));
    }
  }

  update(dt, threat) {
    const g = this.game;
    const t = g.elapsed;
    // continuous trickle that ramps up, plus periodic crowds
    const rate = (2.6 + Math.min(6, t * 0.07)) * (g.W / 1000);
    this.spawnAcc += rate * dt;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      const dir = chance(0.5) ? 1 : -1;
      this.spawn(dir > 0 ? -10 : g.W + 10, dir);
    }
    this.crowdTimer -= dt;
    if (this.crowdTimer <= 0) {
      this.crowdTimer = rand(7, 12);
      this.crowd(10 + Math.min(40, Math.floor(t * 0.35)));
    }

    const top = g.bandTop + 4;
    const bot = g.bandBot - 2;
    const out = [];
    for (const a of this.ants) {
      a.phase += dt * (a.state === 'panic' ? 26 : a.wounded ? 5 : 14);
      if (a.scream > 0) a.scream -= dt;

      if (a.state === 'stun') {
        a.stunT -= dt;
        if (a.stunT <= 0) this.panic(a, a.x - a.dir * 50, a.y, false);
        continue;
      }

      if (threat && !a.wounded && a.state === 'walk') {
        // ants notice the shadow gradually, so a charged stomp still lands
        const d = ellipseDist(a.x, a.y, threat.x, threat.y, threat.rx * 1.3, threat.ry * 1.8);
        if (d < 1 && Math.random() < dt * 2.2) this.panic(a, threat.x, threat.y, true);
      }

      if (a.state === 'panic') {
        a.panicT -= dt;
        a.x += a.vx * dt;
        a.y += a.vy * dt;
        if (a.y < top || a.y > bot) a.vy *= -0.5;
        if (a.panicT <= 0) {
          a.state = 'walk';
          a.dir = a.vx >= 0 ? 1 : -1;
          a.speed = rand(26, 40);
        }
      } else {
        const sp = a.wounded ? 7 : a.speed;
        a.x += a.dir * sp * dt;
        a.wander += dt;
        a.y += Math.sin(a.wander * 1.3 + a.id) * 4 * dt;
      }
      a.y = clamp(a.y, top, bot);

      if (a.x < -200 || a.x > g.W + 200 || (a.x < -14 && a.dir < 0 && a.state === 'walk') || (a.x > g.W + 14 && a.dir > 0 && a.state === 'walk')) {
        out.push(a);
      }
    }
    if (out.length) {
      this.escaped += out.length;
      const gone = new Set(out);
      this.ants = this.ants.filter((a) => !gone.has(a));
    }
  }

  panic(a, fromX, fromY, scream) {
    if (a.state !== 'panic' && scream) {
      a.scream = 1.1;
      if (chance(0.35)) sfx.squeak();
    }
    a.state = 'panic';
    a.panicT = rand(1.0, 1.8);
    let dx = a.x - fromX;
    let dy = (a.y - fromY) * 3;
    if (Math.abs(dx) < 1) dx = chance(0.5) ? 1 : -1;
    const len = Math.hypot(dx, dy) || 1;
    const sp = rand(55, 85);
    a.vx = (dx / len) * sp;
    a.vy = (dy / len) * sp * 0.3;
    a.dir = a.vx >= 0 ? 1 : -1;
  }

  stun(a, dur) {
    a.state = 'stun';
    a.stunT = dur;
  }

  /** Ants inside an ellipse, with their normalised distance. */
  query(cx, cy, rx, ry, maxD = 1) {
    const hits = [];
    for (const a of this.ants) {
      const d = ellipseDist(a.x, a.y, cx, cy, rx, ry);
      if (d < maxD) hits.push({ a, d });
    }
    return hits;
  }

  remove(list) {
    if (!list.length) return;
    const gone = new Set(list);
    this.ants = this.ants.filter((a) => !gone.has(a));
  }
}

/** Scale of an ant at a given screen y (further away = smaller). */
export function depthScale(g, y) {
  return 0.8 + 0.35 * clamp((y - g.bandTop) / (g.bandBot - g.bandTop), 0, 1);
}

export function drawAnt(ctx, g, a) {
  const s = depthScale(g, a.y) * a.size * 1.25;
  const flip = a.state === 'stun';
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.scale(a.dir * s, s);

  // contact shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, 0.6, 7, 1.6, 0, 0, Math.PI * 2);
  ctx.fill();

  if (flip) {
    ctx.translate(0, -3);
    ctx.scale(1, -1);
    ctx.translate(0, 3);
  } else if (a.wounded) {
    ctx.rotate(Math.sin(a.phase * 2) * 0.12);
  }

  const body = a.wounded ? '#3d0c16' : '#0a0610';
  const swing = Math.sin(a.phase);
  // legs
  ctx.strokeStyle = body;
  ctx.lineWidth = 0.9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const bx = 2.2 - i * 1.6;
    const ph = i % 2 === 0 ? swing : -swing;
    const reach = flip ? Math.sin(a.phase * 3 + i) * 2 : ph * 1.8;
    if (!(a.wounded && i === 1)) {
      ctx.moveTo(bx, -2.4);
      ctx.lineTo(bx + 1.2 + reach, -1.2);
      ctx.lineTo(bx + 1.6 + reach, 0);
    }
    ctx.moveTo(bx, -2.4);
    ctx.lineTo(bx - 1.2 - reach, -1.2);
    ctx.lineTo(bx - 1.6 - reach, 0);
  }
  ctx.stroke();

  ctx.fillStyle = body;
  // abdomen
  ctx.beginPath();
  ctx.ellipse(-4.2, -3.2, 3.8, 2.7, -0.15, 0, Math.PI * 2);
  ctx.fill();
  // thorax
  ctx.beginPath();
  ctx.ellipse(0.8, -2.8, 2.1, 1.5, 0, 0, Math.PI * 2);
  ctx.fill();
  // head
  ctx.beginPath();
  ctx.arc(4.4, -3.4, 2.2, 0, Math.PI * 2);
  ctx.fill();
  // antennae
  ctx.beginPath();
  ctx.moveTo(5.2, -5.2);
  ctx.quadraticCurveTo(6.5, -8, 8.2, -7.4 + Math.sin(a.phase * 0.7) * 0.8);
  ctx.stroke();

  // rim light so they read on dark asphalt
  ctx.fillStyle = a.wounded ? 'rgba(255,90,110,0.5)' : 'rgba(170,140,210,0.45)';
  ctx.beginPath();
  ctx.ellipse(-4.6, -4.9, 2.2, 0.8, -0.15, 0, Math.PI * 2);
  ctx.fill();
  // eye
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(5.1, -3.8, a.state === 'panic' || a.state === 'stun' ? 1.15 : 0.85, 0, Math.PI * 2);
  ctx.fill();
  if (a.state !== 'stun') {
    ctx.fillStyle = '#000';
    ctx.fillRect(5.3, -4.1, 0.6, 0.6);
  }
  if (a.crumb && !a.wounded && a.state !== 'stun') {
    ctx.fillStyle = '#f3e3b5';
    ctx.fillRect(5.6, -7.6, 3, 2.4);
  }
  ctx.restore();

  if (a.scream > 0 || a.state === 'stun') {
    // speech bubble above the ant (not flipped)
    const by = a.y - 13 * s;
    ctx.save();
    ctx.globalAlpha = a.state === 'stun' ? 0.9 : clamp(a.scream * 2, 0, 1);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(9 * s)}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = a.state === 'stun' ? '#ffe14f' : '#ff3b5c';
    ctx.fillText(a.state === 'stun' ? '@' : '!', a.x, by);
    ctx.restore();
  }
}
