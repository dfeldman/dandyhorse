<script setup lang="ts">
// Admin: every account, bots included, and a form to change any of it (PLAN.md §18.9).
//
// The avatar is edited as pasted JSON on purpose: nobody types an AvatarSpec, so the admin copies one out of
// the avatar designer. Bot performance curves and schedules are not here — they live in bots/bots.json.
import { computed, onMounted, reactive, ref } from 'vue'
import { api, ApiError } from '../api'
import { countryOptions, flagOrCode } from '../flags'
import { playerName } from '../profiles'
import type { AdminUser, Profile } from '../types'

const users = ref<AdminUser[]>([])
const editing = ref<number | null>(null)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const busy = ref(false)
const search = ref('')
const countries = countryOptions()

const form = reactive({
  username: '', displayName: '', firstName: '', lastName: '', country: '', bio: '',
  public: true, isBot: false, timeZone: '', unitSystem: 'metric' as 'metric' | 'us',
  streakGoal: 0, height: null as number | null, weight: null as number | null,
  sex: '' as string, age: null as number | null,
  avatarJson: '', updateText: '',
})

async function load(): Promise<void> {
  try {
    users.value = (await api<{ users: AdminUser[] }>('/api/admin/users')).users
  } catch (e) {
    error.value = (e as Error).message
  }
}
onMounted(load)

const shown = computed(() => {
  const q = search.value.trim().toLowerCase()
  return users.value.filter((x) => !q || x.username.toLowerCase().includes(q)
    || `${x.firstName} ${x.lastName}`.toLowerCase().includes(q))
})

async function open(uid: number): Promise<void> {
  error.value = null
  editing.value = uid
  try {
    const p = await api<Profile>(`/api/admin/users/${uid}`)
    form.username = p.username
    form.displayName = p.displayName ?? ''
    form.firstName = p.firstName
    form.lastName = p.lastName
    form.country = p.country
    form.bio = p.bio
    form.public = p.public
    form.isBot = p.isBot ?? false
    form.timeZone = p.timeZone
    form.unitSystem = p.unitSystem
    form.streakGoal = p.streak.goal
    form.height = p.bodyData?.height ?? null
    form.weight = p.bodyData?.weight ?? null
    form.sex = p.bodyData?.sex ?? ''
    form.age = p.bodyData?.age ?? null
    form.avatarJson = p.avatar ? JSON.stringify(p.avatar, null, 2) : ''
    form.updateText = ''
  } catch (e) {
    error.value = (e as Error).message
    editing.value = null
  }
}

async function save(): Promise<void> {
  const uid = editing.value
  if (uid === null) return
  busy.value = true
  error.value = null
  try {
    let avatar: unknown
    const raw = form.avatarJson.trim()
    if (raw === '') {
      avatar = null // clearing the box removes the avatar
    } else {
      try {
        avatar = JSON.parse(raw)
      } catch {
        throw new Error('that avatar is not valid JSON — paste what the avatar designer saves')
      }
      if (typeof avatar !== 'object' || avatar === null || Array.isArray(avatar)) {
        throw new Error('an avatar is a JSON object')
      }
    }
    const bodyData: Record<string, unknown> = {}
    if (form.height !== null) bodyData.height = form.height
    if (form.weight !== null) bodyData.weight = form.weight
    if (form.sex) bodyData.sex = form.sex
    if (form.age !== null) bodyData.age = form.age
    const res = await api<{ changed: string[] }>(`/api/admin/users/${uid}`, 'PUT', {
      username: form.username, displayName: form.displayName, firstName: form.firstName,
      lastName: form.lastName, country: form.country, bio: form.bio, public: form.public,
      isBot: form.isBot, timeZone: form.timeZone, unitSystem: form.unitSystem,
      streakGoal: form.streakGoal, bodyData, avatar,
    })
    notice.value = res.changed.length ? `Saved: ${res.changed.join(', ')}` : 'Nothing changed'
    await load()
  } catch (e) {
    error.value = e instanceof ApiError ? `${e.code}: ${e.message}` : (e as Error).message
  } finally {
    busy.value = false
  }
}

async function postAs(): Promise<void> {
  const uid = editing.value
  if (uid === null || !form.updateText.trim()) return
  try {
    await api(`/api/admin/users/${uid}/updates`, 'POST', { text: form.updateText })
    notice.value = 'Update posted to their timeline'
    form.updateText = ''
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function recompute(uid: number): Promise<void> {
  await api(`/api/admin/users/${uid}/recompute`, 'POST')
  notice.value = 'Fitness and streak recomputed'
  await load()
}

async function recomputeBoards(): Promise<void> {
  const res = await api<{ boards: Record<string, number> }>('/api/admin/leaderboards/recompute', 'POST')
  notice.value = `Rebuilt ${Object.keys(res.boards).length} leaderboards`
}
</script>

<template>
  <div class="panel">
    <h2>Players</h2>
    <p v-if="error" class="notice error">{{ error }}</p>
    <p v-if="notice" class="notice ok">{{ notice }}</p>
    <div class="bar">
      <input v-model="search" class="search" type="search" placeholder="Find a player" aria-label="Find a player" />
      <button type="button" class="btn" @click="recomputeBoards">Rebuild leaderboards</button>
    </div>

    <div class="rows">
      <div v-for="x in shown" :key="x.uid" class="urow" :class="{ open: editing === x.uid }">
        <button type="button" class="pick" @click="editing === x.uid ? (editing = null) : open(x.uid)">
          <span class="mono uid">{{ x.uid }}</span>
          <span class="nm">{{ playerName(x) }} <span v-if="x.country">{{ flagOrCode(x.country) }}</span></span>
          <span class="muted small">@{{ x.username }}</span>
          <span v-if="x.isBot" class="pill">bot</span>
          <span v-if="!x.public" class="pill">private</span>
          <span v-if="x.streak.goal" class="muted small">streak {{ x.streak.length }}/{{ x.streak.goal }}w</span>
        </button>

        <form v-if="editing === x.uid" class="edit" @submit.prevent="save">
          <div class="form">
            <label class="field"><span>Username</span><input v-model="form.username" type="text" maxlength="24" autocapitalize="off" spellcheck="false" /></label>
            <label class="field"><span>Display name</span><input v-model="form.displayName" type="text" maxlength="80" /></label>
            <label class="field"><span>First name</span><input v-model="form.firstName" type="text" maxlength="40" /></label>
            <label class="field"><span>Last name</span><input v-model="form.lastName" type="text" maxlength="40" /></label>
            <label class="field">
              <span>Country</span>
              <select v-model="form.country">
                <option value="">—</option>
                <option v-for="c in countries" :key="c.code" :value="c.code">{{ c.flag }} {{ c.name }}</option>
              </select>
            </label>
            <label class="field"><span>Time zone</span><input v-model="form.timeZone" type="text" /></label>
            <label class="field">
              <span>Units</span>
              <select v-model="form.unitSystem"><option value="metric">metric</option><option value="us">US</option></select>
            </label>
            <label class="field">
              <span>Streak goal</span>
              <select v-model.number="form.streakGoal">
                <option :value="0">none</option><option :value="1">1 a week</option>
                <option :value="2">2 a week</option><option :value="3">3 a week</option>
              </select>
            </label>
            <label class="field"><span>Height (m)</span><input v-model.number="form.height" type="number" step="0.01" /></label>
            <label class="field"><span>Weight (kg)</span><input v-model.number="form.weight" type="number" step="0.5" /></label>
            <label class="field">
              <span>Sex</span>
              <select v-model="form.sex"><option value="">—</option><option value="f">female</option><option value="m">male</option><option value="x">other</option></select>
            </label>
            <label class="field"><span>Age</span><input v-model.number="form.age" type="number" step="1" /></label>
            <label class="field check"><input v-model="form.public" type="checkbox" /> Public</label>
            <label class="field check"><input v-model="form.isBot" type="checkbox" /> Bot player</label>
            <label class="field wide"><span>Bio</span><textarea v-model="form.bio" rows="3" maxlength="600"></textarea></label>
            <label class="field wide">
              <span>Avatar (paste the JSON the avatar designer saves; empty removes it)</span>
              <textarea v-model="form.avatarJson" rows="6" class="mono" spellcheck="false"></textarea>
            </label>
          </div>
          <div class="actions">
            <button type="submit" class="btn primary" :disabled="busy">Save</button>
            <button type="button" class="btn" @click="recompute(x.uid)">Recompute fitness and streak</button>
            <RouterLink class="btn" :to="`/players/${x.username}`">View profile</RouterLink>
          </div>
          <div class="actions say">
            <input v-model="form.updateText" type="text" maxlength="280" placeholder="Post an update as this player" />
            <button type="button" class="btn" :disabled="!form.updateText.trim()" @click="postAs">Post</button>
          </div>
          <p v-if="form.isBot" class="muted small">
            A bot's performance curves and schedule live in <span class="mono">bots/bots.json</span>, not here.
          </p>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.search { flex: 1 1 200px; min-width: 0; padding: 9px 12px; border-radius: var(--radius-sm);
  border: 1px solid color-mix(in srgb, var(--text) 16%, transparent); background: var(--panel-2); color: inherit; }
.rows { display: flex; flex-direction: column; gap: 6px; }
.urow { border-radius: 12px; background: var(--panel-2); overflow: hidden; }
.urow.open { box-shadow: inset 0 0 0 2px var(--page); }
.pick { display: flex; gap: 12px; align-items: center; width: 100%; padding: 10px 14px; border: 0;
  background: none; color: inherit; font: inherit; cursor: pointer; text-align: left; flex-wrap: wrap; }
.uid { color: var(--muted); min-width: 3em; }
.nm { font-weight: 800; }
.small { font-size: 0.84em; }
.edit { padding: 4px 14px 14px; }
.form { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
.field { display: flex; flex-direction: column; gap: 3px; font-size: 0.86em; }
.field > span { color: var(--muted); font-weight: 700; }
.field input, .field select, .field textarea { font: inherit; padding: 7px 10px; border-radius: var(--radius-sm);
  border: 1px solid color-mix(in srgb, var(--text) 16%, transparent); background: var(--panel); color: inherit; }
.field.check { flex-direction: row; align-items: center; gap: 7px; font-weight: 700; }
.field.wide { grid-column: 1 / -1; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; align-items: center; }
.actions.say input { flex: 1 1 220px; min-width: 0; font: inherit; padding: 8px 11px; border-radius: var(--radius-sm);
  border: 1px solid color-mix(in srgb, var(--text) 16%, transparent); background: var(--panel); color: inherit; }
textarea.mono { font-family: ui-monospace, monospace; font-size: 0.86em; }
</style>
