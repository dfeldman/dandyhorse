<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { api, ApiError } from '../api'
import { store, loadMe, unitSystem } from '../session'
import type { Device, DevicePreferences, DeviceType } from '../types'
import { deviceTypeName } from '../status'
import * as u from '../units'

// The saved-device editor (rename, forget, limits, merge), a section of Preferences. Normal form; not laid
// out for the gamepad.
const devices = ref<Device[]>([])
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const sys = computed(() => unitSystem())
const open = reactive<Record<number, boolean>>({})

interface PrefField {
  key: keyof DevicePreferences & string
  label: string
  kind: 'speed' | 'accel' | 'percent' | 'number'
  step?: number
}
const FIELDS: PrefField[] = [
  { key: 'maxSpeed', label: 'Max speed', kind: 'speed' },
  { key: 'minSpeed', label: 'Min speed', kind: 'speed' },
  { key: 'maxIncline', label: 'Max incline (%)', kind: 'percent' },
  { key: 'minIncline', label: 'Min incline (%)', kind: 'percent' },
  { key: 'maxSpeedChangePerSecond', label: 'Max speed change / s', kind: 'accel' },
  { key: 'maxInclineChangePerSecond', label: 'Max incline change / s (%)', kind: 'percent' },
  { key: 'speedScale', label: 'Speed scale', kind: 'number', step: 0.01 },
  { key: 'inclineScale', label: 'Incline scale', kind: 'number', step: 0.01 },
  { key: 'gradeCap', label: 'Grade cap (%)', kind: 'percent' },
  { key: 'difficulty', label: 'Difficulty (0–2)', kind: 'number', step: 0.05 },
  { key: 'powerOffset', label: 'Power offset (W)', kind: 'number', step: 1 },
]

interface Form {
  name: string
  type: Device['type']
  prefs: Record<string, number | null>
  speedControl: boolean
  mergeInto: number | null
  busy: boolean
}
const forms = reactive<Record<number, Form>>({})

function toDisplay(f: PrefField, v: unknown): number | null {
  if (typeof v !== 'number') return null
  if (f.kind === 'speed') return u.speed(v, sys.value, 3).value
  if (f.kind === 'accel') return u.accel(v, sys.value, 3).value
  return v
}
function toSI(f: PrefField, v: number | null): number | null {
  if (v === null || Number.isNaN(v)) return null
  if (f.kind === 'speed' || f.kind === 'accel') return u.speedToSI(v, sys.value)
  return v
}
function unitFor(f: PrefField): string {
  if (f.kind === 'speed') return u.unitLabel('speed', sys.value)
  if (f.kind === 'accel') return u.unitLabel('accel', sys.value)
  return ''
}

function fill(d: Device) {
  forms[d.deviceId] = {
    name: d.name ?? '',
    type: d.type,
    prefs: Object.fromEntries(FIELDS.map((f) => [f.key, toDisplay(f, d.preferences[f.key])])),
    speedControl: d.preferences.speedControl === true,
    mergeInto: null,
    busy: false,
  }
}

async function load() {
  try {
    devices.value = (await api<{ devices: Device[] }>('/api/devices')).devices
    for (const d of devices.value) fill(d)
    error.value = null
  } catch (e) {
    error.value = (e as Error).message
  }
}
onMounted(load)

function say(msg: string) {
  notice.value = msg
  window.setTimeout(() => (notice.value = null), 2500)
}

async function save(d: Device) {
  const f = forms[d.deviceId]!
  f.busy = true
  try {
    const prefs: DevicePreferences = { ...d.preferences }
    for (const fld of FIELDS) {
      const v = toSI(fld, f.prefs[fld.key] ?? null)
      if (v === null) delete prefs[fld.key]
      else prefs[fld.key] = v
    }
    if (f.type === 'treadmill' && f.speedControl) prefs.speedControl = true
    else delete prefs.speedControl
    const updated = await api<Device>(`/api/devices/${d.deviceId}`, 'PUT', { name: f.name || d.name, type: f.type, preferences: prefs })
    devices.value = devices.value.map((x) => (x.deviceId === d.deviceId ? updated : x))
    fill(updated)
    say(`Saved ${updated.name}`)
  } catch (e) {
    error.value = e instanceof ApiError ? `${e.code}: ${e.message}` : (e as Error).message
  } finally {
    f.busy = false
  }
}

async function forget(d: Device) {
  if (!confirm(`Forget "${d.name}"? Its limits are lost; it is recorded again the next time a bridge connects it.`)) return
  try {
    await api(`/api/devices/${d.deviceId}`, 'DELETE')
    await load()
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function merge(d: Device) {
  const f = forms[d.deviceId]!
  const into = devices.value.find((x) => x.deviceId === f.mergeInto)
  if (!into || !confirm(`Merge "${d.name}" into "${into.name}"? Limits of "${d.name}" win; "${d.name}" is removed.`)) return
  try {
    await api(`/api/devices/${d.deviceId}/merge`, 'POST', { into: into.deviceId })
    await load()
    say('Merged')
  } catch (e) {
    error.value = (e as Error).message
  }
}

// --- owned device types -----------------------------------------------------
const OWNABLE: DeviceType[] = ['treadmill', 'bike']
const owned = computed(() => store.me?.preferences.ownedDeviceTypes ?? [])
async function toggleOwned(t: DeviceType) {
  const set = new Set(owned.value)
  if (set.has(t)) set.delete(t)
  else set.add(t)
  try {
    await api('/api/me', 'PUT', { preferences: { ...(store.me?.preferences ?? {}), ownedDeviceTypes: [...set] } })
    await loadMe()
  } catch (e) {
    error.value = (e as Error).message
  }
}
</script>

<template>
  <div class="panel">
    <h2>Devices</h2>
    <p v-if="error" class="notice error">{{ error }}</p>
    <p v-if="notice" class="notice ok">{{ notice }}</p>
    <div>
      <h3>I own</h3>
      <div class="choices" style="margin-top: 8px">
        <button v-for="t in OWNABLE" :key="t" type="button" class="choice" :aria-pressed="owned.includes(t)" @click="toggleOwned(t)">{{ deviceTypeName(t) }}</button>
      </div>
    </div>
    <div>
      <h3>Saved devices</h3>
      <p class="hint">Recorded automatically when a bridge connects them. Limits apply to what a game may command.</p>
    </div>
    <p v-if="devices.length === 0" class="muted">No devices yet. Connect one from the bridge.</p>
    <div v-for="d in devices" :key="d.deviceId" class="device">
      <div class="device-head">
        <div>
          <strong>{{ d.name || '(unnamed)' }}</strong>
          <span class="pill" style="margin-left: 8px">{{ deviceTypeName(d.type) }}</span>
          <div class="muted small">{{ d.protocol ?? '—' }} · seen {{ u.ago(d.lastSeenAt) }}</div>
        </div>
        <button type="button" class="btn sm ghost" :aria-expanded="!!open[d.deviceId]" @click="open[d.deviceId] = !open[d.deviceId]">{{ open[d.deviceId] ? 'Close' : 'Edit' }}</button>
      </div>
      <template v-if="open[d.deviceId] && forms[d.deviceId]">
        <div class="form">
          <label class="field">
            <span>Name</span>
            <input type="text" v-model="forms[d.deviceId]!.name" />
          </label>
          <label class="field">
            <span>Type</span>
            <select v-model="forms[d.deviceId]!.type">
              <option value="treadmill">treadmill</option>
              <option value="bike">bike trainer</option>
              <option value="hrm">heart rate monitor</option>
            </select>
          </label>
          <label v-if="forms[d.deviceId]!.type === 'treadmill'" class="check">
            <input type="checkbox" v-model="forms[d.deviceId]!.speedControl" />
            <span>Let games set the belt speed<span class="hint">Off by default: you set the speed on the machine and games change only the incline. Turn on only after checking this treadmill follows a speed change while the belt is moving (some firmware runs to full speed instead).</span></span>
          </label>
          <label v-for="f in FIELDS" :key="f.key" class="field">
            <span>{{ f.label }} <template v-if="unitFor(f)">({{ unitFor(f) }})</template></span>
            <input type="number" :step="f.step ?? 0.1" v-model.number="forms[d.deviceId]!.prefs[f.key]" placeholder="default" />
          </label>
        </div>
        <p class="hint">Blank fields use platform defaults. Speeds are entered in {{ u.unitLabel('speed', sys) }}.</p>
        <div class="actions">
          <button type="button" class="btn primary" :disabled="forms[d.deviceId]?.busy" @click="save(d)">Save</button>
          <button type="button" class="btn danger" @click="forget(d)">Forget</button>
        </div>
        <div v-if="devices.length > 1" class="actions">
          <select v-model="forms[d.deviceId]!.mergeInto" style="width: auto; flex: 1">
            <option :value="null">Merge into…</option>
            <option v-for="o in devices.filter((x) => x.deviceId !== d.deviceId)" :key="o.deviceId" :value="o.deviceId">{{ o.name }} ({{ deviceTypeName(o.type) }})</option>
          </select>
          <button type="button" class="btn" :disabled="forms[d.deviceId]!.mergeInto === null" @click="merge(d)">Merge</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.device { background: var(--panel-2); border-radius: var(--radius-sm); padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
.device-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.check { display: flex; gap: 10px; align-items: flex-start; font-weight: 700; }
.check input { width: 22px; height: 22px; margin-top: 2px; flex: none; }
.check .hint { display: block; font-weight: 500; }
</style>
