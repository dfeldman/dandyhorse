// Pedal input, 0-100: 50 holds level flight.
// On Dandyhorse the platform feeds the rider's effort through Input.setSource (src/platform.ts:
// 50 x power / steady power). Without a source (the page opened on its own) the test harness drives it:
// Up/Down (or W/S) arrows, the on-screen slider, or window.setPedalInput(v).
const Input = (() => {
  let raw = 0;        // latest value 0-100
  let filtered = 0;   // low-pass filtered value the game reads
  let keyDir = 0;     // -1, 0, +1 while arrows held
  let slider = null;
  let source = null;  // () => number | null: the platform's pedal value; null holds the last one

  function setRaw(v) {
    raw = Math.max(0, Math.min(100, v));
    if (slider) slider.value = raw;
  }

  // The test hook.
  window.setPedalInput = setRaw;

  function setSource(fn) { source = fn; }

  function init() {
    slider = document.getElementById('pedal-slider');
    if (slider) {
      slider.addEventListener('input', () => { raw = Number(slider.value); });
    }
    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') keyDir = 1;
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') keyDir = -1;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') { if (keyDir === 1) keyDir = 0; }
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') { if (keyDir === -1) keyDir = 0; }
    });
  }

  function update(dt) {
    if (source) {
      const v = source();
      if (v !== null && v !== undefined) setRaw(v);
    } else if (keyDir !== 0) {
      setRaw(raw + keyDir * Config.KEY_RATE * dt);
    }
    const k = 1 - Math.exp(-dt / Config.INPUT_TAU);
    filtered += (raw - filtered) * k;
  }

  function getPedal() { return filtered; }
  function getRaw() { return raw; }

  return { init, update, getPedal, getRaw, setSource };
})();
