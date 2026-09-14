// Pedal input, 0-100. Future bike trainer calls window.setPedalInput(v).
// Test harness: Up/Down (or W/S) arrows and the on-screen slider.
const Input = (() => {
  let raw = 0;        // latest commanded value 0-100
  let filtered = 0;   // low-pass filtered value the game reads
  let keyDir = 0;     // -1, 0, +1 while arrows held
  let slider = null;

  function setRaw(v) {
    raw = Math.max(0, Math.min(100, v));
    if (slider) slider.value = raw;
  }

  // The future trainer entry point (and automated-test hook).
  window.setPedalInput = setRaw;

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
    if (keyDir !== 0) setRaw(raw + keyDir * Config.KEY_RATE * dt);
    const k = 1 - Math.exp(-dt / Config.INPUT_TAU);
    filtered += (raw - filtered) * k;
  }

  function getPedal() { return filtered; }
  function getRaw() { return raw; }

  return { init, update, getPedal, getRaw };
})();
