// 모든 소리는 Web Audio로 직접 합성한다. 외부 음원 파일 없음.

let ac = null;
let master = null;
let noiseBuf = null;
let droneNodes = null;
let muted = false;

try { muted = localStorage.getItem('hp_muted') === '1'; } catch (e) {}

export function unlock() {
  if (!ac) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    ac = new C();
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.9;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 6;
    master.connect(comp).connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ac.state === 'suspended') ac.resume();
}

export function isMuted() { return muted; }
export function setMuted(v) {
  muted = v;
  try { localStorage.setItem('hp_muted', v ? '1' : '0'); } catch (e) {}
  if (master) master.gain.setTargetAtTime(v ? 0 : 0.9, ac.currentTime, 0.05);
}

const ready = () => !!ac;
const now = () => ac.currentTime;

function env(g, t, a, peak, dec, end = 0.0001) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(end, t + a + dec);
}

function noise(t, dur, { type = 'lowpass', freq = 1000, q = 1, peak = 0.8, attack = 0.002, sweepTo = null } = {}) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  f.Q.value = q;
  const g = ac.createGain();
  env(g, t, attack, peak, dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random());
  src.stop(t + attack + dur + 0.05);
  return g;
}

function tone(t, dur, { type = 'sine', freq = 440, to = null, peak = 0.4, attack = 0.005, detune = 0 } = {}) {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  o.detune.value = detune;
  const g = ac.createGain();
  env(g, t, attack, peak, dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + attack + dur + 0.05);
  return o;
}

function shaper(amount) {
  const ws = ac.createWaveShaper();
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    c[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  ws.curve = c;
  return ws;
}

export const sfx = {
  ui() {
    if (!ready()) return;
    tone(now(), 0.04, { type: 'square', freq: 1800, peak: 0.04 });
  },
  hover() {
    if (!ready()) return;
    tone(now(), 0.02, { type: 'square', freq: 2600, peak: 0.015 });
  },
  tick(pitch = 1) {
    if (!ready()) return;
    tone(now(), 0.03, { type: 'square', freq: 1300 * pitch, peak: 0.08 });
    noise(now(), 0.02, { type: 'highpass', freq: 4000, peak: 0.1 });
  },
  clock() {
    if (!ready()) return;
    const t = now();
    tone(t, 0.05, { type: 'triangle', freq: 900, peak: 0.25 });
    noise(t, 0.03, { type: 'bandpass', freq: 3000, q: 4, peak: 0.3 });
  },
  click() {
    // 빈 약실
    if (!ready()) return;
    const t = now();
    noise(t, 0.03, { type: 'highpass', freq: 2500, peak: 0.9 });
    tone(t, 0.04, { type: 'square', freq: 320, to: 180, peak: 0.25 });
    noise(t + 0.05, 0.02, { type: 'bandpass', freq: 5000, q: 3, peak: 0.4 });
  },
  cock() {
    if (!ready()) return;
    const t = now();
    noise(t, 0.04, { type: 'bandpass', freq: 1800, q: 2, peak: 0.6 });
    noise(t + 0.12, 0.03, { type: 'highpass', freq: 3000, peak: 0.8 });
    tone(t + 0.12, 0.03, { type: 'square', freq: 600, peak: 0.12 });
  },
  spin(dur = 1.6) {
    if (!ready()) return;
    const t0 = now();
    let t = 0, gap = 0.025;
    while (t < dur) {
      noise(t0 + t, 0.015, { type: 'bandpass', freq: 3500, q: 5, peak: 0.35 });
      t += gap;
      gap *= 1.07;
    }
  },
  load() {
    if (!ready()) return;
    const t = now();
    noise(t, 0.05, { type: 'bandpass', freq: 1200, q: 3, peak: 0.7 });
    tone(t, 0.06, { type: 'triangle', freq: 220, to: 120, peak: 0.3 });
  },
  gunshot() {
    if (!ready()) return;
    const t = now();
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(9000, t);
    f.frequency.exponentialRampToValueAtTime(300, t + 0.6);
    const ws = shaper(40);
    const g = ac.createGain();
    env(g, t, 0.001, 1.6, 0.9);
    src.connect(f).connect(ws).connect(g).connect(master);
    src.start(t);
    src.stop(t + 1.2);
    tone(t, 0.5, { type: 'sine', freq: 140, to: 32, peak: 1.4, attack: 0.001 });
    tone(t, 0.25, { type: 'square', freq: 90, to: 30, peak: 0.4, attack: 0.001 });
    // 잔향
    noise(t + 0.08, 1.8, { type: 'lowpass', freq: 900, sweepTo: 120, peak: 0.25, attack: 0.05 });
  },
  explosion() {
    if (!ready()) return;
    const t = now();
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(5000, t);
    f.frequency.exponentialRampToValueAtTime(80, t + 2.5);
    const ws = shaper(60);
    const g = ac.createGain();
    env(g, t, 0.002, 1.8, 2.6);
    src.connect(f).connect(ws).connect(g).connect(master);
    src.start(t);
    src.stop(t + 3);
    tone(t, 1.4, { type: 'sine', freq: 90, to: 20, peak: 1.6, attack: 0.002 });
    tone(t, 0.8, { type: 'sawtooth', freq: 60, to: 25, peak: 0.5, attack: 0.002 });
    for (let i = 0; i < 6; i++) {
      noise(t + 0.3 + Math.random() * 1.2, 0.08, { type: 'highpass', freq: 2000, peak: 0.2 });
    }
  },
  glass() {
    if (!ready()) return;
    const t = now();
    noise(t, 0.5, { type: 'highpass', freq: 3000, peak: 0.9, attack: 0.001 });
    noise(t, 0.15, { type: 'lowpass', freq: 600, peak: 0.8, attack: 0.001 });
    for (let i = 0; i < 18; i++) {
      const tt = t + Math.random() * 0.6;
      tone(tt, 0.08 + Math.random() * 0.2, { type: 'sine', freq: 2500 + Math.random() * 6000, peak: 0.12 + Math.random() * 0.1, attack: 0.001 });
    }
  },
  step() {
    if (!ready()) return;
    const t = now();
    tone(t, 0.12, { type: 'sine', freq: 120, to: 60, peak: 0.6, attack: 0.002 });
    noise(t, 0.06, { type: 'lowpass', freq: 800, peak: 0.4 });
    tone(t + 0.01, 0.4, { type: 'sine', freq: 3400, peak: 0.05 });
  },
  fall() {
    if (!ready()) return;
    const t = now();
    const o = ac.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(700, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 1.6);
    const lfo = ac.createOscillator();
    lfo.frequency.value = 7;
    const lg = ac.createGain();
    lg.gain.value = 30;
    lfo.connect(lg).connect(o.frequency);
    const f = ac.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1200;
    f.Q.value = 1.5;
    const g = ac.createGain();
    env(g, t, 0.05, 0.35, 1.6);
    o.connect(f).connect(g).connect(master);
    o.start(t); lfo.start(t);
    o.stop(t + 1.8); lfo.stop(t + 1.8);
    noise(t, 1.6, { type: 'bandpass', freq: 500, sweepTo: 200, q: 1, peak: 0.2, attack: 0.3 });
    setTimeout(() => { if (ready()) tone(now(), 0.3, { type: 'sine', freq: 70, to: 30, peak: 1, attack: 0.002 }); }, 1700);
  },
  gulp() {
    if (!ready()) return;
    const t = now();
    for (let i = 0; i < 2; i++) {
      tone(t + i * 0.35, 0.12, { type: 'sine', freq: 260, to: 120, peak: 0.5 });
      noise(t + i * 0.35, 0.1, { type: 'bandpass', freq: 400, q: 6, peak: 0.4 });
    }
  },
  choke() {
    if (!ready()) return;
    const t = now();
    for (let i = 0; i < 5; i++) {
      noise(t + i * 0.13, 0.09, { type: 'bandpass', freq: 700 + Math.random() * 400, q: 8, peak: 0.6 });
    }
    tone(t + 0.7, 1.0, { type: 'sawtooth', freq: 180, to: 60, peak: 0.25 });
  },
  sigh() {
    if (!ready()) return;
    noise(now(), 0.8, { type: 'bandpass', freq: 900, sweepTo: 400, q: 1, peak: 0.15, attack: 0.15 });
  },
  heartbeat(intensity = 1) {
    if (!ready()) return;
    const t = now();
    tone(t, 0.16, { type: 'sine', freq: 62, to: 40, peak: 0.9 * intensity, attack: 0.008 });
    tone(t + 0.24, 0.2, { type: 'sine', freq: 55, to: 36, peak: 0.6 * intensity, attack: 0.008 });
  },
  stinger() {
    // 공포 영화식 불협화음 타격
    if (!ready()) return;
    const t = now();
    [110, 116.5, 155.6, 233, 246.9].forEach((fr, i) => {
      tone(t, 2.2, { type: i % 2 ? 'sawtooth' : 'square', freq: fr, peak: 0.08, attack: 0.002, detune: Math.random() * 20 - 10 });
    });
    noise(t, 0.3, { type: 'lowpass', freq: 2000, peak: 0.5 });
    tone(t, 1, { type: 'sine', freq: 50, to: 30, peak: 0.9, attack: 0.002 });
  },
  alarm() {
    if (!ready()) return;
    const t = now();
    for (let i = 0; i < 4; i++) {
      tone(t + i * 0.3, 0.14, { type: 'square', freq: i % 2 ? 660 : 880, peak: 0.08 });
    }
  },
  reel() {
    if (!ready()) return;
    tone(now(), 0.025, { type: 'triangle', freq: 2200, peak: 0.12 });
  },
  thud() {
    if (!ready()) return;
    const t = now();
    tone(t, 0.6, { type: 'sine', freq: 80, to: 28, peak: 1.2, attack: 0.002 });
    noise(t, 0.2, { type: 'lowpass', freq: 400, peak: 0.6 });
  },
  death() {
    // 사망 직후 길게 깔리는 저음 + 이명
    if (!ready()) return;
    const t = now() + 0.15;
    tone(t, 3.5, { type: 'sine', freq: 7400, peak: 0.035, attack: 0.3 });
    tone(t, 3, { type: 'sawtooth', freq: 41, peak: 0.25, attack: 0.1 });
    tone(t, 3, { type: 'sawtooth', freq: 43.5, peak: 0.2, attack: 0.1 });
  },
  survive() {
    if (!ready()) return;
    const t = now();
    [220, 277.2, 329.6, 440].forEach((fr, i) => tone(t + i * 0.18, 1.6, { type: 'triangle', freq: fr, peak: 0.12 }));
  },
  finale() {
    if (!ready()) return;
    const t = now();
    const seq = [[220, 0], [261.6, 0.25], [329.6, 0.5], [311.1, 0.9], [440, 1.3]];
    seq.forEach(([fr, d]) => {
      tone(t + d, 2.2, { type: 'sawtooth', freq: fr, peak: 0.06 });
      tone(t + d, 2.2, { type: 'triangle', freq: fr / 2, peak: 0.12 });
    });
    tone(t + 1.3, 3, { type: 'sine', freq: 55, peak: 0.5 });
  },
  fuse() {
    if (!ready()) return;
    noise(now(), 0.06, { type: 'highpass', freq: 5000 + Math.random() * 3000, peak: 0.08 });
  },
};

export function drone(on) {
  if (!ready()) return;
  if (on && !droneNodes) {
    const t = now();
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.11, t + 3);
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 260;
    const lfo = ac.createOscillator();
    lfo.frequency.value = 0.09;
    const lg = ac.createGain();
    lg.gain.value = 140;
    lfo.connect(lg).connect(f.frequency);
    const oscs = [36.7, 37.1, 55, 73.6].map((fr) => {
      const o = ac.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = fr;
      o.connect(f);
      o.start(t);
      return o;
    });
    f.connect(g).connect(master);
    lfo.start(t);
    droneNodes = { g, oscs, lfo };
  } else if (!on && droneNodes) {
    const { g, oscs, lfo } = droneNodes;
    const t = now();
    g.gain.setTargetAtTime(0.0001, t, 0.6);
    oscs.forEach((o) => o.stop(t + 3));
    lfo.stop(t + 3);
    droneNodes = null;
  }
}

let heartTimer = null;
export function heartLoop(bpm) {
  clearTimeout(heartTimer);
  heartTimer = null;
  if (!bpm) return;
  const beat = () => {
    sfx.heartbeat(Math.min(1.3, bpm / 90));
    document.body.classList.remove('pulse');
    void document.body.offsetWidth;
    document.body.classList.add('pulse');
    heartTimer = setTimeout(beat, 60000 / bpm);
  };
  beat();
}
