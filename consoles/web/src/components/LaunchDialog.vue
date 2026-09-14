<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api, ApiError } from '../api'
import { store } from '../session'
import { connection, deviceTypeName } from '../status'
import { defaultDebug, defaultDeviceType } from '../launch'
import type { Device, DeviceType, Game, LaunchResponse, Variant } from '../types'

// One column, every row reachable with Down and every choice with Left/Right: device type (if several, as buttons
// like duration), duration (four chunky choices, no keyboard needed), the game's own options (PLAN.md §7.1), debug,
// Advanced, Play, Cancel.
const props = defineProps<{ game: Game; variant: Variant }>()
const emit = defineEmits<{ close: [] }>()

function randomSeed(): number {
  const a = new Uint32Array(1)
  crypto.getRandomValues(a)
  return a[0]!
}

const DURATIONS = [15, 30, 45, 60] // minutes; games may rely on one of these when they build a route
// The machine the user actually has (the one kind they own, else connected now, else last seen: launch.ts) until they
// pick one. It follows the 4 s poll of the bridges, so a machine connected while the dialog is open can become it.
const savedDevices = ref<Device[]>([])
const pickedType = ref<DeviceType | null>(null)
const deviceType = computed<DeviceType>(() => {
  if (pickedType.value) return pickedType.value
  const live = connection(store.current?.bridges ?? []).device
  return defaultDeviceType(props.variant.deviceTypes, {
    connected: live ? [live.type] : [],
    owned: store.me?.preferences.ownedDeviceTypes ?? [],
    saved: savedDevices.value,
  })
})
// Debug starts on (the simulator needs it) and turns itself off once the saved devices show a real machine,
// unless the user has already flipped it (launch.ts defaultDebug).
const debug = ref(true)
const debugTouched = ref(false)
onMounted(async () => {
  try {
    savedDevices.value = (await api<{ devices: Device[] }>('/api/devices')).devices
    if (!debugTouched.value) debug.value = defaultDebug(savedDevices.value)
  } catch {
    // the defaults then go without the saved devices
  }
})
const defaultSeconds = props.variant.defaultDuration ?? store.me?.preferences.defaultDuration ?? 1800
const nearest = DURATIONS.reduce((best, m) => (Math.abs(m * 60 - defaultSeconds) < Math.abs(best * 60 - defaultSeconds) ? m : best), DURATIONS[0]!)
const minutes = ref<number>(nearest)
const customMinutes = ref<number | null>(null)
const optionRows = computed(() => Object.entries(props.game.options ?? {}))
const options = ref<Record<string, string>>(Object.fromEntries(optionRows.value.map(([k, o]) => [k, o.default ?? o.enum[0] ?? ''])))
const seed = ref<number>(randomSeed())
const advanced = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)

function machineLabel(t: DeviceType): string {
  return deviceTypeName(t).replace(/^\w/, (c) => c.toUpperCase())
}

function optionLabel(o: { enum: string[]; labels?: string[] }, value: string): string {
  const i = o.enum.indexOf(value)
  return (o.labels && o.labels[i]) || value.replace(/^\w/, (c) => c.toUpperCase())
}

async function launch() {
  error.value = null
  busy.value = true
  try {
    const mins = advanced.value && customMinutes.value ? Math.max(1, Math.round(customMinutes.value)) : minutes.value
    const body: Record<string, unknown> = {
      gameId: props.game.id,
      variant: props.variant.id,
      deviceType: deviceType.value,
      duration: mins * 60,
      seed: Math.floor(seed.value) >>> 0,
      debug: debug.value,
      options: options.value,
    }
    const res = await api<LaunchResponse>('/api/sessions/launch', 'POST', body)
    window.location.href = res.bridgeUrl
  } catch (e) {
    error.value = e instanceof ApiError ? `${e.code}: ${e.message}` : (e as Error).message
    busy.value = false
  }
}
</script>

<template>
  <div class="layer-backdrop" @click.self="emit('close')">
    <div class="layer page-games" role="dialog" aria-modal="true" data-focus-layer>
      <div>
        <h2>{{ variant.name }}</h2>
        <p class="muted" style="margin: 0">{{ game.name }}</p>
      </div>
      <form class="form one" @submit.prevent="launch">
        <div v-if="variant.deviceTypes.length > 1" class="field" role="radiogroup" aria-label="Device">
          <span>Device</span>
          <div class="seg">
            <button v-for="d in variant.deviceTypes" :key="d" type="button" role="radio" :aria-checked="deviceType === d" :class="{ on: deviceType === d }" @click="pickedType = d">{{ machineLabel(d) }}</button>
          </div>
        </div>
        <div v-else class="field"><span>Device</span><div class="static">{{ deviceTypeName(deviceType) }}</div></div>

        <div class="field" role="radiogroup" aria-label="Duration">
          <span>Duration</span>
          <div class="seg">
            <button v-for="m in DURATIONS" :key="m" type="button" role="radio" :aria-checked="minutes === m" :class="{ on: minutes === m }" @click="minutes = m">{{ m }} min</button>
          </div>
        </div>

        <div v-for="[key, o] in optionRows" :key="key" class="field" role="radiogroup" :aria-label="o.label ?? key">
          <span>{{ o.label ?? key }}<span v-if="o.description" class="hint">{{ o.description }}</span></span>
          <div class="seg">
            <button v-for="v in o.enum" :key="v" type="button" role="radio" :aria-checked="options[key] === v" :class="{ on: options[key] === v }" @click="options[key] = v">{{ optionLabel(o, v) }}</button>
          </div>
        </div>

        <button type="button" class="switch" role="switch" :aria-checked="debug" @click="debug = !debug; debugTouched = true">
          <span>Debug session<span class="hint">Logged and shown in History, but not counted for leaderboards or achievements. Needed for the simulator.</span></span>
          <span class="knob" aria-hidden="true"></span>
        </button>
        <button type="button" class="btn ghost" :aria-expanded="advanced" @click="advanced = !advanced">{{ advanced ? 'Hide advanced' : 'Advanced' }}</button>
        <label v-if="advanced" class="field">
          <span>Seed (random by default)</span>
          <input type="number" min="0" max="4294967295" step="1" v-model.number="seed" />
        </label>
        <label v-if="advanced" class="field">
          <span>Custom duration (minutes)</span>
          <input type="number" min="1" max="600" step="1" v-model.number="customMinutes" placeholder="leave empty to use the choice above" />
        </label>
        <p v-if="error" class="error small" style="margin: 0">{{ error }}</p>
        <button type="submit" class="btn big primary block" :disabled="busy">Play</button>
        <button type="button" class="btn block" data-back @click="emit('close')">Cancel</button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.static { min-height: var(--tap); display: flex; align-items: center; padding: 10px 16px; border-radius: var(--radius-sm); background: var(--panel-2); font-weight: 800; }
.field > span > .hint { display: block; font-weight: 600; text-transform: none; letter-spacing: 0; opacity: 0.8; margin-top: 2px; }
.seg { display: flex; gap: 8px; flex-wrap: wrap; }
.seg button {
  flex: 1 1 0; min-height: var(--tap); min-width: 84px; padding: 10px 14px; border-radius: var(--radius-sm); border: 2px solid transparent;
  background: var(--panel-2); color: inherit; font: inherit; font-weight: 800; cursor: pointer;
}
/* the console's primary colour (style.css .btn.primary); --accent does not exist here, which left a chosen button transparent */
.seg button.on { background: var(--page, var(--c-blue)); color: var(--on-page, var(--on-blue)); }
.seg button:focus-visible { border-color: var(--focus, currentColor); }
</style>
