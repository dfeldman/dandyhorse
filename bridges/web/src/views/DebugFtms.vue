<script setup lang="ts">
// The Exercise device console: one FTMS machine, raw control-point ops, and every byte both ways. Frames come from
// devicelib, so a speed typed here goes out in the machine's own units (Horizon 7-series: tenths of a km/h), exactly
// as a game's request would. The raw field sends bytes as typed.
import { computed, reactive, ref, shallowRef } from 'vue'
import { SimulatedTreadmill, fromHex, ftmsCodec, hex } from '@bikebike/devicelib'
import { adoptFtms, ftms, store } from '../bridge'
import { DevicelibDevice } from '../devices/DevicelibDevice'
import { fmtSpeed } from '../units'

const cmd = ftmsCodec.cmd
const local = shallowRef<DevicelibDevice | null>(null)
const dev = computed(() => local.value ?? ftms())
/** the simulated machine behind the device, when it is one: its own console buttons are shown */
const sim = computed(() => dev.value?.simulator ?? null)
const err = ref<string | null>(null)
const busy = ref(false)
const results = reactive<{ t: number; op: string; sent: string; result: string }[]>([])

const params = reactive({ speedKmh: 1, incline: 1, power: 100, wind: 0, grade: 2, crr: 0.004, cw: 0.51, stopMode: 1, raw: '' })

async function connect(): Promise<void> {
  err.value = null
  busy.value = true
  const d = new DevicelibDevice('fitness')
  local.value = d
  try { await d.connect() } catch (e) { err.value = (e as Error).message; local.value = null } finally { busy.value = false }
}
/**
 * devicelib's simulated treadmills: the real Bluetooth code over its mock transport. The Horizon one behaves like the
 * measured 7.0AT (tenths of a km/h, no incline in its data, no status messages). Usable in debug sessions.
 */
async function connectSimulated(horizon: boolean): Promise<void> {
  err.value = null
  busy.value = true
  const machine = new SimulatedTreadmill(horizon ? { horizonVendorService: true, horizonFirmware: true } : {})
  machine.start()
  const d = new DevicelibDevice('fitness', { simulator: machine })
  local.value = d
  try { await d.connectTo(machine.peripheral) } catch (e) { err.value = (e as Error).message; local.value = null; machine.stop() } finally { busy.value = false }
}
async function disconnect(): Promise<void> {
  if (dev.value) await dev.value.disconnect()
  local.value = null
}
async function useInSession(): Promise<void> {
  if (local.value) { await adoptFtms(local.value); local.value = null }
}

async function send(op: string, bytes: Uint8Array | null): Promise<void> {
  const d = dev.value
  if (!d) return
  if (!bytes?.length) { err.value = 'Type the frame as hex bytes, for example 02 0a 00.'; return }
  busy.value = true
  try {
    const r = await d.rawControl(bytes)
    results.unshift({ t: Date.now(), op, sent: r.sent, result: r.result })
    if (results.length > 30) results.splice(30)
  } finally { busy.value = false }
}

function parseRaw(text: string): Uint8Array | null {
  const t = text.trim()
  return /^[0-9a-fA-F]{2}(\s*[0-9a-fA-F]{2})*$/.test(t) ? fromHex(t) : null
}
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const frames = computed(() => {
  const d = dev.value
  void d?.info.quirkFlags.length // recompute once the machine is identified
  return {
    speed: d ? d.speedFrame(num(params.speedKmh)) : cmd.setSpeed(num(params.speedKmh)),
    incline: cmd.setIncline(num(params.incline)),
    power: cmd.setPower(num(params.power)),
    sim: cmd.setSimulation({ windMps: num(params.wind), gradePct: num(params.grade), crr: num(params.crr), cwKgPerM: num(params.cw) }),
    stop: params.stopMode === 2 ? cmd.pause() : cmd.stop(),
    start: cmd.start(),
    raw: parseRaw(params.raw),
  }
})
const tenths = computed(() => !!dev.value?.info.quirkFlags.includes('speed_sent_in_tenth_kmh'))
const moving = computed(() => (dev.value?.actual.speed ?? 0) > 0)
const control = computed(() => {
  const i = dev.value?.info
  if (!i) return ''
  if (!i.hasControlPoint) return 'no control point: read-only'
  return i.controlRefused ? 'refused: watching only' : 'granted'
})

const fmtT = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour12: false })
const eventsRev = computed(() => (dev.value ? [...dev.value.events].reverse().slice(0, 100) : []))
type R = { min: number; max: number; step: number } | null | undefined
const rng = (r: R, f: (v: number) => string) => (r ? `${f(r.min)} … ${f(r.max)} step ${f(r.step)}` : 'not known')
const spd = (v: number) => fmtSpeed(v, store.unitSystem, 2)
const n2 = (v: number) => String(Math.round(v * 100) / 100)
/** The machine's own Supported Range bytes, decoded the way the FTMS spec defines them. */
function rawRange(kind: 'speed' | 'incline' | 'power'): string {
  const h = dev.value?.info.rawRanges[kind]
  if (!h) return 'not reported'
  const b = fromHex(h)
  const r = kind === 'speed' ? ftmsCodec.parseSpeedRange(b) : kind === 'incline' ? ftmsCodec.parseInclineRange(b) : ftmsCodec.parsePowerRange(b)
  const unit = kind === 'speed' ? ' km/h' : kind === 'incline' ? ' %' : ' W'
  return `[${h}] = ${n2(r.min)} … ${n2(r.max)} step ${n2(r.step)}${unit} as the spec reads it`
}
</script>

<template>
  <div class="tab">
  <div v-if="err" class="banner bad">{{ err }}<span class="spacer"></span><button @click="err = null">Dismiss</button></div>

  <div class="card">
    <h3>Device</h3>
    <p v-if="store.bluetoothReason" class="muted">{{ store.bluetoothReason }}</p>
    <div class="row">
      <button class="primary" :disabled="!!store.bluetoothReason || busy || !!dev" @click="connect">Connect FTMS device</button>
      <button :disabled="!dev" @click="disconnect">Disconnect</button>
      <button v-if="local" class="primary" :disabled="local.status === 'disconnected' || local.status === 'connecting'" @click="useInSession">Use in session</button>
      <span v-if="local && local.simulator" class="muted small">debug sessions only</span>
      <span v-if="!local && ftms()" class="muted">Showing the session's device.</span>
    </div>
    <div v-if="!dev" class="row" style="margin-top: 8px">
      <button class="small" :disabled="busy" @click="connectSimulated(false)">Simulated FTMS treadmill</button>
      <button class="small" :disabled="busy" @click="connectSimulated(true)">Simulated Horizon 7.0AT</button>
      <span class="muted small">devicelib's simulators run the real Bluetooth code without hardware; usable in debug sessions.</span>
    </div>
    <template v-if="dev">
      <div class="grid2" style="margin-top: 10px">
        <div><span class="muted">name</span><br /><b>{{ dev.name }}</b><span v-if="dev.simulator" class="muted"> (simulated)</span></div>
        <div><span class="muted">id</span><br /><span class="mono">{{ dev.address || '–' }}</span></div>
        <div><span class="muted">type</span><br /><b>{{ dev.type }}</b></div>
        <div><span class="muted">status</span><br /><b>{{ dev.status }}</b> <span class="muted">control: {{ control }}</span></div>
        <div><span class="muted">protocol</span><br /><b>{{ dev.info.protocolName ?? '–' }}</b> <span class="muted">{{ dev.info.selectionNote }}</span></div>
        <div><span class="muted">devicelib registry entry</span><br /><span class="mono">{{ dev.info.entryId ?? 'none: plain FTMS' }}</span></div>
      </div>
      <div style="margin-top: 6px"><span class="muted">quirks in force:</span> <span class="mono">{{ dev.info.quirkFlags.join(', ') || 'none' }}</span></div>
      <h3 style="margin-top: 10px">Feature 0x2ACC</h3>
      <div v-if="dev.info.feature" class="mono">
        machine 0x{{ dev.info.feature.machineRaw.toString(16).padStart(8, '0') }}: {{ dev.info.feature.machine.join(', ') || 'none' }}<br />
        target 0x{{ dev.info.feature.targetRaw.toString(16).padStart(8, '0') }}: {{ dev.info.feature.target.join(', ') || 'none' }}
      </div>
      <div v-else class="muted">not read</div>
      <h3 style="margin-top: 10px">Ranges</h3>
      <div class="mono">
        in use: speed {{ rng(dev.features.speedRange, spd) }} · incline {{ rng(dev.features.inclineRange, (v) => v.toFixed(1) + ' %') }} · power {{ rng(dev.features.powerRange, (v) => v.toFixed(0) + ' W') }}<br />
        reported speed: {{ rawRange('speed') }}<br />
        reported incline: {{ rawRange('incline') }}<br />
        reported power: {{ rawRange('power') }}
      </div>
      <p class="muted small" style="margin: 4px 0 0">For a model devicelib knows, its registry limits win over what the machine reports.</p>
      <h3 style="margin-top: 10px">Last data</h3>
      <div class="mono">{{ dev.info.lastData ? JSON.stringify(dev.info.lastData) : 'no notifications yet' }}</div>
      <div class="mono muted">machine status: {{ dev.info.lastStatus ?? '–' }}</div>
    </template>
  </div>

  <div class="card" v-if="sim">
    <h3>The simulated treadmill's own buttons</h3>
    <div class="row">
      <button @click="sim.userStart()">Start</button>
      <button @click="sim.userSpeed(-0.5)">Speed −0.5 km/h</button>
      <button @click="sim.userSpeed(0.5)">Speed +0.5 km/h</button>
      <button @click="sim.userSpeed(2)">Speed +2 km/h</button>
      <button class="danger" @click="sim.userStop()">Stop</button>
    </div>
    <p class="muted small" style="margin: 6px 0 0">As the person on the machine would press them. {{ sim.horizonFirmware ? 'Like the real Horizon, it reports none of these presses to the bridge.' : 'It reports them in Machine Status, as FTMS asks.' }}</p>
  </div>

  <div class="card" v-if="dev">
    <h3>Control point ops</h3>
    <div class="row">
      <button :disabled="busy" @click="send('Request Control', cmd.requestControl())">Request control <span class="mono muted">00</span></button>
      <button :disabled="busy" @click="send('Reset', cmd.reset())">Reset <span class="mono muted">01</span></button>
      <button :disabled="busy" @click="send('Start', frames.start)">Start <span class="mono muted">{{ hex(frames.start) }}</span></button>
      <button class="danger" :disabled="busy" @click="send(params.stopMode === 2 ? 'Pause' : 'Stop', frames.stop)">{{ params.stopMode === 2 ? 'Pause' : 'Stop' }} <span class="mono">{{ hex(frames.stop) }}</span></button>
      <select v-model.number="params.stopMode" style="width: auto"><option :value="1">stop</option><option :value="2">pause</option></select>
    </div>
    <div class="grid2" style="margin-top: 10px">
      <div>
        <label class="field"><span>target speed (km/h)</span><input type="number" step="0.1" min="0" v-model.number="params.speedKmh" /></label>
        <button :disabled="busy" @click="send('Set Target Speed', frames.speed)">Send <span class="mono muted">{{ hex(frames.speed) }}</span></button>
        <p v-if="tenths" class="muted small" style="margin: 6px 0 0">Sent in tenths of a km/h: this machine's firmware reads the speed field that way.</p>
        <p v-if="moving" class="muted small" style="margin: 6px 0 0">The belt is moving; keep the safety clip on.</p>
      </div>
      <div>
        <label class="field"><span>target incline (%)</span><input type="number" step="0.1" v-model.number="params.incline" /></label>
        <button :disabled="busy" @click="send('Set Target Inclination', frames.incline)">Send <span class="mono muted">{{ hex(frames.incline) }}</span></button>
      </div>
      <div>
        <label class="field"><span>target power (W)</span><input type="number" step="1" v-model.number="params.power" /></label>
        <button :disabled="busy" @click="send('Set Target Power', frames.power)">Send <span class="mono muted">{{ hex(frames.power) }}</span></button>
      </div>
      <div>
        <label class="field"><span>sim: wind m/s / grade % / crr / cw</span>
          <div class="row">
            <input type="number" step="0.1" v-model.number="params.wind" style="width: 22%" />
            <input type="number" step="0.1" v-model.number="params.grade" style="width: 22%" />
            <input type="number" step="0.0001" v-model.number="params.crr" style="width: 22%" />
            <input type="number" step="0.01" v-model.number="params.cw" style="width: 22%" />
          </div>
        </label>
        <button :disabled="busy" @click="send('Set Indoor Bike Simulation', frames.sim)">Send <span class="mono muted">{{ hex(frames.sim) }}</span></button>
      </div>
      <div>
        <label class="field"><span>raw frame (hex, sent exactly as typed)</span><input type="text" class="mono" v-model="params.raw" placeholder="02 0a 00" /></label>
        <button :disabled="busy || !frames.raw" @click="send('Raw', frames.raw)">Send raw</button>
      </div>
    </div>
    <h3 style="margin-top: 10px">Results</h3>
    <div class="log mono">
      <div v-for="(r, i) in results" :key="i"><span>{{ fmtT(r.t) }}</span><span>{{ r.op }}</span><span>{{ r.sent }}</span><span>{{ r.result }}</span></div>
      <div v-if="!results.length" class="muted">nothing sent yet</div>
    </div>
  </div>

  <div class="card" v-if="dev">
    <h3>Live stream (every byte both ways, and devicelib's log)</h3>
    <div class="events mono">
      <div v-for="(e, i) in eventsRev" :key="i" :class="e.kind"><span class="k">{{ e.kind }}</span>{{ fmtT(e.t) }} {{ e.text }} <span v-if="e.hex" class="muted">[{{ e.hex }}]</span></div>
      <div v-if="!eventsRev.length" class="muted">no events yet</div>
    </div>
  </div>

  <div class="card" v-if="!dev">
    <p class="muted">Connect a device here to verify it responds before using it in a session. Nothing here talks to the server; a device connected on this tab can be handed to the session with "Use in session".</p>
  </div>
  </div>
</template>
