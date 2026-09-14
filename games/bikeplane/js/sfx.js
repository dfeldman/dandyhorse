// Tiny WebAudio: engine drone that follows the pedal, ding on ring hits.
// Audio starts on first user gesture (the READY screen guarantees one).
const Sfx = (() => {
  let ctx = null, engineGain = null, osc1 = null, osc2 = null, lp = null;
  let muted = false, started = false;

  function ensureCtx() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 700;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      osc1 = ctx.createOscillator(); osc1.type = 'sawtooth'; osc1.frequency.value = 60;
      osc2 = ctx.createOscillator(); osc2.type = 'square'; osc2.frequency.value = 121;
      const g2 = ctx.createGain(); g2.gain.value = 0.3;
      osc1.connect(lp); osc2.connect(g2); g2.connect(lp);
      lp.connect(engineGain); engineGain.connect(ctx.destination);
      osc1.start(); osc2.start();
      return true;
    } catch (e) { ctx = null; return false; }
  }

  function unlock() {
    if (ensureCtx() && ctx.state === 'suspended') ctx.resume();
  }

  function engineOn() {
    if (!ensureCtx()) return;
    started = true;
  }

  function update(pedal, flying) {
    if (!ctx || !started) return;
    const f = 45 + pedal * 0.9;
    osc1.frequency.setTargetAtTime(f, ctx.currentTime, 0.1);
    osc2.frequency.setTargetAtTime(f * 2.02, ctx.currentTime, 0.1);
    const target = muted ? 0 : (flying ? 0.045 : 0.03);
    engineGain.gain.setTargetAtTime(target, ctx.currentTime, 0.2);
  }

  function ding() {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    [880, 1174.7, 1568].forEach((freq, i) => {
      const o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + i * 0.07);
      g.gain.linearRampToValueAtTime(0.12, t + i * 0.07 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.07 + 0.4);
      o.connect(g); g.connect(ctx.destination);
      o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.45);
    });
  }

  function whiff() {   // missed ring
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + 0.32);
  }

  function star() {   // sparkly pickup
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    [1568, 2093].forEach((freq, i) => {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + i * 0.06);
      g.gain.linearRampToValueAtTime(0.1, t + i * 0.06 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 0.3);
      o.connect(g); g.connect(ctx.destination);
      o.start(t + i * 0.06); o.stop(t + i * 0.06 + 0.32);
    });
  }

  function pop() {   // balloon
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(180, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + 0.24);
  }

  function horn() {   // race start: beep beep BEEP
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    [[440, 0], [440, 0.45], [880, 0.9]].forEach(([freq, dt]) => {
      const o = ctx.createOscillator(); o.type = 'square';
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + dt);
      g.gain.linearRampToValueAtTime(0.09, t + dt + 0.02);
      g.gain.setValueAtTime(0.09, t + dt + 0.22);
      g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.3);
      o.connect(g); g.connect(ctx.destination);
      o.start(t + dt); o.stop(t + dt + 0.32);
    });
  }

  function fanfare() {   // race finish
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    [523, 659, 784, 1047].forEach((freq, i) => {
      const o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + i * 0.12);
      g.gain.linearRampToValueAtTime(0.11, t + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.5);
      o.connect(g); g.connect(ctx.destination);
      o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.52);
    });
  }

  function turbo() {   // whoosh
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(950, t + 0.55);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o.connect(f); f.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + 0.72);
  }

  function wind() {   // airy tailwind sweep
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(280, t);
    o.frequency.exponentialRampToValueAtTime(720, t + 0.4);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    o.connect(f); f.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + 0.6);
  }

  function firework() {   // staggered celebratory pops
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const o = ctx.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(700 + i * 120, t + i * 0.35);
      o.frequency.exponentialRampToValueAtTime(120, t + i * 0.35 + 0.22);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + i * 0.35);
      g.gain.linearRampToValueAtTime(0.1, t + i * 0.35 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.35 + 0.3);
      o.connect(g); g.connect(ctx.destination);
      o.start(t + i * 0.35); o.stop(t + i * 0.35 + 0.32);
    }
  }

  function toggleMute() { muted = !muted; return muted; }

  return { unlock, engineOn, update, ding, whiff, star, pop, horn, fanfare, turbo, firework, wind, toggleMute };
})();
