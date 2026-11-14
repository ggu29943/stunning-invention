import { mulberry32 } from './util.js';

// Pixel size of the generated city. The background is painted at 1/P
// resolution and scaled up without smoothing, giving the chunky pixel look.
const P = 3;

const WINDOW_LIT = ['#ffd27a', '#ff86c2', '#8ff3ff', '#ffe9a8'];
const NEON = ['#ff4fa3', '#47f0ff', '#ffe14f', '#9dff57', '#ff7b3d'];

/**
 * Builds the static night-city backdrop for a W×H logical scene.
 * Returns the low-res canvas plus neon rectangles that flicker at runtime.
 */
export function buildScene(W, H, L) {
  const cw = Math.ceil(W / P);
  const ch = Math.ceil(H / P);
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const g = c.getContext('2d');
  const rnd = mulberry32(20261114);
  const ri = (a, b) => Math.floor(a + rnd() * (b - a + 1));
  const px = (v) => Math.round(v / P);

  const walkTop = px(L.walkTop);
  const bandTop = px(L.bandTop);
  const bandBot = px(L.bandBot);

  // sky
  const sky = g.createLinearGradient(0, 0, 0, walkTop);
  sky.addColorStop(0, '#120a24');
  sky.addColorStop(0.55, '#3a1747');
  sky.addColorStop(1, '#a23d78');
  g.fillStyle = sky;
  g.fillRect(0, 0, cw, walkTop);

  // stars
  for (let i = 0; i < cw * 0.6; i++) {
    g.fillStyle = rnd() < 0.2 ? '#ffd6f0' : '#6f4c8f';
    g.fillRect(ri(0, cw), ri(0, walkTop * 0.5), 1, 1);
  }
  // moon
  const mx = Math.floor(cw * 0.18);
  const my = Math.floor(walkTop * 0.16) + 6;
  g.fillStyle = '#ffd9ec';
  g.beginPath();
  g.arc(mx, my, 7, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#e9b4d6';
  g.fillRect(mx - 3, my - 2, 2, 2);
  g.fillRect(mx + 2, my + 2, 2, 1);

  const neons = [];

  // two layers of buildings: far (hazy) then near
  const layers = [
    { base: walkTop, min: walkTop * 0.25, max: walkTop * 0.7, colors: ['#4a2152', '#55285e', '#4d1f4f'], lit: 0.18, haze: 'rgba(200,80,140,0.25)' },
    { base: walkTop, min: walkTop * 0.12, max: walkTop * 0.55, colors: ['#26132f', '#2d1636', '#311a3c', '#22102a'], lit: 0.32, haze: null },
  ];
  for (const layer of layers) {
    let x = -ri(0, 10);
    while (x < cw) {
      const w = ri(16, 40);
      const top = Math.floor(layer.min + rnd() * (layer.max - layer.min));
      const col = layer.colors[ri(0, layer.colors.length - 1)];
      g.fillStyle = col;
      g.fillRect(x, top, w, layer.base - top);
      // roof details
      if (rnd() < 0.4) {
        g.fillRect(x + ri(2, Math.max(3, w - 6)), top - ri(2, 6), ri(2, 4), 6);
      }
      if (rnd() < 0.25) {
        g.fillRect(x + 2, top - 2, w - 4, 2);
      }
      // windows
      const ww = ri(2, 3);
      const wh = ri(2, 4);
      for (let wy = top + 3; wy < layer.base - 8; wy += wh + 2) {
        for (let wx = x + 2; wx < x + w - ww - 1; wx += ww + 2) {
          if (rnd() < layer.lit) {
            g.fillStyle = WINDOW_LIT[ri(0, WINDOW_LIT.length - 1)];
            g.globalAlpha = layer.haze ? 0.45 : 0.9;
          } else {
            g.fillStyle = '#170a1f';
            g.globalAlpha = layer.haze ? 0.3 : 0.6;
          }
          g.fillRect(wx, wy, ww, wh);
        }
      }
      g.globalAlpha = 1;
      if (layer.haze) {
        g.fillStyle = layer.haze;
        g.fillRect(x, top, w, layer.base - top);
      }
      // neon sign on some near buildings
      if (!layer.haze && rnd() < 0.45 && w > 18) {
        const sw = ri(8, Math.min(22, w - 4));
        const sh = ri(4, 8);
        const sx = x + ri(2, w - sw - 2);
        const sy = ri(top + 6, Math.max(top + 7, layer.base - 30));
        const color = NEON[ri(0, NEON.length - 1)];
        g.fillStyle = '#12081a';
        g.fillRect(sx - 1, sy - 1, sw + 2, sh + 2);
        g.strokeStyle = color;
        g.lineWidth = 1;
        g.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);
        // pseudo glyphs
        g.fillStyle = color;
        for (let gx = sx + 2; gx < sx + sw - 2; gx += 3) {
          g.fillRect(gx, sy + 2, 2, Math.max(1, sh - 4));
        }
        neons.push({ x: sx * P, y: sy * P, w: sw * P, h: sh * P, color, phase: rnd() * 10 });
      }
      x += w + ri(0, 3);
    }
  }

  // sidewalk
  g.fillStyle = '#3c2a4c';
  g.fillRect(0, walkTop, cw, bandTop - walkTop);
  g.fillStyle = '#4a3660';
  for (let x = 0; x < cw; x += 10) g.fillRect(x, walkTop, 1, bandTop - walkTop);
  g.fillRect(0, walkTop + Math.floor((bandTop - walkTop) / 2), cw, 1);
  g.fillStyle = '#6b5584';
  g.fillRect(0, walkTop, cw, 1);

  // street furniture standing on the sidewalk
  for (let x = ri(10, 30); x < cw; x += ri(55, 90)) {
    // lamp post
    g.fillStyle = '#1a1022';
    g.fillRect(x, walkTop - 38, 2, 40);
    g.fillRect(x - 4, walkTop - 38, 8, 2);
    g.fillStyle = '#ffe9b0';
    g.fillRect(x - 4, walkTop - 36, 3, 1);
    g.fillRect(x + 3, walkTop - 36, 3, 1);
    neons.push({ x: (x - 5) * P, y: (walkTop - 37) * P, w: 12 * P, h: 3 * P, color: '#ffe9b0', phase: rnd() * 10, lamp: true });
  }
  {
    // traffic light
    const tx = Math.floor(cw * 0.42);
    g.fillStyle = '#140b1a';
    g.fillRect(tx, walkTop - 30, 2, 32);
    g.fillRect(tx - 2, walkTop - 34, 6, 12);
    g.fillStyle = '#ff3b5c';
    g.fillRect(tx - 1, walkTop - 33, 4, 3);
    g.fillStyle = '#3a2040';
    g.fillRect(tx - 1, walkTop - 29, 4, 3);
    g.fillRect(tx - 1, walkTop - 25, 4, 2);
  }

  // curb
  g.fillStyle = '#7d6a8f';
  g.fillRect(0, bandTop - 2, cw, 2);
  g.fillStyle = '#251a2f';
  g.fillRect(0, bandTop, cw, 1);

  // asphalt
  const road = g.createLinearGradient(0, bandTop, 0, ch);
  road.addColorStop(0, '#2a2238');
  road.addColorStop(1, '#1b1526');
  g.fillStyle = road;
  g.fillRect(0, bandTop + 1, cw, ch - bandTop);
  // grit
  for (let i = 0; i < cw * (ch - bandTop) * 0.05; i++) {
    g.fillStyle = rnd() < 0.5 ? '#332a44' : '#1a1424';
    g.fillRect(ri(0, cw), ri(bandTop + 1, ch), 1, 1);
  }
  // zebra crossing: perspective-ish vertical bars across the walking band
  const zx0 = Math.floor(cw * 0.06);
  const zx1 = Math.floor(cw * 0.94);
  for (let x = zx0; x < zx1; x += 9) {
    g.fillStyle = 'rgba(214, 206, 230, 0.55)';
    g.fillRect(x, bandTop + 3, 5, bandBot - bandTop - 4);
    g.fillStyle = 'rgba(214, 206, 230, 0.25)';
    g.fillRect(x, bandTop + 3, 5, 1);
  }
  // near curb + sidewalk strip at the bottom
  if (ch - bandBot > 2) {
    g.fillStyle = '#7d6a8f';
    g.fillRect(0, bandBot + 1, cw, 1);
    g.fillStyle = '#34253f';
    g.fillRect(0, bandBot + 2, cw, ch - bandBot - 2);
    g.fillStyle = '#41304f';
    for (let x = 4; x < cw; x += 12) g.fillRect(x, bandBot + 2, 1, ch - bandBot - 2);
  }

  return { canvas: c, neons };
}

/** Neon/lamp flicker drawn over the static backdrop. */
export function drawNeons(ctx, neons, t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const n of neons) {
    const flick = Math.sin(t * 1.7 + n.phase) + Math.sin(t * 13.1 + n.phase * 3);
    let a = n.lamp ? 0.16 : 0.22;
    if (!n.lamp && flick > 1.6) a = 0.03; // brief outage
    ctx.globalAlpha = a;
    ctx.fillStyle = n.color;
    const pad = n.lamp ? 10 : 8;
    ctx.fillRect(n.x - pad, n.y - pad, n.w + pad * 2, n.h + pad * 2);
  }
  ctx.restore();
}
