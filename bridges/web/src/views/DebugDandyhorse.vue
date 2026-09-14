<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { sendPutState, store } from '../bridge'
import SimulatorControls from '../components/SimulatorControls.vue'
import { COMMANDABLE, METRIC_NAMES } from '../types'

const fake = reactive({
  type: 'treadmill' as 'treadmill' | 'bike',
  status: 'simulated' as 'connected' | 'simulated' | 'readonly' | 'disconnected',
  address: 'fake:device',
  name: 'Fake device',
  hrm: false,
  commanded: Object.fromEntries(COMMANDABLE.map((m) => [m, ''])) as Record<string, string>,
  actual: Object.fromEntries(METRIC_NAMES.map((m) => [m, ''])) as Record<string, string>,
  urgent: false,
})
const fakeResponse = ref<string>('')

function nums(src: Record<string, string>): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  for (const [k, v] of Object.entries(src)) {
    const t = v.trim()
    out[k] = t === '' ? null : Number(t)
  }
  return out
}

async function sendFake(): Promise<void> {
  const devices: unknown[] = [{
    role: 'fitness', type: fake.type, name: fake.name, address: fake.address, protocol: 'fake', status: fake.status, features: {},
  }]
  if (fake.hrm) devices.push({ role: 'hrm', type: 'hrm', name: 'Fake HRM', address: 'fake:hrm', protocol: 'fake', status: fake.status })
  const body = {
    bridgeId: store.bridgeId, browserId: store.browserId, label: store.label, timestamp: Date.now() / 1000, devices,
    commanded: nums(fake.commanded), actual: nums(fake.actual), urgent: fake.urgent,
  }
  const r = await sendPutState(body)
  fakeResponse.value = JSON.stringify(r ?? store.lastPutResponse, null, 2)
}

const pretty = (v: unknown) => (v == null ? '(none yet)' : JSON.stringify(v, null, 2))
const logRev = computed(() => [...store.log].reverse())
const fmtT = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour12: false }) 
</script>

<template>
  <div class="tab">
  <SimulatorControls />

  <div class="card">
    <h3>Bridge</h3>
    <label class="chip"><input type="checkbox" v-model="store.muteReports" /> stop reporting to the server (simulate a sleeping tab or locked phone)</label>
  </div>

  <div class="card">
    <h3>Send fake putstate</h3>
    <p class="muted">Exercises the server without any driver. Leaves the real loop running; the server keeps only the newest report per bridgeId, so the next real putstate (≤ 1 s) overwrites it. Warning: this bridge's own report is replaced for that instant.</p>
    <div class="grid2">
      <label class="field"><span>device type</span><select v-model="fake.type"><option value="treadmill">treadmill</option><option value="bike">bike</option></select></label>
      <label class="field"><span>status</span><select v-model="fake.status"><option>simulated</option><option>connected</option><option>readonly</option><option>disconnected</option></select></label>
      <label class="field"><span>address</span><input type="text" v-model="fake.address" /></label>
      <label class="field"><span>name</span><input type="text" v-model="fake.name" /></label>
    </div>
    <label class="chip"><input type="checkbox" v-model="fake.hrm" /> also report a fake HRM</label>
    <label class="chip" style="margin-left: 8px"><input type="checkbox" v-model="fake.urgent" /> urgent</label>
    <h3 style="margin-top: 10px">commanded</h3>
    <div class="grid2">
      <label class="field" v-for="m in COMMANDABLE" :key="m"><span>{{ m }}</span><input type="number" step="any" v-model="fake.commanded[m]" placeholder="null" /></label>
    </div>
    <h3>actual</h3>
    <div class="grid2">
      <label class="field" v-for="m in METRIC_NAMES" :key="m"><span>{{ m }}</span><input type="number" step="any" v-model="fake.actual[m]" placeholder="null" /></label>
    </div>
    <div class="row"><button class="primary" @click="sendFake">Send fake putstate</button></div>
    <pre v-if="fakeResponse" style="margin-top: 8px">{{ fakeResponse }}</pre>
  </div>

  <div class="card">
    <h3>Round-trip log (last 50)</h3>
    <div class="log mono">
      <div v-for="(r, i) in logRev" :key="i" :class="{ bad: !r.ok }">
        <span>{{ fmtT(r.t) }}</span><span>{{ r.kind }}</span><span>{{ r.ms }} ms</span><span>{{ r.ok ? '' : 'FAIL ' + r.status + ' ' }}{{ r.note }}</span>
      </div>
    </div>
  </div>

  <div class="card">
    <h3>Identity</h3>
    <div class="mono">bridgeId {{ store.bridgeId }} (this tab only)<br />browserId {{ store.browserId }}<br />roles {{ JSON.stringify(store.roles) }}<br />label {{ store.label }}<br />lastSeq {{ store.lastSeq }} · unit system {{ store.unitSystem }}</div>
  </div>

  <div class="card">
    <h3>Last getstate response</h3>
    <pre>{{ pretty(store.lastGetState) }}</pre>
  </div>
  <div class="card">
    <h3>Last putstate request</h3>
    <pre>{{ pretty(store.lastPutRequest) }}</pre>
  </div>
  <div class="card">
    <h3>Last putstate response</h3>
    <pre>{{ pretty(store.lastPutResponse) }}</pre>
  </div>
  </div>
</template>
