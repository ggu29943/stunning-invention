// All sounds are synthesised with WebAudio, so the game ships no audio files.
let ctx = null;
let master = null;
let noise = null;
let muted = false;
let lastSqueak = 0;
let charge = null;

const VOLUME = 0.7;

export function initAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!ctx) {
    try {
      ctx = new AC();
    } catch {
      ctx = null;
      return;
    }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : VOLUME;
    master.connect(ctx.destination);
    const len = ctx.sampleRate;
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}

export function suspendAudio() {
  stopCharge();
  if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.setTargetAtTime(m ? 0 : VOLUME, ctx.currentTime, 0.02);
}

const ready = () => ctx && ctx.state === 'running' && !muted;

function noiseBurst(t, dur, { type = 'lowpass', freq = 800, q = 0.7, gain = 0.5 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5, dur + 0.05);
}

export function stomp(power = 0.5) {
  if (!ready()) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(150 + power * 40, t);
  o.frequency.exponentialRampToValueAtTime(38, t + 0.28);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.6 + power * 0.4, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.35 + power * 0.15);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + 0.6);
  noiseBurst(t, 0.12 + power * 0.1, { freq: 500 + power * 600, gain: 0.35 + power * 0.25 });
  // heel click
  noiseBurst(t, 0.03, { type: 'highpass', freq: 3500, gain: 0.25 });
}

export function crunch(count) {
  if (!ready() || count <= 0) return;
  const t = ctx.currentTime;
  const n = Math.min(count, 10);
  for (let i = 0; i < n; i++) {
    noiseBurst(t + 0.01 + i * 0.014 + Math.random() * 0.01, 0.035 + Math.random() * 0.03, {
      type: 'bandpass',
      freq: 1600 + Math.random() * 2200,
      q: 2.5,
      gain: 0.5,
    });
  }
}

export function squeak() {
  if (!ready()) return;
  const t = ctx.currentTime;
  if (t - lastSqueak < 0.07) return;
  lastSqueak = t;
  const o = ctx.createOscillator();
  o.type = 'triangle';
  const f0 = 1400 + Math.random() * 900;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f0 * (1.3 + Math.random() * 0.4), t + 0.05);
  o.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.05, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + 0.15);
}

export function startCharge() {
  if (!ready() || charge) return;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.value = 55;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 300;
  const g = ctx.createGain();
  g.gain.value = 0.0001;
  g.gain.setTargetAtTime(0.06, ctx.currentTime, 0.05);
  o.connect(f).connect(g).connect(master);
  o.start();
  charge = { o, f, g };
}

export function updateCharge(level) {
  if (!charge || !ctx) return;
  const t = ctx.currentTime;
  charge.o.frequency.setTargetAtTime(55 + level * 90, t, 0.05);
  charge.f.frequency.setTargetAtTime(300 + level * 1400, t, 0.05);
}

export function stopCharge() {
  if (!charge || !ctx) {
    charge = null;
    return;
  }
  const { o, g } = charge;
  charge = null;
  const t = ctx.currentTime;
  g.gain.cancelScheduledValues(t);
  g.gain.setTargetAtTime(0.0001, t, 0.02);
  try {
    o.stop(t + 0.1);
  } catch {
    /* already stopped */
  }
}

export function ding(high = false) {
  if (!ready()) return;
  const t = ctx.currentTime;
  for (const [freq, delay] of high ? [[988, 0], [1319, 0.07], [1976, 0.14]] : [[880, 0], [1320, 0.06]]) {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + delay);
    g.gain.exponentialRampToValueAtTime(0.06, t + delay + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.25);
    o.connect(g).connect(master);
    o.start(t + delay);
    o.stop(t + delay + 0.3);
  }
}

export function click() {
  if (!ready()) return;
  noiseBurst(ctx.currentTime, 0.025, { type: 'highpass', freq: 2500, gain: 0.2 });
}

/** A sticky strand tearing: a wet stretch then a pop. */
export function snap() {
  if (!ready()) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(320 + Math.random() * 120, t);
  o.frequency.exponentialRampToValueAtTime(90, t + 0.09);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.25, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + 0.15);
  noiseBurst(t, 0.05, { type: 'bandpass', freq: 900 + Math.random() * 600, q: 1.5, gain: 0.3 });
}
