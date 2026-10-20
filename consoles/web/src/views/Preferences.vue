<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { api, ApiError } from '../api'
import { store, loadMe, logout } from '../session'
import type { Game, GamesResponse, GlobalPreferences, JsonSchemaProperty, Me, UnitSystem } from '../types'
import * as u from '../units'
import { THEMES, readTheme, setTheme, type Theme } from '../theme'
import { DEFAULT_RESTING_HR, FITNESS_LEVELS, globalSteadyWatts, levelHint, numberOrNull, paceFromForm, paceOf, positiveOrNull, steadyHeartRate, steadyText } from '../fitness'
import DevicesSection from '../components/DevicesSection.vue'
import { countryOptions } from '../flags'

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

const countries = countryOptions()
// The profile picture is a separate upload, not part of the form's save (PLAN.md §18.6).
const picture = ref<HTMLInputElement | null>(null)
const pictureBusy = ref(false)

async function uploadPicture(e: Event): Promise<void> {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  pictureBusy.value = true
  error.value = null
  try {
    if (file.size > 1_000_000) throw new Error('that picture is over 1 MB — a smaller one please')
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = () => reject(new Error('could not read that file'))
      r.readAsDataURL(file)
    })
    await api('/api/profile/image', 'PUT', { image: dataUrl })
    await loadMe()
    say('Picture saved')
  } catch (err) {
    error.value = err instanceof ApiError ? `${err.code}: ${err.message}` : (err as Error).message
  } finally {
    pictureBusy.value = false
    if (picture.value) picture.value.value = ''
  }
}

async function removePicture(): Promise<void> {
  await api('/api/profile/image', 'DELETE')
  await loadMe()
  say('Picture removed')
}


const form = reactive({
  username: '',
  displayName: '',
  public: false,
  // the social profile (PLAN.md §18.1)
  firstName: '',
  lastName: '',
  country: '',
  streakGoal: 0,
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
  // Fitness (fitness.ts); the treadmill pace speed is in the form's units
  steadyWatts: null as number | null,
  paceSpeed: null as number | null,
  paceIncline: null as number | null,
  restingHr: null as number | null,
  steadyHr: null as number | null,
})
const sys = computed(() => form.unitSystem)

function fill(me: Me) {
  form.username = me.username
  form.displayName = me.displayName ?? ''
  form.public = me.public
  form.firstName = me.firstName ?? ''
  form.lastName = me.lastName ?? ''
  form.country = me.country ?? ''
  form.streakGoal = me.streak?.goal ?? 0
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
  form.steadyWatts = positiveOrNull(p.steadyWatts)
  const pace = paceOf(p.steadyPace)
  form.paceSpeed = pace ? u.speed(pace.speed, me.unitSystem, 2).value : null
  form.paceIncline = pace ? pace.incline : null
  form.restingHr = numberOrNull(p.restingHr)
  form.steadyHr = numberOrNull(p.steadyHr)
}

// When the unit system select changes, re-express body values and the treadmill pace in the new units without
// changing the SI value. Sync, so fill() (which sets the unit system before the values) is not converted twice.
watch(
  () => form.unitSystem,
  (next, prev) => {
    if (next === prev) return
    form.height = u.height(u.heightToSI(form.height, prev), next, 1).value
    form.weight = u.mass(u.massToSI(form.weight, prev), next, 1).value
    form.paceSpeed = u.speed(u.speedToSI(numberOrNull(form.paceSpeed), prev), next, 2).value
  },
  { flush: 'sync' },
)

function say(msg: string) {
  notice.value = msg
  window.setTimeout(() => (notice.value = null), 2500)
}

/** Set a numeric preference, or remove it when the field is blank (a cleared number input gives '', not null). */
function setNum(prefs: GlobalPreferences, k: string, v: unknown) {
  const n = numberOrNull(v)
  if (n === null) delete prefs[k]
  else prefs[k] = n
}

/** The Fitness keys from the form; a blank field removes its key. */
function putFitness(prefs: GlobalPreferences) {
  setNum(prefs, 'steadyWatts', positiveOrNull(form.steadyWatts))
  const pace = paceFromForm(form.paceSpeed, form.paceIncline, sys.value)
  if (pace) prefs.steadyPace = pace
  else delete prefs.steadyPace
  setNum(prefs, 'restingHr', positiveOrNull(form.restingHr))
  setNum(prefs, 'steadyHr', positiveOrNull(form.steadyHr))
}

async function save() {
  if (!store.me) return
  busy.value = true
  error.value = null
  try {
    const prefs = { ...store.me.preferences }
    const mins = numberOrNull(form.defaultDurationMin)
    setNum(prefs, 'defaultDuration', mins === null ? null : Math.round(mins) * 60)
    setNum(prefs, 'ftp', form.ftp)
    setNum(prefs, 'maxHr', form.maxHr)
    setNum(prefs, 'efficiency', form.efficiency)
    prefs.allowSimulatorInRealSessions = form.allowSimulatorInRealSessions
    putFitness(prefs)
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
      firstName: form.firstName,
      lastName: form.lastName,
      country: form.country,
      streakGoal: form.streakGoal,
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

// --- fitness ----------------------------------------------------------------
// Steady pace for effort-paced games (Kingdom Trek). A level button saves at once; the exact numbers are under
// Advanced. "What the game will use" follows the form as it stands (Training's FTP and max HR too), so it shows a
// change before Save.
const fitnessAdvanced = ref(false)
const draft = computed<GlobalPreferences>(() => {
  const p: GlobalPreferences = { ...(store.me?.preferences ?? {}) }
  setNum(p, 'ftp', form.ftp)
  setNum(p, 'maxHr', form.maxHr)
  putFitness(p)
  return p
})
const uses = computed(() => steadyText(draft.value, sys.value))
const wattsPlaceholder = computed(() => String(Math.round(globalSteadyWatts({ ...draft.value, steadyWatts: null }).watts)))
const steadyHrPlaceholder = computed(() => String(Math.round(steadyHeartRate({ ...draft.value, steadyHr: null }, numberOrNull(form.age)).steady)))

function pickLevel(watts: number) {
  form.steadyWatts = watts
  void save()
}

function clearPace() {
  form.paceSpeed = null
  form.paceIncline = null
  void save()
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

    <div class="panel">
      <h2>Avatar</h2>
      <p class="hint">The rider the games show as you: body, face, hair and clothes.</p>
      <div class="actions">
        <RouterLink to="/avatar" class="btn">Design your avatar</RouterLink>
      </div>
    </div>

    <div class="panel">
      <h2>Your picture</h2>
      <p class="hint">A photo for your profile, beside your avatar. PNG or JPEG, up to 1 MB.</p>
      <div class="picrow">
        <span class="picshot">
          <img v-if="store.me?.imageUrl" :src="store.me.imageUrl" alt="Your profile picture" />
          <span v-else class="picnone" aria-hidden="true">🙂</span>
        </span>
        <div class="actions">
          <input ref="picture" type="file" accept="image/png,image/jpeg" class="file" aria-label="Choose a picture"
                 :disabled="pictureBusy" @change="uploadPicture" />
          <button v-if="store.me?.imageUrl" type="button" class="btn" @click="removePicture">Remove</button>
        </div>
      </div>
    </div>

    <form class="panel" @submit.prevent="save">
      <h2>Your streak</h2>
      <p class="hint">
        Pick how many sessions a week you are aiming for. Each week you reach it, your streak grows; changing
        the goal starts it again.
      </p>
      <div class="goals" role="group" aria-label="Sessions a week">
        <button
          v-for="g in [0, 1, 2, 3]" :key="g" type="button" class="goal"
          :class="{ on: form.streakGoal === g }" @click="form.streakGoal = g"
        >
          <b>{{ g === 0 ? 'None' : g }}</b>
          <span>{{ g === 0 ? 'no streak' : g === 1 ? 'session a week' : 'sessions a week' }}</span>
        </button>
      </div>
      <p v-if="store.me?.streak?.length" class="hint lit">
        🔥 {{ store.me.streak.length }} week{{ store.me.streak.length === 1 ? '' : 's' }} running. Keep it alive.
      </p>

      <h2>Profile</h2>
      <div class="form">
        <label class="field"><span>Username</span><input type="text" v-model="form.username" maxlength="24" autocapitalize="off" spellcheck="false" /></label>
        <label class="field"><span>Display name</span><input type="text" v-model="form.displayName" maxlength="80" /></label>
        <label class="field"><span>First name</span><input type="text" v-model="form.firstName" maxlength="40" /></label>
        <label class="field"><span>Last name</span><input type="text" v-model="form.lastName" maxlength="40" /></label>
        <label class="field">
          <span>Country</span>
          <select v-model="form.country">
            <option value="">—</option>
            <option v-for="c in countries" :key="c.code" :value="c.code">{{ c.flag }} {{ c.name }}</option>
          </select>
        </label>
        <label class="field">
          <span>Units</span>
          <select v-model="form.unitSystem"><option value="metric">metric (km, km/h, kg)</option><option value="us">US (mi, mph, lb)</option></select>
        </label>
        <label class="field"><span>Time zone</span><input type="text" v-model="form.timeZone" placeholder="e.g. America/Chicago" /></label>
        <label class="field check wide"><input type="checkbox" v-model="form.public" /> Public profile (appear on the Players page and the leaderboards)</label>
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

    <form class="panel" @submit.prevent="save">
      <h2>Fitness</h2>
      <p style="margin: 0">Your steady pace is the effort you could keep up for an hour and still talk in sentences; games like Kingdom Trek go by your effort against it, so a level takes everyone about the same time.</p>
      <div class="choices">
        <button v-for="l in FITNESS_LEVELS" :key="l.id" type="button" class="choice level" :aria-pressed="form.steadyWatts === l.watts" @click="pickLevel(l.watts)">
          <span class="level-name">{{ l.label }} · {{ l.watts }} W</span>
          <span class="level-sub">≈ {{ levelHint(l, sys) }}</span>
        </button>
      </div>
      <p class="hint">Treadmill equivalents are for a 75 kg person. A machine's own setting (Devices, below) wins on that machine.</p>
      <p style="margin: 0">What the game will use: <strong>{{ uses }}</strong></p>
      <div class="actions">
        <button type="button" class="btn ghost" :aria-expanded="fitnessAdvanced" @click="fitnessAdvanced = !fitnessAdvanced">{{ fitnessAdvanced ? 'Hide advanced' : 'Advanced' }}</button>
      </div>
      <template v-if="fitnessAdvanced">
        <div class="form">
          <label class="field"><span>Steady watts (W)</span><input type="number" step="1" min="1" v-model.number="form.steadyWatts" :placeholder="wattsPlaceholder" /></label>
          <label class="field"><span>Treadmill steady speed ({{ u.unitLabel('speed', sys) }})</span><input type="number" step="0.1" min="0" v-model.number="form.paceSpeed" placeholder="not set" /></label>
          <label class="field"><span>Treadmill steady incline (%)</span><input type="number" step="0.5" min="0" v-model.number="form.paceIncline" placeholder="0" /></label>
          <label class="field"><span>Resting HR (bpm)</span><input type="number" step="1" min="30" max="110" v-model.number="form.restingHr" :placeholder="String(DEFAULT_RESTING_HR)" /></label>
          <label class="field"><span>Steady HR (bpm)</span><input type="number" step="1" v-model.number="form.steadyHr" :placeholder="steadyHrPlaceholder" /></label>
        </div>
        <p class="hint">On a treadmill a steady pace is used before steady watts: treadmill users know their pace, not their watts. A blank steady HR is worked out from your resting and max HR (or your age).</p>
        <div class="actions">
          <button class="btn big primary" type="submit" :disabled="busy">Save</button>
          <button type="button" class="btn" @click="clearPace">Clear treadmill pace</button>
        </div>
      </template>
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

<style scoped>
/* Fitness: the four levels are chunky two-line choices (the name, then watts and the treadmill equivalent) */
.level { flex: 1 1 180px; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 2px; padding: 10px 18px; border-radius: var(--radius-sm); text-align: left; }
.level-name { font-size: 1.1em; }
.level-sub { font-size: 0.85em; font-weight: 600; opacity: 0.85; }
.picrow { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
.picshot { width: 72px; height: 72px; border-radius: 50%; overflow: hidden; display: grid; place-items: center;
  background: var(--panel-2); flex: none; }
.picshot img { width: 100%; height: 100%; object-fit: cover; }
.picnone { font-size: 1.8em; opacity: 0.6; }
.file { font: inherit; }
.goals { display: flex; gap: 8px; flex-wrap: wrap; }
.goal { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 96px; padding: 10px 14px;
  border: 0; border-radius: 12px; background: var(--panel-2); color: inherit; font: inherit; cursor: pointer; }
.goal b { font-size: 1.3em; font-weight: 900; }
.goal span { font-size: 0.76em; color: var(--muted); }
.goal.on { background: var(--page); color: #fff; }
.goal.on span { color: rgba(255, 255, 255, 0.82); }
.hint.lit { font-weight: 700; }
</style>
