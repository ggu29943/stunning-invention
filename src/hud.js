import { clamp, fmtTime, roundRect } from './util.js';

const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, "PingFang SC", "Microsoft YaHei", monospace';

export const EGO_LEVELS = [60, 180, 400, 800, 1400, 2400];

export function egoLevel(ego) {
  let lv = 0;
  while (lv < EGO_LEVELS.length && ego >= EGO_LEVELS[lv]) lv++;
  return lv;
}

function iconWatch(ctx, x, y) {
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y + 1, 7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.fillRect(x - 2, y - 10, 4, 3);
  ctx.beginPath();
  ctx.moveTo(x, y + 1);
  ctx.lineTo(x, y - 3);
  ctx.moveTo(x, y + 1);
  ctx.lineTo(x + 3, y + 2);
  ctx.stroke();
}

function iconAnt(ctx, x, y) {
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(x - 4, y + 1, 4.5, 3.2, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 2, y, 2.3, 2, 0, 0, Math.PI * 2);
  ctx.arc(x + 6.5, y - 1, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (const lx of [-2, 1, 4]) {
    ctx.moveTo(x + lx, y + 1);
    ctx.lineTo(x + lx - 2, y + 6);
    ctx.moveTo(x + lx, y + 1);
    ctx.lineTo(x + lx + 2, y + 6);
  }
  ctx.stroke();
  ctx.fillStyle = '#ff3b5c';
  ctx.fillRect(x - 9, y - 8, 18, 2.2);
}

function iconCrown(ctx, x, y) {
  ctx.fillStyle = '#ffe14f';
  ctx.beginPath();
  ctx.moveTo(x - 8, y + 5);
  ctx.lineTo(x - 8, y - 4);
  ctx.lineTo(x - 4, y);
  ctx.lineTo(x, y - 7);
  ctx.lineTo(x + 4, y);
  ctx.lineTo(x + 8, y - 4);
  ctx.lineTo(x + 8, y + 5);
  ctx.closePath();
  ctx.fill();
}

function shadowText(ctx, str, x, y, color = '#fff') {
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(16, 6, 22, 0.85)';
  ctx.strokeText(str, x, y);
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

export function pauseButtonRect(g) {
  const pw = portraitWidth(g);
  const sf = g.safe || { t: 0, r: 0 };
  // 26 px clear of the portrait, which bounces up to 8% larger after a stomp
  return { x: g.W - pw - 12 - 26 - 36 - sf.r, y: 14 + sf.t, w: 36, h: 36 };
}

export function portraitWidth(g) {
  return g.W < 700 ? 118 : 140;
}

export function drawHUD(ctx, g, assets) {
  const s = g.session;
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  // ---- top-left counters
  const compact = g.W < 700;
  ctx.font = `800 ${compact ? 15 : 17}px ${FONT}`;
  const timeVal = g.mode === 'timed' ? Math.ceil(Math.max(0, g.timeLimit - g.elapsed)) : g.elapsed;
  const sf = g.safe || { t: 0, r: 0, l: 0 };
  ctx.translate(sf.l, sf.t);
  let x = 18;
  const y = 30;
  const items = [
    [iconWatch, fmtTime(timeVal), timeVal < 10 && g.mode === 'timed' ? '#ff5c7a' : '#fff'],
    [iconAnt, String(s.kills), '#fff'],
    [iconCrown, String(s.ego), '#ffe14f'],
  ];
  for (const [icon, str, color] of items) {
    icon(ctx, x + 9, y);
    shadowText(ctx, str, x + 22, y + 1, color);
    x += 22 + ctx.measureText(str).width + (compact ? 14 : 22);
  }

  // ---- combo
  let ly = 58;
  if (g.combo >= 2) {
    const pulse = 1 + Math.max(0, g.comboPulse) * 0.35;
    ctx.font = `900 ${Math.round(20 * pulse)}px ${FONT}`;
    shadowText(ctx, `连杀 ×${g.combo}`, 18, ly + 2, g.combo >= 20 ? '#ff4fa3' : '#ffe14f');
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(18, ly + 16, 110, 3);
    ctx.fillStyle = '#ffe14f';
    ctx.fillRect(18, ly + 16, 110 * clamp(g.comboT / g.comboWindow, 0, 1), 3);
    ly += 34;
  }

  // ---- new-record popups (like "+42 Highest Kill Combo")
  ctx.font = `700 ${compact ? 13 : 14}px ${FONT}`;
  for (const p of g.records.popups) {
    const a = p.age > 2.4 ? 1 - (p.age - 2.4) / 0.6 : 1;
    ctx.globalAlpha = clamp(a, 0, 1);
    const val = p.float ? p.delta.toFixed(1) : Math.round(p.delta);
    shadowText(ctx, `+${val} ${p.label}`, 18 + Math.max(0, 0.15 - p.age) * 80, ly, '#e8ddff');
    ly += 19;
  }
  ctx.globalAlpha = 1;

  // ---- pressure gauge on the left edge
  const gx = 8;
  const gy0 = g.H * 0.3;
  const gh = Math.min(g.H * 0.42, 260);
  ctx.fillStyle = 'rgba(10, 4, 16, 0.6)';
  roundRect(ctx, gx - 2, gy0 - 2, 10, gh + 4, 4);
  ctx.fill();
  const p = g.pressure;
  if (p > 0) {
    const full = p >= 1;
    const grad = ctx.createLinearGradient(0, gy0 + gh, 0, gy0);
    grad.addColorStop(0, '#ff8a3d');
    grad.addColorStop(1, '#ff2350');
    ctx.fillStyle = full ? (Math.floor(g.time * 14) % 2 ? '#fff' : '#ff2350') : grad;
    ctx.fillRect(gx, gy0 + gh * (1 - p), 6, gh * p);
  }
  if (g.settings.control === 'drag') {
    // drag control: a tick where the back leg shifts its weight, and the
    // line where ants pinned under the boot die
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillRect(gx - 2, gy0 + gh * (1 - g.backP1) - 1, 10, 2);
    const ky = gy0 + gh * (1 - g.killAt);
    const crushed = g.press && g.press.crushed;
    ctx.fillStyle = crushed ? '#ffe14f' : '#ffffff';
    ctx.fillRect(gx - 4, ky - 1, 14, 2);
    ctx.font = `800 10px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    shadowText(ctx, '致死', gx + 13, ky, crushed ? '#ffe14f' : '#ffffff');
    // how many ants the boot is holding down right now
    const pinned = g.press && !crushed ? g.press.pinned.length : 0;
    if (pinned) {
      ctx.font = `800 12px ${FONT}`;
      shadowText(ctx, `压住 ×${pinned}`, gx + 13, ky - 18, '#ff8fb8');
    }
  }
  ctx.save();
  ctx.translate(gx + 3, gy0 + gh + 8);
  ctx.rotate(-Math.PI / 2);
  ctx.font = `700 9px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255, 220, 235, 0.7)';
  ctx.fillText('PRESSURE', -2, 14);
  ctx.restore();

  ctx.translate(-sf.l - sf.r, 0);
  // ---- portrait (top-right)
  drawPortrait(ctx, g, assets);
  ctx.translate(sf.r, -sf.t); // back to unshifted coords; pauseButtonRect applies insets itself

  // ---- pause button
  const pb = pauseButtonRect(g);
  ctx.fillStyle = 'rgba(16, 6, 22, 0.55)';
  roundRect(ctx, pb.x, pb.y, pb.w, pb.h, 10);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillRect(pb.x + 12, pb.y + 10, 4, 16);
  ctx.fillRect(pb.x + 20, pb.y + 10, 4, 16);

  // ---- final countdown
  if (g.mode === 'timed' && g.state === 'play') {
    const left = g.timeLimit - g.elapsed;
    if (left <= 5 && left > 0) {
      const n = Math.ceil(left);
      const k = n - left;
      ctx.globalAlpha = 1 - k * 0.6;
      ctx.textAlign = 'center';
      ctx.font = `900 ${Math.round(70 + k * 40)}px ${FONT}`;
      shadowText(ctx, String(n), g.W / 2, g.H * 0.32, '#ff4f7a');
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

function drawPortrait(ctx, g, assets) {
  const { img } = assets;
  const fw = portraitWidth(g);
  const fh = fw;
  const sc = fw / 140;
  const bounce = 1 + g.portraitPulse * 0.08;
  const x = g.W - fw - 12;
  const y = 12;
  // the character floats gently inside a frame that stays put
  const float = Math.sin(g.time * 1.9) * 2.5;
  ctx.save();
  ctx.translate(x + fw / 2, y + fh / 2);
  ctx.scale(bounce, bounce);
  ctx.translate(-fw / 2, -fh / 2);
  if (g.portraitPulse > 0) ctx.translate((Math.random() - 0.5) * 4 * g.portraitPulse, 0);

  const r = 15 * sc;
  // backing + face, clipped to the inside of the frame
  ctx.save();
  roundRect(ctx, 2, 2, fw - 4, fh - 4, r);
  const bg = ctx.createLinearGradient(0, 0, 0, fh);
  bg.addColorStop(0, '#5a2a63');
  bg.addColorStop(1, '#a33d6d');
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.clip();
  // green-eyed normally, red-eyed when the pressure is full or after a big stomp
  // drawn a little oversized and low, so the float never shows a gap at the bottom
  const size = fw * 1.09;
  const fx = (fw - size) / 2;
  const fy = fh - size + 5 + float;
  const mix = clamp(g.redMix || 0, 0, 1);
  if (mix < 1) ctx.drawImage(img.face_green, fx, fy, size, size);
  if (mix > 0) {
    ctx.globalAlpha = mix;
    ctx.drawImage(img.face_red, fx, fy, size, size);
    ctx.globalAlpha = 1;
  }
  if (g.pressure >= 1 || g.portraitPulse > 0.3) {
    ctx.fillStyle = `rgba(255, 30, 80, ${g.pressure >= 1 ? 0.14 + Math.sin(g.time * 20) * 0.06 : g.portraitPulse * 0.2})`;
    ctx.fillRect(0, 0, fw, fh);
  }
  ctx.restore();
  // frame: same look as the frame in the provided sheet (grey rim with dark
  // edges), drawn as vectors so it stays sharp on high-DPI screens
  roundRect(ctx, 2, 2, fw - 4, fh - 4, r);
  ctx.lineWidth = 6 * Math.max(0.8, sc);
  ctx.strokeStyle = 'rgba(8, 4, 10, 0.85)';
  ctx.stroke();
  ctx.lineWidth = 3.4 * Math.max(0.8, sc);
  ctx.strokeStyle = '#626262';
  ctx.stroke();
  ctx.restore();

  // ego circles
  const lv = egoLevel(g.session.ego);
  const cr = 6.5 * sc + 0.8;
  const gap = (fw - 12) / 6;
  const cy = y + fh + 16; // clear of the floating, bouncing portrait
  for (let i = 0; i < 6; i++) {
    const cx = x + 6 + gap * (i + 0.5);
    const lo = i === 0 ? 0 : EGO_LEVELS[i - 1];
    const fill = clamp((g.session.ego - lo) / (EGO_LEVELS[i] - lo), 0, 1);
    ctx.fillStyle = 'rgba(16, 6, 22, 0.6)';
    ctx.beginPath();
    ctx.arc(cx, cy, cr + 1.5, 0, Math.PI * 2);
    ctx.fill();
    if (fill > 0) {
      ctx.fillStyle = i < lv ? '#ffe14f' : '#fff';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, cr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fill);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ego gained by the last stomp, shown under the circles
  if (g.gainT > 0) {
    ctx.globalAlpha = clamp(g.gainT / 0.4, 0, 1);
    ctx.textAlign = 'center';
    ctx.font = `900 ${g.W < 700 ? 16 : 19}px ${FONT}`;
    shadowText(ctx, `+${g.gain}`, x + fw / 2, cy + 22, '#ffe14f');
    ctx.globalAlpha = 1;
  }
}
