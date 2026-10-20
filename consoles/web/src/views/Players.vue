<script setup lang="ts">
// Everybody on the platform (PLAN.md §18.6). A hundred or two people, so the whole list arrives at once and
// is filtered in the browser. Each card is a door to that player's profile.
import { computed, onMounted, ref } from 'vue'
import { playerName, players } from '../profiles'
import { loadMe, store, unitSystem } from '../session'
import * as u from '../units'
import PlayerChip from '../components/PlayerChip.vue'
import CountUp from '../components/CountUp.vue'
import type { PlayerCard } from '../types'

const all = ref<PlayerCard[]>([])
const error = ref<string | null>(null)
const loading = ref(true)
const search = ref('')
const sort = ref<'streak' | 'name' | 'fitness'>('streak')

onMounted(async () => {
  try {
    all.value = await players()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
  void makeMyPictureIfMissing()
})

/**
 * A player who designed an avatar before the platform kept pictures of them has a look and no picture, and
 * would show as initials for ever. Render one once, in the background: the page does not wait for it, and a
 * failure (no avatar assets, no WebGL) is not worth saying anything about.
 */
async function makeMyPictureIfMissing(): Promise<void> {
  const me = store.me
  if (!me || me.thumbnailUrl) return
  const avatar = (me.profile as { avatar?: unknown } | undefined)?.avatar
  if (!avatar || typeof avatar !== 'object') return
  const { uploadOwnThumbnail } = await import('../avatarPictures')
  if (await uploadOwnThumbnail(avatar)) {
    await loadMe()
    all.value = await players()
  }
}

const shown = computed(() => {
  const q = search.value.trim().toLowerCase()
  const list = all.value.filter((p) => !q
    || p.username.toLowerCase().includes(q)
    || `${p.firstName} ${p.lastName}`.toLowerCase().includes(q)
    || p.country.toLowerCase() === q)
  const by = {
    streak: (a: PlayerCard, b: PlayerCard) => (b.streak.length - a.streak.length) || a.username.localeCompare(b.username),
    name: (a: PlayerCard, b: PlayerCard) =>
      `${a.firstName}${a.lastName}${a.username}`.localeCompare(`${b.firstName}${b.lastName}${b.username}`),
    fitness: (a: PlayerCard, b: PlayerCard) => (b.fitness.watts ?? 0) - (a.fitness.watts ?? 0),
  }[sort.value]
  return [...list].sort(by)
})

const countries = computed(() => new Set(all.value.map((p) => p.country).filter(Boolean)).size)
const onStreak = computed(() => all.value.filter((p) => p.streak.length > 0).length)
const watts = (p: PlayerCard): string => (p.fitness.watts ? u.power(p.fitness.watts).text : '—')
</script>

<template>
  <section class="page page-players">
    <div class="page-head">
      <h1>Players</h1>
      <span v-if="!loading" class="lead">
        <CountUp :value="all.length" /> here<template v-if="countries > 1">, from {{ countries }} countries</template>
      </span>
    </div>
    <p v-if="error" class="notice error">{{ error }}</p>

    <div v-if="!loading && all.length > 1" class="bar">
      <input v-model="search" class="search" type="search" placeholder="Find somebody" aria-label="Find a player" />
      <div class="sorts" role="group" aria-label="Sort by">
        <button type="button" class="btn small" :class="{ primary: sort === 'streak' }" @click="sort = 'streak'">Streaks</button>
        <button type="button" class="btn small" :class="{ primary: sort === 'fitness' }" @click="sort = 'fitness'">Strength</button>
        <button type="button" class="btn small" :class="{ primary: sort === 'name' }" @click="sort = 'name'">Name</button>
      </div>
    </div>
    <p v-if="onStreak > 0" class="muted hint">{{ onStreak }} of them have a streak going right now.</p>

    <div v-if="loading" class="grid">
      <div v-for="i in 6" :key="i" class="card skel" aria-hidden="true"></div>
    </div>
    <p v-else-if="shown.length === 0" class="muted">Nobody matches that.</p>
    <div v-else class="grid">
      <RouterLink v-for="p in shown" :key="p.uid" class="card" :class="{ mine: p.me }" :to="`/players/${p.username}`">
        <PlayerChip :player="p" size="lg" handle :link="false" />
        <dl class="facts">
          <div><dt>Steady</dt><dd>{{ watts(p) }}</dd></div>
          <div><dt>Streak</dt><dd>{{ p.streak.length || '—' }}</dd></div>
        </dl>
        <span v-if="!p.public" class="pill">private</span>
      </RouterLink>
    </div>
    <p v-if="!loading && all.length === 1" class="muted hint">
      You are the only one here so far. Your profile is public, so anybody who joins will see your rides.
    </p>
    <p v-if="store.me" class="muted hint small">
      Your own profile:
      <RouterLink :to="`/players/${store.me.username}`">{{ playerName(store.me) }}</RouterLink>
    </p>
  </section>
</template>

<style scoped>
.bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; }
.search { flex: 1 1 220px; min-width: 0; padding: 9px 12px; border-radius: var(--radius-sm);
  border: 1px solid color-mix(in srgb, var(--text) 16%, transparent); background: var(--panel-2); color: inherit; }
.sorts { display: flex; gap: 6px; }
.hint { margin: 0; }
.hint.small { font-size: 0.85em; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(236px, 1fr)); gap: 12px; }
.card { display: flex; flex-direction: column; gap: 12px; padding: 14px; border-radius: 14px;
  background: var(--panel-2); color: inherit; text-decoration: none; position: relative;
  transition: transform 0.14s ease, box-shadow 0.14s ease; }
.card:hover, .card:focus-visible { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(0, 0, 0, 0.18); }
.card.mine { box-shadow: inset 0 0 0 2px var(--page); }
.facts { display: flex; gap: 18px; margin: 0; }
.facts div { display: flex; flex-direction: column; }
.facts dt { font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 700; }
.facts dd { margin: 0; font-weight: 800; }
.pill { position: absolute; top: 10px; right: 10px; font-size: 0.7em; }
.skel { height: 148px; background: linear-gradient(100deg, var(--panel-2) 30%, color-mix(in srgb, var(--text) 7%, var(--panel-2)) 50%, var(--panel-2) 70%);
  background-size: 300% 100%; animation: shimmer 1.4s linear infinite; }
@keyframes shimmer { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) {
  .card:hover { transform: none; } .skel { animation: none; }
}
</style>
