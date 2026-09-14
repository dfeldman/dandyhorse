<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { api, ApiError } from '../api'
import { store, loadMe, logout } from '../session'
import type { Game, GamesResponse, JsonSchemaProperty, Me, UnitSystem } from '../types'
import * as u from '../units'
import { THEMES, readTheme, setTheme, type Theme } from '../theme'
import DevicesSection from '../components/DevicesSection.vue'

// --- look -------------------------------------------------------------------
const theme = ref<Theme>(readTheme())
function pickTheme(t: Theme) {
  theme.value = t
  setTheme(t)
}
const THEME_LABEL: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' }

const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const busy = ref(false)

const form = reactive({
  username: '',
  displayName: '',
  public: false,
  unitSystem: 'metric' as UnitSystem,
  timeZone: '',
  height: null as number | null,
  weight: null as number | null,
  sex: '' as '' | 'm' | 'f' | 'x',
  age: null as number | null,
  defaultDurationMin: null as number | null,
  ftp: null as number | null,
  maxHr: null as number | null,
  efficiency: null as number | null,
  allowSimulatorInRealSessions: false,
})
const sys = computed(() => form.unitSystem)

function fill(me: Me) {
  form.username = me.username
  form.displayName = me.displayName ?? ''
  form.public = me.public
  form.unitSystem = me.unitSystem
  form.timeZone = me.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  form.height = u.height(me.bodyData.height ?? null, me.unitSystem, 1).value
  form.weight = u.mass(me.bodyData.weight ?? null, me.unitSystem, 1).value
  form.sex = me.bodyData.sex ?? ''
  form.age = me.bodyData.age ?? null
  const p = me.preferences
  form.defaultDurationMin = typeof p.defaultDuration === 'number' ? Math.round(p.defaultDuration / 60) : null
  form.ftp = typeof p.ftp === 'number' ? p.ftp : null
  form.maxHr = typeof p.maxHr === 'number' ? p.maxHr : null
  form.efficiency = typeof p.efficiency === 'number' ? p.efficiency : null
  form.allowSimulatorInRealSessions = !!p.allowSimulatorInRealSessions
}

// When the unit system select changes, re-express body values in the new units without changing the SI value.
watch(
  () => form.unitSystem,
  (next, prev) => {
    if (next === prev) return
    form.height = u.height(u.heightToSI(form.height, prev), next, 1).value
    form.weight = u.mass(u.massToSI(form.weight, prev), next, 1).value
  },
)

function say(msg: string) {
  notice.value = msg
  window.setTimeout(() => (notice.value = null), 2500)
}

async function save() {
  if (!store.me) return
  busy.value = true
  error.value = null
  try {
    const prefs = { ...store.me.preferences }
    const setNum = (k: string, v: number | null) => {
      if (v === null || Number.isNaN(v)) delete prefs[k]
      else prefs[k] = v
    }
    setNum('defaultDuration', form.defaultDurationMin === null ? null : Math.round(form.defaultDurationMin) * 60)
    setNum('ftp', form.ftp)
    setNum('maxHr', form.maxHr)
    setNum('efficiency', form.efficiency)
    prefs.allowSimulatorInRealSessions = form.allowSimulatorInRealSessions
    const bodyData: Record<string, unknown> = {}
    const h = u.heightToSI(form.height, sys.value)
    const w = u.massToSI(form.weight, sys.value)
    if (h !== null) bodyData.height = Math.round(h * 1000) / 1000
    if (w !== null) bodyData.weight = Math.round(w * 100) / 100
    if (form.sex) bodyData.sex = form.sex
    if (form.age !== null && !Number.isNaN(form.age)) bodyData.age = Math.round(form.age)
    await api('/api/me', 'PUT', {
      username: form.username,
      displayName: form.displayName,
      public: form.public,
      unitSystem: form.unitSystem,
      timeZone: form.timeZone,
      bodyData,
      preferences: prefs,
    })
    const me = await loadMe()
    if (me) fill(me)
    say('Saved')
  } catch (e) {
    error.value = e instanceof ApiError ? `${e.code}: ${e.message}` : (e as Error).message
  } finally {
    busy.value = false
  }
}

// --- per-game preferences ---------------------------------------------------
const games = ref<Game[]>([])
const gameId = ref('')
const game = computed(() => games.value.find((g) => g.id === gameId.value) ?? null)
const schemaProps = computed<Record<string, JsonSchemaProperty> | null>(() => game.value?.preferencesSchema?.properties ?? null)
const gamePrefs = reactive<Record<string, unknown>>({})
const gamePrefsJson = ref('{}')
const gameBusy = ref(false)
const gameError = ref<string | null>(null)

async function loadGamePrefs() {
  if (!gameId.value) return
  gameError.value = null
  try {
    const res = await api<{ game: string; preferences: Record<string, unknown> }>(`/api/game-preferences/${gameId.value}`)
    for (const k of Object.keys(gamePrefs)) delete gamePrefs[k]
    Object.assign(gamePrefs, res.preferences)
    if (schemaProps.value) {
      for (const [k, p] of Object.entries(schemaProps.value)) {
        if (!(k in gamePrefs) && p.default !== undefined) gamePrefs[k] = p.default
      }
    }
    gamePrefsJson.value = JSON.stringify(res.preferences, null, 2)
  } catch (e) {
    gameError.value = (e as Error).message
  }
}
watch(gameId, loadGamePrefs)

function inputKind(p: JsonSchemaProperty): 'boolean' | 'enum' | 'number' | 'string' {
  if (p.enum) return 'enum'
  if (p.type === 'boolean') return 'boolean'
  if (p.type === 'number' || p.type === 'integer') return 'number'
  return 'string'
}

async function saveGamePrefs() {
  if (!gameId.value) return
  gameBusy.value = true
  gameError.value = null
  try {
    let prefs: Record<string, unknown>
    if (schemaProps.value) {
      prefs = { ...gamePrefs }
    } else {
      const parsed: unknown = JSON.parse(gamePrefsJson.value)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('preferences must be a JSON object')
      prefs = parsed as Record<string, unknown>
    }
    await api(`/api/game-preferences/${gameId.value}`, 'PUT', { preferences: prefs })
    say(`Saved preferences for ${game.value?.name ?? gameId.value}`)
    await loadGamePrefs()
  } catch (e) {
    gameError.value = e instanceof ApiError ? `${e.code}: ${e.message}` : (e as Error).message
  } finally {
    gameBusy.value = false
  }
}

onMounted(async () => {
  if (store.me) fill(store.me)
  try {
    games.value = (await api<GamesResponse>('/api/games')).games
    if (games.value.length && !gameId.value) gameId.value = games.value[0]!.id
  } catch (e) {
    gameError.value = (e as Error).message
  }
})
</script>

<template>
  <section class="page page-preferences">
    <div class="page-head"><h1>Preferences</h1></div>
    <p v-if="error" class="notice error">{{ error }}</p>
    <p v-if="notice" class="notice ok">{{ notice }}</p>

    <div class="panel">
      <h2>Look</h2>
      <div class="choices">
        <button v-for="t in THEMES" :key="t" type="button" class="choice" :aria-pressed="theme === t" @click="pickTheme(t)">{{ THEME_LABEL[t] }}</button>
      </div>
      <p class="hint">System follows the device's light/dark setting.</p>
    </div>

    <form class="panel" @submit.prevent="save">
      <h2>Profile</h2>
      <div class="form">
        <label class="field"><span>Username</span><input type="text" v-model="form.username" maxlength="40" /></label>
        <label class="field"><span>Display name</span><input type="text" v-model="form.displayName" maxlength="80" /></label>
        <label class="field">
          <span>Units</span>
          <select v-model="form.unitSystem"><option value="metric">metric (km, km/h, kg)</option><option value="us">US (mi, mph, lb)</option></select>
        </label>
        <label class="field"><span>Time zone</span><input type="text" v-model="form.timeZone" placeholder="e.g. America/Chicago" /></label>
        <label class="field check wide"><input type="checkbox" v-model="form.public" /> Public profile (appear on leaderboards)</label>
      </div>

      <h2>Body</h2>
      <div class="form">
        <label class="field"><span>Height ({{ u.unitLabel('height', sys) }})</span><input type="number" step="0.1" v-model.number="form.height" /></label>
        <label class="field"><span>Weight ({{ u.unitLabel('mass', sys) }})</span><input type="number" step="0.1" v-model.number="form.weight" /></label>
        <label class="field">
          <span>Sex</span>
          <select v-model="form.sex"><option value="">—</option><option value="m">m</option><option value="f">f</option><option value="x">x</option></select>
        </label>
        <label class="field"><span>Age</span><input type="number" step="1" min="0" v-model.number="form.age" /></label>
      </div>
      <p class="hint">Used for the treadmill energy estimate and saved with each session.</p>

      <h2>Training</h2>
      <div class="form">
        <label class="field"><span>Default duration (min)</span><input type="number" step="1" min="1" v-model.number="form.defaultDurationMin" /></label>
        <label class="field"><span>FTP (W)</span><input type="number" step="1" v-model.number="form.ftp" /></label>
        <label class="field"><span>Max HR (bpm)</span><input type="number" step="1" v-model.number="form.maxHr" /></label>
        <label class="field"><span>Efficiency (0–1)</span><input type="number" step="0.01" min="0.05" max="1" v-model.number="form.efficiency" placeholder="0.24" /></label>
        <label class="field check wide"><input type="checkbox" v-model="form.allowSimulatorInRealSessions" /> Allow the simulator in non-debug sessions</label>
      </div>
      <div class="actions"><button class="btn big primary" type="submit" :disabled="busy">Save</button></div>
    </form>

    <div class="panel">
      <h2>Game settings</h2>
      <div class="form">
        <label class="field">
          <span>Game</span>
          <select v-model="gameId">
            <option v-for="g in games" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
        </label>
      </div>
      <p v-if="gameError" class="error small">{{ gameError }}</p>
      <template v-if="game">
        <div v-if="schemaProps" class="form">
          <label v-for="(p, key) in schemaProps" :key="key" :class="inputKind(p) === 'boolean' ? 'field check' : 'field'">
            <template v-if="inputKind(p) === 'boolean'">
              <input type="checkbox" v-model="gamePrefs[key]" /> {{ p.title ?? key }}
            </template>
            <template v-else>
              <span :title="p.description">{{ p.title ?? key }}</span>
              <select v-if="inputKind(p) === 'enum'" v-model="gamePrefs[key]">
                <option v-for="opt in p.enum" :key="String(opt)" :value="opt">{{ opt }}</option>
              </select>
              <input v-else-if="inputKind(p) === 'number'" type="number" :min="p.minimum" :max="p.maximum" :step="p.type === 'integer' ? 1 : 'any'" v-model.number="gamePrefs[key]" />
              <input v-else type="text" v-model="gamePrefs[key]" />
            </template>
          </label>
        </div>
        <label v-else class="field">
          <span>Settings (JSON)</span>
          <textarea v-model="gamePrefsJson" spellcheck="false"></textarea>
        </label>
        <div class="actions"><button type="button" class="btn primary" :disabled="gameBusy" @click="saveGamePrefs">Save game settings</button></div>
      </template>
    </div>

    <DevicesSection />

    <div class="panel">
      <h2>Account</h2>
      <p class="muted" style="margin: 0">Signed in as {{ store.me?.displayName || store.me?.username }}.</p>
      <div class="actions"><button type="button" class="btn danger" @click="logout()">Log out</button></div>
    </div>
  </section>
</template>
