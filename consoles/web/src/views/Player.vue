<script setup lang="ts">
// One player's profile (PLAN.md §18.6): their avatar turning on a bike, their picture, who they are, their
// streak, what they have done, and their timeline — with a "ride on" on every line.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ApiError } from '../api'
import { countryName, flagOrCode } from '../flags'
import { cheer, deleteUpdate, playerName, postUpdate, profile, streakText, timeline, updateIcon } from '../profiles'
import { store, timeZone, unitSystem } from '../session'
import * as u from '../units'
import CountUp from '../components/CountUp.vue'
import PlayerChip from '../components/PlayerChip.vue'
import type { Profile, ProfileUpdate } from '../types'

const props = defineProps<{ username: string }>()

const p = ref<Profile | null>(null)
const error = ref<string | null>(null)
const loading = ref(true)
const updates = ref<ProfileUpdate[]>([])
const more = ref(true)
const draft = ref('')
const posting = ref(false)

// The animated avatar is heavy (Babylon and the MakeHuman assets), so it mounts after the rest of the page
// and never blocks it. If avatarkit or its assets are missing the thumbnail stays and nobody is told.
const canvas = ref<HTMLCanvasElement | null>(null)
const live = ref(false)
let stage: { dispose: () => void } | null = null

const mine = computed(() => p.value?.me === true)
const name = computed(() => (p.value ? playerName(p.value) : props.username))
const sys = computed(() => unitSystem())

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const got = await profile(props.username)
    p.value = got
    updates.value = got.updates
    more.value = got.updates.length >= 30
    void mountAvatar(got.avatar)
  } catch (e) {
    error.value = e instanceof ApiError && e.status === 404
      ? 'No such player, or their profile is private.'
      : (e as Error).message
  } finally {
    loading.value = false
  }
}

async function mountAvatar(avatar: unknown): Promise<void> {
  stage?.dispose()
  stage = null
  live.value = false
  if (!avatar || !canvas.value) return
  try {
    const { mountAvatar: mount } = await import('../avatarStage')
    stage = await mount(canvas.value, { avatar, motion: 'cycle', transparent: true })
    live.value = true
  } catch {
    live.value = false // the thumbnail or the initials stand in
  }
}

onMounted(load)
watch(() => props.username, load)
onUnmounted(() => stage?.dispose())

async function loadMore(): Promise<void> {
  const last = updates.value[updates.value.length - 1]
  if (!last) return
  const next = await timeline(props.username, last.id)
  updates.value = [...updates.value, ...next]
  more.value = next.length >= 30
}

async function say(): Promise<void> {
  const text = draft.value.trim()
  if (!text || posting.value) return
  posting.value = true
  try {
    updates.value = [await postUpdate(text), ...updates.value]
    draft.value = ''
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    posting.value = false
  }
}

async function rideOn(up: ProfileUpdate): Promise<void> {
  // Optimistic: the tap should feel instant, and a failure simply puts it back.
  const was = { cheered: up.cheered, cheers: up.cheers }
  up.cheered = !up.cheered
  up.cheers = (up.cheers ?? 0) + (up.cheered ? 1 : -1)
  try {
    const res = await cheer(up.id)
    up.cheered = res.cheered
    up.cheers = res.cheers
  } catch {
    Object.assign(up, was)
  }
}

async function remove(up: ProfileUpdate): Promise<void> {
  await deleteUpdate(up.id)
  updates.value = updates.value.filter((x) => x.id !== up.id)
}

const when = (t: string): string => u.ago(t)
const day = (t: string | null): string =>
  t ? u.dateTime(t, timeZone(), { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const flag = computed(() => flagOrCode(p.value?.country))
const where = computed(() => countryName(p.value?.country))
const achievements = computed(() => Object.keys(p.value?.achievements ?? {}).length)
const initials = computed(() =>
  name.value.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?')
const bike = computed(() => p.value?.totals.byDevice.bike)
const tread = computed(() => p.value?.totals.byDevice.treadmill)
/** How far round this week's goal they are, as a fraction, for the ring. */
const goalRing = computed(() => {
  const s = p.value?.streak
  if (!s?.goal) return 0
  return Math.min(1, (s.length > 0 ? 1 : 0.15))
})
</script>

<template>
  <section class="page page-player">
    <p v-if="error" class="notice error">{{ error }}</p>
    <p v-if="loading" class="muted">Loading…</p>

    <template v-if="p">
      <header class="hero panel">
        <div class="avatar-slot" :class="{ bare: !p.avatar && !p.thumbnailUrl }">
          <canvas v-if="p.avatar" ref="canvas" class="stage" :class="{ live }"></canvas>
          <img v-if="!live && p.thumbnailUrl" class="thumb" :src="p.thumbnailUrl" :alt="`${name}'s avatar`" />
          <span v-else-if="!p.avatar" class="initials" aria-hidden="true">{{ initials }}</span>
          <img v-if="p.imageUrl" class="photo" :src="p.imageUrl" :alt="`${name}'s picture`" />
        </div>
        <div class="who">
          <h1>{{ name }} <span v-if="flag" class="flag" :title="where">{{ flag }}</span></h1>
          <p class="handle">@{{ p.username }}<template v-if="where"> · {{ where }}</template>
            · joined {{ day(p.joinedAt) }}</p>
          <p v-if="p.bio" class="bio">{{ p.bio }}</p>
          <div class="badges">
            <span v-if="p.streak.goal" class="badge streak" :class="{ lit: p.streak.length > 0 }">
              <span class="ring" :style="{ '--f': goalRing }"></span>
              <template v-if="p.streak.length"><b>{{ p.streak.length }}</b> week{{ p.streak.length === 1 ? '' : 's' }} running, {{ p.streak.goal }} a week</template>
              <template v-else>aiming for {{ p.streak.goal }} a week</template>
            </span>
            <span v-if="p.fitness.watts" class="badge">
              <b>{{ u.power(p.fitness.watts).text }}</b> steady
              <template v-if="p.fitness.source === 'declared'">(their own figure)</template>
            </span>
            <RouterLink v-if="achievements" class="badge link" to="/achievements">
              🏅 <b>{{ achievements }}</b> achievement{{ achievements === 1 ? '' : 's' }}
            </RouterLink>
          </div>
        </div>
      </header>

      <section class="panel totals">
        <h2>All time</h2>
        <dl class="numbers">
          <div><dt>Sessions</dt><dd><CountUp :value="p.totals.sessions" /></dd></div>
          <div><dt>Distance</dt>
            <dd><CountUp :value="p.totals.distance" :format="(n) => u.distance(n, sys, 1).text" /></dd></div>
          <div><dt>Time</dt><dd><CountUp :value="p.totals.duration" :format="(n) => u.duration(n)" /></dd></div>
          <div><dt>Calories</dt><dd><CountUp :value="p.totals.energy" :format="(n) => u.energy(n).text" /></dd></div>
          <div><dt>Climbed</dt>
            <dd><CountUp :value="p.totals.elevationGain" :format="(n) => u.length(n, sys, 0).text" /></dd></div>
        </dl>
        <p class="muted small split">
          <span v-if="bike?.sessions">🚲 {{ bike.sessions }} on a bike, {{ u.distance(bike.distance, sys, 0).text }}</span>
          <span v-if="tread?.sessions">🏃 {{ tread.sessions }} on a treadmill, {{ u.distance(tread.distance, sys, 0).text }}</span>
        </p>
        <div v-if="p.totals.byGame.length" class="games">
          <span v-for="g in p.totals.byGame" :key="g.gameId" class="gamepill">{{ g.gameId }} · {{ g.sessions }}</span>
        </div>
      </section>

      <section class="panel feed">
        <h2>Timeline</h2>
        <form v-if="mine" class="say" @submit.prevent="say">
          <input v-model="draft" maxlength="280" placeholder="Say something about your riding…" aria-label="A new update" />
          <button type="submit" class="btn primary" :disabled="posting || !draft.trim()">Post</button>
        </form>
        <p v-if="updates.length === 0" class="muted">
          Nothing here yet. Finish a session and the game will write the first line itself.
        </p>
        <ul v-else class="updates">
          <li v-for="up in updates" :key="up.id" class="update" :class="`kind-${up.kind}`">
            <span class="icon" aria-hidden="true">{{ updateIcon(up.kind) }}</span>
            <div class="body">
              <p class="text">{{ up.text }}</p>
              <p class="meta">
                <RouterLink v-if="up.sessionId" :to="`/sessions/${up.sessionId}`">{{ when(up.createdAt) }}</RouterLink>
                <span v-else>{{ when(up.createdAt) }}</span>
                <button type="button" class="rideon" :class="{ on: up.cheered }" @click="rideOn(up)">
                  <span class="thumb-up" aria-hidden="true">👍</span>
                  <span class="sr">Ride on</span>
                  <template v-if="up.cheers">{{ up.cheers }}</template>
                </button>
                <button v-if="mine && up.kind === 'manual'" type="button" class="del" @click="remove(up)">Delete</button>
              </p>
            </div>
          </li>
        </ul>
        <button v-if="more && updates.length" type="button" class="btn" @click="loadMore">Older</button>
      </section>

      <section v-if="p.recentSessions.length" class="panel recent">
        <h2>Recent sessions</h2>
        <ul class="rides">
          <li v-for="s in p.recentSessions" :key="s.sessionId">
            <RouterLink :to="`/sessions/${s.sessionId}`" class="ride">
              <span class="ridegame">{{ s.gameId }}</span>
              <span class="ridefacts">
                {{ u.distance(s.distance, sys, 1).text }} · {{ u.duration(s.duration) }}
                <template v-if="s.elevationGain"> · ↑{{ u.length(s.elevationGain, sys, 0).text }}</template>
              </span>
              <span class="ridewhen">{{ when(s.startedAt ?? '') }}</span>
            </RouterLink>
            <span v-if="Object.keys(s.stats).length" class="stats">
              <span v-for="(v, k) in s.stats" :key="k" class="stat">{{ k }} {{ v }}</span>
            </span>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>

<style scoped>
.hero { display: flex; flex-direction: row; gap: 20px; align-items: flex-start; flex-wrap: wrap; }
.avatar-slot { position: relative; flex: none; width: 190px; height: 230px; border-radius: 14px;
  display: grid; place-items: center;
  background: radial-gradient(120% 80% at 50% 10%, color-mix(in srgb, var(--page) 24%, var(--panel-2)), var(--panel-2)); }
.stage { width: 100%; height: 100%; display: block; opacity: 0; transition: opacity 0.5s ease; border-radius: 14px; }
.stage.live { opacity: 1; }
.avatar-slot.bare { height: 150px; }
.thumb { position: absolute; inset: 0; margin: auto; width: 150px; height: 150px; border-radius: 50%; object-fit: cover; }
.initials { font-size: 3em; font-weight: 900; color: var(--muted); }
.photo { position: absolute; right: -6px; bottom: -6px; width: 68px; height: 68px; border-radius: 50%;
  object-fit: cover; box-shadow: 0 0 0 3px var(--panel), 0 6px 16px rgba(0, 0, 0, 0.3); }
.who { flex: 1 1 280px; min-width: 0; }
.who h1 { margin: 0 0 2px; display: flex; align-items: center; gap: 10px; }
.flag { font-size: 1.1em; }
.handle { margin: 0; color: var(--muted); font-weight: 600; font-size: 0.9em; }
.bio { margin: 10px 0 0; max-width: 54ch; }
.badges { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.badge { display: inline-flex; align-items: center; gap: 7px; padding: 6px 12px; border-radius: 999px;
  background: var(--panel-2); font-size: 0.88em; font-weight: 600; color: inherit; text-decoration: none; }
.badge b { font-weight: 900; }
.badge.streak.lit { background: color-mix(in srgb, #ff9d3c 22%, var(--panel-2)); }
.ring { width: 14px; height: 14px; border-radius: 50%;
  background: conic-gradient(#ff9d3c calc(var(--f) * 360deg), color-mix(in srgb, var(--text) 14%, transparent) 0); }
.badge.link:hover { text-decoration: underline; }
.numbers { display: flex; flex-wrap: wrap; gap: 24px; margin: 0; }
.numbers div { display: flex; flex-direction: column; }
.numbers dt { font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 700; }
.numbers dd { margin: 0; font-size: 1.5em; font-weight: 900; }
.split { display: flex; gap: 18px; flex-wrap: wrap; margin: 12px 0 0; }
.small { font-size: 0.86em; }
.games { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.gamepill { font-size: 0.78em; font-weight: 700; padding: 3px 9px; border-radius: 999px; background: var(--panel-2); color: var(--muted); }
.say { display: flex; gap: 8px; margin-bottom: 14px; }
.say input { flex: 1; min-width: 0; padding: 9px 12px; border-radius: var(--radius-sm);
  border: 1px solid color-mix(in srgb, var(--text) 16%, transparent); background: var(--panel-2); color: inherit; }
.updates { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.update { display: flex; gap: 12px; padding: 11px 12px; border-radius: 12px; animation: slide-in 0.3s ease both; }
.update:nth-child(odd) { background: color-mix(in srgb, var(--text) 3%, transparent); }
.update.kind-streak { background: color-mix(in srgb, #ff9d3c 12%, transparent); }
.icon { font-size: 1.25em; line-height: 1.2; flex: none; }
.body { min-width: 0; flex: 1; }
.text { margin: 0; font-weight: 600; }
.meta { margin: 3px 0 0; display: flex; align-items: center; gap: 12px; font-size: 0.82em; color: var(--muted); }
.rideon { border: 0; background: none; cursor: pointer; color: inherit; font: inherit; font-weight: 700;
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 999px; }
.rideon:hover { background: var(--panel-2); }
.rideon.on { background: color-mix(in srgb, var(--page) 22%, transparent); color: var(--text); }
.rideon.on .thumb-up { animation: pop 0.34s ease; }
.thumb-up { filter: grayscale(1); opacity: 0.6; }
.rideon.on .thumb-up { filter: none; opacity: 1; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.del { border: 0; background: none; cursor: pointer; color: var(--muted); font: inherit; font-size: inherit; text-decoration: underline; }
.rides { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.ride { display: flex; gap: 12px; align-items: baseline; color: inherit; text-decoration: none; }
.ride:hover .ridegame { text-decoration: underline; }
.ridegame { font-weight: 800; min-width: 110px; }
.ridefacts { flex: 1; }
.ridewhen { color: var(--muted); font-size: 0.85em; }
.stats { display: flex; gap: 6px; flex-wrap: wrap; margin-left: 122px; }
.stat { font-size: 0.74em; font-weight: 700; padding: 2px 7px; border-radius: 999px; background: var(--panel-2); color: var(--muted); }
@keyframes slide-in { from { opacity: 0; transform: translateY(-5px); } }
@keyframes pop { 50% { transform: scale(1.5) rotate(-12deg); } }
@media (prefers-reduced-motion: reduce) {
  .update { animation: none; } .rideon.on .thumb-up { animation: none; } .stage { transition: none; }
}
@media (max-width: 640px) {
  .avatar-slot { width: 100%; height: 260px; }
  .stats { margin-left: 0; }
}
</style>
