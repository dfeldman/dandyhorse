// devicelib bench: connect a real device over Web Bluetooth, or a simulator, and drive it.
import { DeviceManager, Logger, TraceRecorder, WebBluetoothAdapter, createSimulatorAdapter, uuidLabel } from '../dist/index.js';

const $ = (id) => document.getElementById(id);
const recorder = new TraceRecorder();
const logLines = [];
const log = new Logger({
  level: 'debug',
  sinks: [
    recorder,
    {
      log: (r) => pushLog(`${r.level.padEnd(5)} ${r.source.replace(/^devicelib\//, '')}: ${r.message}`),
      trace: (r) => $('show-traces').checked && pushLog(`  ${r.dir === 'tx' ? '→' : '←'} ${r.label.padEnd(18)} ${r.hex}`),
    },
  ],
});

function pushLog(line) {
  logLines.push(line);
  if (logLines.length > 400) logLines.shift();
  const el = $('log');
  el.textContent = logLines.join('\n');
  el.scrollTop = el.scrollHeight;
}

let manager;
let session;

function options() {
  return { log, zwiftProtocol: $('opt-zwift').checked, vendorControl: $('opt-vendor').checked };
}

async function connectWith(adapter, pickFirst) {
  try {
    await manager?.disconnectAll();
    manager = new DeviceManager(adapter, options());
    manager.events.on('telemetry', renderTelemetry);
    const device = pickFirst ? (await adapter.getKnownDevices())[0] : await manager.requestDevice();
    session = await manager.connect(device, options());
    session.events.on('state', renderState);
    session.events.on('info', renderInfo);
    session.events.on('notice', (n) => pushLog(`notice ${n.kind}: ${n.message}`));
    renderState(session.state);
    renderInfo(session.info);
  } catch (err) {
    pushLog(`error: ${err.message ?? err}`);
    renderState('failed');
  }
}

$('connect').onclick = () => connectWith(new WebBluetoothAdapter(), false);
$('sim-treadmill').onclick = () => connectWith(createSimulatorAdapter({ treadmill: { horizonVendorService: true }, bike: false }).adapter, true);
$('sim-bike').onclick = () => connectWith(createSimulatorAdapter({ treadmill: false, bike: { zwiftHub: true } }).adapter, true);
$('disconnect').onclick = async () => {
  await manager?.disconnectAll();
  session = undefined;
  renderState('disconnected');
};
$('protocol-pref').onchange = async (e) => {
  await session?.setProtocolPreference(e.target.value);
};
$('capture').onclick = () => {
  const blob = new Blob([JSON.stringify({ info: session?.info, ...recorder.toJSON() }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `devicelib-capture-${(session?.info.deviceName ?? 'device').replace(/\W+/g, '_')}.json`;
  a.click();
};

const bind = (id, fmt, apply) => {
  $(id).oninput = () => {
    const v = Number($(id).value);
    $(`${id}-out`).textContent = fmt(v);
    apply(v);
  };
};
bind('speed', (v) => `${v.toFixed(1)} km/h`, (v) => session?.setTargetSpeed(v));
bind('incline', (v) => `${v.toFixed(1)} %`, (v) => session?.setTargetIncline(v));
bind('grade', (v) => `${v.toFixed(1)} %`, (v) => session?.setGrade(v));
bind('power', (v) => `${v} W`, () => {});
$('erg').onclick = () => session?.setTargetPower(Number($('power').value));
$('up').onclick = () => ($('gear-out').textContent = session?.shiftUp() ?? '');
$('down').onclick = () => ($('gear-out').textContent = session?.shiftDown() ?? '');
$('start').onclick = () => session?.start();
$('pause').onclick = () => session?.pause();
$('stop').onclick = () => {
  $('speed').value = 0;
  $('speed-out').textContent = '0.0 km/h';
  session?.stop();
};

// ---------------------------------------------------------------- FTMS speed units test

const KMH_TO_MPH = 0.621371;
const RAW_SPEEDS = [10, 20, 30, 40, 50];
const hex2 = (b) => b.toString(16).padStart(2, '0');
const frameHex = (f) => Array.from(f, hex2).join(' ');

function readings(raw) {
  const std = raw / 100;
  const tenthKmh = raw / 10;
  return {
    std: `${std.toFixed(2)} km/h, ${(std * KMH_TO_MPH).toFixed(2)} mph`,
    tenthKmh: `${tenthKmh.toFixed(1)} km/h, ${(tenthKmh * KMH_TO_MPH).toFixed(1)} mph`,
    tenthMph: `${(raw / 10).toFixed(1)} mph`,
  };
}

$('units-rows').innerHTML = RAW_SPEEDS.map((n) => {
  const r = readings(n);
  return `<tr><td><button data-raw="${n}">Send ${n}</button> <code>02 ${hex2(n & 0xff)} ${hex2(n >> 8)}</code></td>` +
    `<td>${r.std}</td><td>${r.tenthKmh}</td><td>${r.tenthMph}</td></tr>`;
}).join('');

function rawOut(line) {
  const el = $('raw-out');
  el.textContent = (el.textContent === 'Results appear here.' ? '' : `${el.textContent}\n`) + line;
  el.scrollTop = el.scrollHeight;
}

function releaseSpeedTarget() {
  // Clear the slider's target so the tick loop does not undo the raw command.
  session?.setTargetSpeed(undefined);
  $('speed').value = 0;
  $('speed-out').textContent = '—';
}

async function sendFrames(label, frames) {
  if (!session) return;
  releaseSpeedTarget();
  const results = [];
  try {
    for (const f of frames) results.push(`${frameHex(f)} → ${await session.sendRawControl(Uint8Array.from(f))}`);
  } catch (err) {
    results.push(`error: ${err.message ?? err}`);
  }
  rawOut(`${new Date().toLocaleTimeString()}  ${label}: ${results.join(', ')}`);
}

$('units-rows').onclick = (e) => {
  const n = Number(e.target.dataset?.raw);
  if (n) sendFrames(`raw ${n}`, [[0x00], [0x07], [0x02, n & 0xff, n >> 8]]);
};
$('raw-stop').onclick = () => sendFrames('stop', [[0x08, 0x01]]);
$('raw-range').onclick = async () => {
  try {
    const d = await session.readRaw('00002ad4-0000-1000-8000-00805f9b34fb');
    const u16 = (i) => d[i] | (d[i + 1] << 8);
    const [min, max, step] = [u16(0), u16(2), u16(4)];
    rawOut(`speed range ${frameHex(d)}: raw min ${min}, max ${max}, step ${step}`);
    rawOut(`  standard: ${(min / 100).toFixed(2)} to ${(max / 100).toFixed(2)} km/h;  if 0.1 km/h: ${(min / 10).toFixed(1)} to ${(max / 10).toFixed(1)} km/h;  if 0.1 mph: ${(min / 10).toFixed(1)} to ${(max / 10).toFixed(1)} mph`);
  } catch (err) {
    rawOut(`speed range: ${err.message ?? err}`);
  }
};

function renderReportedRaw(t) {
  if (t.speedKmh === undefined || t.computed.includes('speedKmh')) {
    $('raw-reported').textContent = '—';
    return;
  }
  const raw = Math.round(t.speedKmh * 100);
  const r = readings(raw);
  $('raw-reported').textContent = `raw ${raw}: standard ${r.std} · if 0.1 km/h ${r.tenthKmh} · if 0.1 mph ${r.tenthMph}`;
}

function renderState(state) {
  const pill = $('state');
  pill.textContent = state;
  pill.className = `pill ${state === 'ready' ? 'ready' : state === 'failed' || state === 'reconnecting' ? 'bad' : ''}`;
  $('disconnect').disabled = !session;
  $('capture').disabled = !session;
}

function renderInfo(info) {
  const rows = [
    ['Name', info.deviceName ?? '(no name)'],
    ['Type', info.deviceClass],
    ['Protocol', info.protocolName],
    ['Why', info.selectionNote],
    ['Registry entry', info.entry ? `${info.entry.id} (${info.entry.recommend})` : 'none'],
    ['Maker / model', [info.deviceInformation.manufacturer, info.deviceInformation.model].filter(Boolean).join(' ') || 'not reported'],
    ['Firmware', info.deviceInformation.firmware ?? 'not reported'],
    ['Can do', Object.entries(session.capabilities).filter(([k, v]) => v === true).map(([k]) => k).join(', ') || 'read only'],
  ];
  if (info.unhandledFlags.length) rows.push(['Quirks not implemented', info.unhandledFlags.join(', ')]);
  if (info.variants.length) rows.push(['Possible variants', info.variants.map((v) => v.option).join(', ')]);
  $('info').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(String(v))}</dd>`).join('');
  $('protocol-switch').hidden = !info.protocolOptions.switchable;
  $('units-test').hidden = !(info.deviceClass === 'treadmill' && info.protocolId === 'ftms');
  $('protocol-pref').value = info.protocolOptions.preference;
  $('gatt').textContent = info.gatt.services
    .map((s) => [`${uuidLabel(s.uuid)}  ${s.uuid}`, ...s.characteristics.map((c) => `   ${uuidLabel(c.uuid).padEnd(18)} ${Object.entries(c.properties).filter(([, v]) => v).map(([k]) => k).join(',')}`)].join('\n'))
    .join('\n');
  for (const el of document.querySelectorAll('[data-for]')) {
    const cls = info.deviceClass;
    el.hidden = !(el.dataset.for === cls || (el.dataset.for === 'bike' && (cls === 'elliptical' || cls === 'rower')));
  }
  const lim = session.capabilities.limits;
  if (lim.speedKmh) $('speed').max = lim.speedKmh.max;
  if (lim.inclinePct) { $('incline').min = lim.inclinePct.min; $('incline').max = lim.inclinePct.max; $('incline').step = lim.inclinePct.step; }
}

const METRICS = [
  ['speedKmh', 'Speed', (v) => `${v.toFixed(1)} km/h`],
  ['inclinePct', 'Incline', (v) => `${v.toFixed(1)} %`],
  ['powerW', 'Power', (v) => `${Math.round(v)} W`],
  ['cadenceRpm', 'Cadence', (v) => `${Math.round(v)}`],
  ['heartRateBpm', 'Heart rate', (v) => `${v} bpm`],
  ['resistanceLevel', 'Resistance', (v) => `${v}`],
  ['distanceM', 'Distance', (v) => `${(v / 1000).toFixed(2)} km`],
  ['elapsedS', 'Time', (v) => `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}`],
  ['energyKcal', 'Energy', (v) => `${Math.round(v)} kcal`],
];

function renderTelemetry(t) {
  $('metrics').innerHTML = METRICS.map(([key, label, fmt]) => {
    const v = t[key];
    const computed = t.computed.includes(key);
    return `<div class="metric ${computed ? 'computed' : ''}"><small>${label}</small><b>${v === undefined ? '—' : fmt(v)}</b></div>`;
  }).join('') + `<div class="metric"><small>Data</small><b>${t.fresh ? 'live' : 'stale'}</b></div>`;
  if (t.gear !== undefined) $('gear-out').textContent = t.gear;
  renderReportedRaw(t);
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

renderTelemetry({ computed: [], fresh: false });
