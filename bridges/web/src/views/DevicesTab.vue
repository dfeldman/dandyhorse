<script setup lang="ts">
// Devices: what is connected to this bridge, connect more, saved devices. Limits live in the console.
import { computed, ref } from 'vue'
import { connectFtms, connectHrm, disconnectFitness, disconnectHrm, forgetDevice, refreshDevices, renameDevice, simulator, simulatorHrm, store, toggleSimulator, toggleSimulatorHrm } from '../bridge'
import DeviceCard from '../components/DeviceCard.vue'
import { deviceWord } from '../ui'
import type { DeviceRow } from '../types'

const err = ref<string | null>(null)
const busy = ref(false)
const sim = computed(() => simulator())
const simAllowed = computed(() => (store.session ? store.session.debug : store.devTools) || store.devTools)
const renamingId = ref<number | null>(null)
const draft = ref('')

async function run(fn: () => Promise<unknown>): Promise<void> {
  err.value = null
  busy.value = true
  try { await fn() } catch (e) { err.value = (e as Error).message } finally { busy.value = false }
}
function onConnectExercise(): void {
  // first statement: Web Bluetooth needs the user gesture
  const p = connectFtms()
  void run(() => p)
}
function onConnectHrm(): void {
  const p = connectHrm()
  void run(() => p)
}

const isSimRow = (d: DeviceRow) => d.address.startsWith('sim:') || d.protocol === 'sim' || d.protocol === 'simulator'
const saved = computed(() => store.registered.filter((d) => store.techDetails || !isSimRow(d)))
function startRename(d: DeviceRow): void { renamingId.value = d.deviceId; draft.value = d.name }
async function saveRename(d: DeviceRow): Promise<void> {
  const name = draft.value.trim()
  if (name && name !== d.name) await run(() => renameDevice(d.deviceId, name))
  renamingId.value = null
}
async function forget(d: DeviceRow): Promise<void> {
  if (!window.confirm(`Forget ${d.name}? Its saved settings are removed too.`)) return
  await run(() => forgetDevice(d.deviceId))
}
function lastSeen(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const d = (Date.now() - t) / 1000
  if (d < 90) return 'just now'
  if (d < 3600) return `${Math.round(d / 60)} min ago`
  if (d < 86400 * 2) return `${Math.round(d / 3600)} h ago`
  return new Date(t).toLocaleDateString()
}
</script>

<template>
  <div class="tab" data-test="devices">
    <div v-if="err" class="banner bad"><span class="text">{{ err }}</span><button @click="err = null">Dismiss</button></div>

    <h3 style="margin: 4px 0 -4px">Connected to this bridge</h3>
    <DeviceCard v-if="store.fitness" :device="store.fitness" compact show-disconnect @disconnect="run(disconnectFitness)" />
    <DeviceCard v-if="store.hrm" :device="store.hrm" compact show-disconnect @disconnect="run(disconnectHrm)" />
    <div v-if="!store.fitness && !store.hrm" class="card empty flat">
      <p>Nothing connected yet.</p>
    </div>

    <h3 style="margin: 8px 0 -4px">Connect</h3>
    <div class="card">
      <p v-if="store.bluetoothReason" class="muted small">{{ store.bluetoothReason }}</p>
      <div class="actions">
        <button class="primary big block" :disabled="!!store.bluetoothReason || busy" @click="onConnectExercise">Exercise device</button>
        <button class="big block" :disabled="!!store.bluetoothReason || busy" @click="onConnectHrm">Heart rate monitor</button>
      </div>
      <div v-if="simAllowed" class="row" style="margin-top: 12px" data-test="sim-buttons">
        <button class="small" :class="{ primary: sim?.deviceType === 'treadmill' }" @click="run(() => toggleSimulator('treadmill'))">{{ sim?.deviceType === 'treadmill' ? 'Stop treadmill simulator' : 'Treadmill simulator' }}</button>
        <button class="small" :class="{ primary: sim?.deviceType === 'bike' }" @click="run(() => toggleSimulator('bike'))">{{ sim?.deviceType === 'bike' ? 'Stop bike simulator' : 'Bike simulator' }}</button>
        <button class="small" :class="{ primary: !!simulatorHrm() }" @click="run(toggleSimulatorHrm)">{{ simulatorHrm() ? 'Stop heart rate simulator' : 'Heart rate simulator' }}</button>
      </div>
    </div>

    <h3 style="margin: 8px 0 -4px">Saved devices</h3>
    <div class="card">
      <p v-if="!saved.length" class="muted">Devices are saved here when they connect.</p>
      <div v-else class="devlist">
        <div v-for="d in saved" :key="d.deviceId" class="devrow">
          <template v-if="renamingId === d.deviceId">
            <form @submit.prevent="saveRename(d)">
              <input type="text" v-model="draft" maxlength="80" autofocus />
              <button type="submit" class="primary">Save</button>
              <button type="button" @click="renamingId = null">Cancel</button>
            </form>
          </template>
          <template v-else>
            <div class="info">
              <b>{{ d.name }}</b>
              <span>{{ deviceWord(d.type, true) }} · last seen {{ lastSeen(d.lastSeenAt) }}</span>
              <span v-if="store.techDetails" class="mono"> · {{ d.address }} · {{ d.protocol }}</span>
            </div>
            <button class="small" @click="startRename(d)">Rename</button>
            <button class="small" @click="forget(d)">Forget</button>
          </template>
        </div>
      </div>
      <div class="row between" style="margin-top: 10px">
        <span class="muted small">Speed and incline limits are set in the console.</span>
        <button class="small ghost" @click="run(refreshDevices)">Refresh</button>
      </div>
    </div>
  </div>
</template>
