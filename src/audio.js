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
  // 'suspended' (never started, or put to sleep by suspendAudio) or, on
  // iPhone / iPad, 'interrupted' (a call, another app): wake it up
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
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

/**
 * A heel striking the street. Modelled on measured recordings of real high
 * heels on hard floors (nine CC0 strikes): the "哒" is a ~10 ms noise burst
 * with a ~1 ms attack whose energy sits at 0.5-2 kHz (peak near 1 kHz, little
 * below ~120 Hz, falling off above ~2 kHz) -- no tone and no sub thump; the
 * street answers faintly; the sole touches down ~100 ms later, much weaker.
 * `power` (0..1) adds a short low-mid body for a hard stomp.
 */
export function stomp(power = 0.5) {
  if (!ready()) return;
  heelStrike(ctx.currentTime, 0.35 + power * 0.65, power);
}

/** A light heel tap (setting the boot down gently, the back leg stepping). */
export function heelTap(volume = 0.35) {
  if (!ready()) return;
  heelStrike(ctx.currentTime, volume, 0);
}

/**
 * Noise through a chain of biquads ([type, freq, Q, gain dB]) with a short
 * linear attack and an exponential decay reaching -20 dB after `decay20`.
 */
function shapedBurst(t, { attack, decay20, gain, chain }) {
  if (!(gain > 0)) return; // an exponential ramp cannot start from 0
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.9 + Math.random() * 0.2;
  let node = src;
  for (const [type, freq, q, g] of chain) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q !== undefined) f.Q.value = q;
    if (g !== undefined) f.gain.value = g;
    node.connect(f);
    node = f;
  }
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(gain, t + attack);
  env.gain.exponentialRampToValueAtTime(gain * 0.001, t + attack + decay20 * 3);
  node.connect(env).connect(master);
  src.start(t, Math.random() * 0.5, attack + decay20 * 3 + 0.01);
}

// Tuned by fitting the synthesis to the measured recordings (octave bands,
// centroid, decay, attack, and the sole's level relative to the heel).
const HEEL = {
  level: 1.42, // A-weighted: 3 dB louder than the first "哒" (it sounded a little quiet)
  hpF: 109.0, pk1F: 179.0, pk1Q: 0.96, pk1G: 5.8, pk2F: 855.0, pk2Q: 1.18, pk2G: 3.81, lpF: 2264.0, lpQ: 0.7,
  attack: 0.00021, decay20: 0.012,
  tailF: 736.0, tailLp: 1597.0, tailGain: 0.072, tailDecay: 0.061,
  edgeHp: 2526.0, edgeLp: 13986.0, edgeGain: 0.11,
  bodyF: 260, bodyGain: 0.55,
  soleF: 1109.0, soleQ: 1.4, soleLp: 2999.0, soleGain: 1.025, soleDecay: 0.005,
};

function heelStrike(t, vol, power) {
  const H = HEEL;
  vol *= H.level;
  const v = 1 + (Math.random() - 0.5) * 0.08; // +-4%, so repeats differ
  // the heel tip: the 哒 itself
  shapedBurst(t, {
    attack: H.attack,
    decay20: H.decay20,
    gain: 1.3 * vol,
    chain: [['highpass', H.hpF, 0.6], ['peaking', H.pk1F, H.pk1Q, H.pk1G], ['peaking', H.pk2F * v, H.pk2Q, H.pk2G], ['lowpass', H.lpF * v, H.lpQ]],
  });
  // the street answering faintly (buildings either side): a soft, dark tail
  shapedBurst(t + 0.004, { attack: 0.006, decay20: H.tailDecay, gain: H.tailGain * vol, chain: [['bandpass', H.tailF, 0.8], ['lowpass', H.tailLp, 0.7]] });
  // a hard edge on the first millisecond (crisp, never a hiss tail)
  shapedBurst(t, { attack: 0.0002, decay20: 0.001, gain: H.edgeGain * vol, chain: [['highpass', H.edgeHp, 0.7], ['lowpass', H.edgeLp, 0.7]] });
  // weight for a hard stomp: a short low-mid body, no sub
  if (power > 0) {
    shapedBurst(t, { attack: 0.002, decay20: 0.02 + 0.015 * power, gain: H.bodyGain * power * vol, chain: [['bandpass', H.bodyF, 0.9]] });
  }
  // the sole touching down ~100 ms after the heel (real heels: 6-9 dB weaker)
  shapedBurst(t + 0.095 + Math.random() * 0.02, {
    attack: 0.001,
    decay20: H.soleDecay,
    gain: H.soleGain * vol,
    chain: [['bandpass', H.soleF * v, H.soleQ], ['lowpass', H.soleLp, 0.7]],
  });
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

/**
 * An ant's squeak. `intensity` 0..1 (how hard the boot pinning it presses):
 * louder, shriller and allowed to come faster as it rises.
 */
export function squeak(intensity = 0) {
  if (!ready()) return;
  const k = Math.max(0, Math.min(1, intensity));
  const t = ctx.currentTime;
  if (t - lastSqueak < 0.07 - 0.035 * k) return;
  lastSqueak = t;
  const o = ctx.createOscillator();
  o.type = 'triangle';
  const f0 = (1400 + Math.random() * 900) * (1 + 0.45 * k);
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f0 * (1.3 + Math.random() * 0.4), t + 0.05);
  o.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.05 + 0.11 * k, t + 0.01);
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
