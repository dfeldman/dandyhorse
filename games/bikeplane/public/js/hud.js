// Plain DOM overlay HUD: score, lap, timer, altitude bar with next-ring
// marker, climb/descend cue, passes, float chip, popups, banners, pause and end screens.
const Hud = (() => {
  let el = {};
  let over = false;   // the end screen is up: no more cues

  function init() {
    el.score = document.getElementById('hud-score');
    el.lap = document.getElementById('hud-lap');
    el.ringsCount = document.getElementById('hud-rings');
    el.passes = document.getElementById('hud-passes');
    el.timer = document.getElementById('hud-timer');
    el.floatChip = document.getElementById('float-chip');
    el.altBar = document.getElementById('alt-bar');
    el.planeMarker = document.getElementById('alt-plane');
    el.ghost = document.getElementById('alt-ghost');
    el.ringMarker = document.getElementById('alt-ring');
    el.cue = document.getElementById('hud-cue');
    el.banner = document.getElementById('hud-banner');
    el.popups = document.getElementById('popups');
    el.pedalReadout = document.getElementById('pedal-readout');
    el.end = document.getElementById('end-overlay');
    el.endStats = document.getElementById('end-stats');
    el.pause = document.getElementById('pause-overlay');
    el.pauseMsg = document.getElementById('pause-msg');
    el.resistFill = document.getElementById('resist-fill');
    el.resistNum = document.getElementById('resist-num');
    el.turboSegs = Array.from(document.querySelectorAll('#turbo-meter .seg'));
    el.turboWrap = document.getElementById('turbo-wrap');
    el.turboChip = document.getElementById('turbo-chip');
    el.raceChip = document.getElementById('race-chip');
    el.windChip = document.getElementById('wind-chip');
    el.instSpd = document.getElementById('inst-spd');
    el.instAlt = document.getElementById('inst-alt');
    el.instDist = document.getElementById('inst-dist');
    el.instSpdU = document.getElementById('inst-spd-u');
    el.instAltU = document.getElementById('inst-alt-u');
    el.instDistU = document.getElementById('inst-dist-u');
  }

  function altToPct(alt) {
    const lo = Config.MIN_ALT - 10, hi = Config.MAX_ALT;
    return 100 - Math.max(0, Math.min(100, ((alt - lo) / (hi - lo)) * 100));
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.ceil(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  function setInst(value, unit, q) {
    value.textContent = q.value;
    unit.textContent = q.unit.toUpperCase();
  }

  function update(state, pedal, next, extra) {
    el.planeMarker.style.top = altToPct(state.alt) + '%';
    // Judge where the plane will be CUE_LEAD s from now, not where it is. The rider's effort reaches the
    // plane seconds late, so a cue that says hold only on arrival makes them overshoot (PLAYABILITY.md).
    // The ghost on the altitude bar shows that height.
    const flying = state.phase === 'FLYING' && !over;
    const ahead = state.alt + (flying ? state.speed * Math.tan(state.pitch) * Config.CUE_LEAD : 0);
    el.ghost.style.display = flying ? 'block' : 'none';
    el.ghost.style.top = altToPct(ahead) + '%';
    if (next) {
      el.ringMarker.style.display = 'block';
      el.ringMarker.style.top = altToPct(next.alt) + '%';
      el.ringMarker.classList.toggle('red', next.type === 'red');
      const diff = next.alt - ahead;
      const band = (next.type === 'red' ? Config.RED_RING_HIT_TOL : Config.RING_HIT_TOL) / 2;
      if (!flying) {
        el.cue.textContent = '';
      } else if (diff > band) {
        el.cue.textContent = '▲ PEDAL FASTER!';
        el.cue.className = 'hud cue climb';
      } else if (diff < -band) {
        el.cue.textContent = '▼ EASE OFF!';
        el.cue.className = 'hud cue descend';
      } else {
        el.cue.textContent = '● HOLD IT!';
        el.cue.className = 'hud cue hold';
      }
    }
    el.lap.textContent = 'LAP ' + state.lap;
    el.pedalReadout.textContent = Math.round(pedal);
    if (extra) {
      el.timer.textContent = fmtTime(extra.timeLeft);
      el.timer.classList.toggle('low', extra.timeLeft < 60);
      el.passes.textContent = '★'.repeat(extra.passes) + '☆'.repeat(Config.MAX_PASSES - extra.passes);
      if (extra.floatLeft > 0) {
        el.floatChip.style.display = 'block';
        el.floatChip.textContent = '🎈 FLOAT ' + Math.ceil(extra.floatLeft) + 's';
      } else {
        el.floatChip.style.display = 'none';
      }
      // Tailwind stacks
      if (extra.tailwindCount > 0) {
        el.windChip.style.display = 'block';
        el.windChip.textContent = '💨 TAILWIND ×' + extra.tailwindCount + ' · ' + Math.ceil(extra.tailwindLeft) + 's';
      } else {
        el.windChip.style.display = 'none';
      }
      // Flight instruments
      setInst(el.instSpd, el.instSpdU, extra.inst.spd);
      setInst(el.instAlt, el.instAltU, extra.inst.alt);
      setInst(el.instDist, el.instDistU, extra.inst.dist);
      // Trainer resistance (always shown so the rider knows what the pedals
      // are about to do)
      const rz = Math.round(extra.resistance);
      el.resistFill.style.width = rz + '%';
      el.resistFill.classList.toggle('hard', rz > 62);
      el.resistFill.classList.toggle('easy', rz < 28);
      el.resistNum.textContent = rz;
      // Turbo meter
      el.turboSegs.forEach((seg, i) => seg.classList.toggle('lit', i < extra.turboMeter));
      el.turboWrap.classList.toggle('ready', extra.turboMeter >= el.turboSegs.length);
      if (extra.turboLeft > 0) {
        el.turboChip.style.display = 'block';
        el.turboChip.textContent = '🔥 TURBO ' + Math.ceil(extra.turboLeft) + 's — 2× POINTS!';
      } else {
        el.turboChip.style.display = 'none';
      }
      // Race position
      if (extra.race) {
        el.raceChip.style.display = 'block';
        const g = extra.race.gap;
        el.raceChip.textContent = '🏁 P' + extra.race.pos + '/' + extra.race.total +
          (extra.race.pos === 1 ? ' · +' + g + 'm lead' : ' · ' + g + 'm behind') +
          ' · ' + extra.race.lapsLeft;
        el.raceChip.classList.toggle('leading', extra.race.pos === 1);
      } else {
        el.raceChip.style.display = 'none';
      }
    }
  }

  function setScore(score, ringsHit, ringsTotal) {
    el.score.textContent = score;
    el.ringsCount.textContent = ringsHit + ' / ' + ringsTotal;
  }

  function popup(text, cls) {
    const d = document.createElement('div');
    d.className = 'popup ' + (cls || '');
    d.textContent = text;
    d.style.left = (45 + Math.random() * 10) + '%';
    el.popups.appendChild(d);
    setTimeout(() => d.remove(), 1400);
  }

  function banner(text, ms) {
    el.banner.textContent = text;
    el.banner.classList.add('show');
    if (ms) setTimeout(() => el.banner.classList.remove('show'), ms);
  }

  function hideBanner() { el.banner.classList.remove('show'); }
  function lapBanner(lap) { banner('LAP ' + lap + '!', 2500); }

  // The session is paused (message) or not (null).
  function pause(message) {
    el.pause.classList.toggle('show', message !== null);
    if (message !== null) el.pauseMsg.textContent = message;
  }

  function endScreen(stats) {
    const row = (label, value, cls) => {
      const d = document.createElement('div');
      d.className = cls || 'end-row';
      if (label) {
        const b = document.createElement('b');
        b.textContent = value;
        d.append(label + ' ', b);
      } else {
        d.textContent = value;
      }
      return d;
    };
    const top = document.createElement('div');
    top.className = 'end-score';
    top.textContent = stats.score;
    const rows = [
      top,
      row('Rings:', stats.ringsHit + ' / ' + stats.ringsPassed),
      row('Laps:', String(stats.laps)),
      row('Distance:', stats.distance.value + ' ' + stats.distance.unit),
    ];
    if (stats.best) rows.push(row(null, stats.best.isNew ? '★ A new best!' : 'Your best: ' + stats.best.best, 'end-row small'));
    if (stats.again) rows.push(row(null, stats.again, 'end-row small'));
    el.endStats.replaceChildren(...rows);
    el.end.classList.add('show');
    over = true;
    el.cue.textContent = '';
    el.ghost.style.display = 'none';
  }

  return { init, update, setScore, popup, banner, hideBanner, lapBanner, pause, endScreen };
})();
