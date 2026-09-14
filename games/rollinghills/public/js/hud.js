// On-screen readouts: speed, grade, distance, timer, heart rate, what the game asks the machine
// for, elevation profile with rider marker, segment timer, weather/area chips, pause and end
// overlays. Units come from the platform (the user's unit system), never hardcoded.
const Hud = (() => {
  const el = {};
  let bannerTimer = null;
  let profile = null;   // offscreen canvas with the static profile
  let fmt = null;       // platform formatters: speed(m/s) / distance(m) -> {value, unit}
  let isBike = true;

  function init(platform) {
    fmt = platform.fmt;
    isBike = Config.DEVICE_TYPE === 'bike';
    for (const id of ['speed', 'speed-unit', 'grade', 'dist', 'laps', 'timer', 'machine-label', 'machine-num', 'machine-sub', 'machine-fill',
      'banner', 'seed', 'power', 'hr', 'grade-arrow', 'profile', 'seg-chip', 'seg-name', 'seg-time', 'seg-best', 'area-chip', 'weather-chip',
      'time-chip', 'pause', 'pause-msg', 'ended', 'ended-title', 'ended-sub'])
      el[id] = document.getElementById(id);
    el.seed.textContent = `seed ${Config.SEED} · ${Config.ROUTE.label.toLowerCase()}`;
    el['speed-unit'].textContent = fmt.speed(0).unit;
    el['machine-label'].textContent = isBike ? 'TRAINER GRADE' : 'INCLINE';
    el.power.style.display = isBike ? '' : 'none';
  }

  function fmtTime(t) { t = Math.max(0, Math.floor(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); }
  function fmtSeg(t) { const m = Math.floor(t / 60), s = t - m * 60; return (m ? m + ':' : '') + (m ? String(s.toFixed(1)).padStart(4, '0') : s.toFixed(1)) + 's'; }

  // Draw the loop's elevation profile once, colored by biome, with segments marked.
  function buildProfile() {
    const c = el.profile, W = c.width, H = c.height;
    profile = document.createElement('canvas'); profile.width = W; profile.height = H;
    const g = profile.getContext('2d');
    const L = Track.length, N = W;
    const ys = [], names = [];
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < N; i++) { const p = Track.poseAt(i / N * L); ys.push(p.y); names.push(Biome.dominant(p.x, p.z).name); mn = Math.min(mn, p.y); mx = Math.max(mx, p.y); }
    const span = Math.max(12, mx - mn);
    const yPix = (y) => H - 6 - (y - mn) / span * (H - 16);
    const COL = {}; for (const n of Biome.POOL) COL[n] = Biome.DEF[n].profile;
    g.fillStyle = 'rgba(20,40,80,.55)'; g.beginPath(); g.roundRect(0, 0, W, H, 10); g.fill();
    for (let i = 0; i < N; i++) { g.fillStyle = COL[names[i]]; g.fillRect(i, yPix(ys[i]), 1, H - 4 - yPix(ys[i])); }
    // segment marks
    for (const seg of Segments.list) {
      const x0 = seg.s0 / L * W, x1 = seg.s1 / L * W;
      g.fillStyle = seg.kind === 'kom' ? 'rgba(255,90,90,.55)' : 'rgba(255,212,42,.55)';
      if (x1 > x0) g.fillRect(x0, 2, x1 - x0, 4); else { g.fillRect(x0, 2, W - x0, 4); g.fillRect(0, 2, x1, 4); }
    }
    g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1.5; g.beginPath();
    for (let i = 0; i < N; i++) { const y = yPix(ys[i]); if (i) g.lineTo(i, y); else g.moveTo(i, y); } g.stroke();
    profile.yAt = (s) => yPix(ys[Math.floor(((s / L) % 1 + 1) % 1 * N) % N]);
  }

  // Draw the profile plus the rider marker into any 2D context at a rectangle (HUD and session image).
  function drawProfileTo(g, x, y, w, h, s) {
    if (!profile) buildProfile();
    g.drawImage(profile, x, y, w, h);
    const mx = x + (s / Track.length) * w, my = y + profile.yAt(s) * (h / profile.height);
    g.fillStyle = '#fff'; g.strokeStyle = '#e8890c'; g.lineWidth = 3;
    g.beginPath(); g.arc(mx, my, 5, 0, Math.PI * 2); g.fill(); g.stroke();
  }

  function drawProfile(s) {
    const c = el.profile, g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    drawProfileTo(g, 0, 0, c.width, c.height, s);
  }

  // state: Ride state; m: measured values from the platform; workoutLeft: seconds
  function update(state, m, workoutLeft) {
    el.speed.textContent = fmt.speed(state.v).value;
    const gp = state.grade * 100;
    el.grade.textContent = (gp >= 0 ? '+' : '') + gp.toFixed(0) + '%';
    el['grade-arrow'].textContent = gp > 2.5 ? '⬈' : gp < -2.5 ? '⬊' : '➡';
    el.grade.className = gp > 2.5 ? 'up' : gp < -2.5 ? 'down' : '';
    const d = fmt.distance(state.dist);
    el.dist.textContent = `${d.value} ${d.unit}`;
    el.laps.textContent = 'LAP ' + (state.laps + 1);
    el.timer.textContent = fmtTime(workoutLeft);
    el.timer.classList.toggle('low', workoutLeft < 60 && workoutLeft > 0);
    if (isBike) el.power.textContent = m.power == null ? '– W' : Math.round(m.power) + ' W';
    el.hr.style.display = m.heartRate == null ? 'none' : 'block'; // #hr is display:none in the stylesheet
    if (m.heartRate != null) el.hr.textContent = '♥ ' + Math.round(m.heartRate);
    // what we ask the machine for, and what it reports
    const r = state.request;
    el['machine-num'].textContent = (r >= 0 ? '+' : '') + r.toFixed(1) + '%';
    el['machine-sub'].textContent = m.machineGrade == null ? '' : `machine ${m.machineGrade >= 0 ? '+' : ''}${m.machineGrade.toFixed(1)}%`;
    el['machine-fill'].style.width = Math.min(100, Math.abs(r) / 15 * 100) + '%';
    el['machine-fill'].className = r > 6 ? 'hard' : r < 0.5 ? 'easy' : '';
    drawProfile(state.s);
    const a = Segments.active;
    el['seg-chip'].style.display = a ? 'block' : 'none';
    if (a) {
      el['seg-name'].textContent = a.seg.name;
      el['seg-time'].textContent = fmtSeg(a.t);
      el['seg-best'].textContent = a.seg.best != null ? 'best ' + fmtSeg(a.seg.best) : '';
      el['seg-chip'].className = 'hud ' + a.seg.kind;
    }
  }

  function setArea(label) { el['area-chip'].textContent = label; }
  function setWeather(label) { el['weather-chip'].textContent = label; }
  let lastTime = null;
  function setTime(label) { if (label === lastTime) return; lastTime = label; el['time-chip'].textContent = label; el['time-chip'].style.display = label ? 'block' : 'none'; }

  function banner(text, ms = 1400) {
    el.banner.textContent = text;
    el.banner.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.banner.classList.remove('show'), ms);
  }
  function hideBanner() { clearTimeout(bannerTimer); el.banner.classList.remove('show'); }

  // The server's pause message is written for the user: show it as-is.
  function setPaused(on, message) {
    el.pause.classList.toggle('show', !!on);
    if (on) el['pause-msg'].textContent = message || 'Waiting for your machine…';
  }
  function showEnded(title, sub) {
    el['ended-title'].textContent = title;
    el['ended-sub'].textContent = sub || '';
    el.ended.classList.add('show');
    setPaused(false);
    hideBanner();
  }

  return { init, update, banner, hideBanner, setArea, setWeather, setTime, setPaused, showEnded, drawProfileTo, fmtSeg, fmtTime };
})();
