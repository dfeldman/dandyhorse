<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../api'
import { loadMe, store, timeZone } from '../session'
import { groups } from '../achievements'
import type { Game } from '../types'

// Every achievement: the platform's, then each game's. Earned ones are lit, with the day and a link to the ride;
// the ones a game names but you have not earned yet are there as goals.
const games = ref<Game[]>([])
const error = ref<string | null>(null)
onMounted(async () => {
  try {
    const [res] = await Promise.all([api<{ games: Game[] }>('/api/games'), loadMe()])
    games.value = res.games
  } catch (e) {
    error.value = (e as Error).message
  }
})

const list = computed(() => groups(store.me?.achievements ?? {}, games.value))
const total = computed(() => list.value.reduce((n, g) => n + g.earned, 0))
const day = (t: string): string =>
  new Date(t).toLocaleDateString(undefined, { timeZone: timeZone(), day: 'numeric', month: 'short', year: 'numeric' })
</script>

<template>
  <section class="page page-achievements">
    <div class="page-head">
      <h1>Achievements</h1>
      <span class="lead">{{ total }} earned</span>
    </div>
    <p v-if="error" class="notice error">{{ error }}</p>
    <p class="muted hint">Sessions with Debug on, like those with the simulator, don't earn achievements.</p>
    <section v-for="g in list" :key="g.id" class="panel group">
      <h2>{{ g.title }} <span class="count">{{ g.earned }} of {{ g.items.length }}</span></h2>
      <ul class="badges">
        <li v-for="a in g.items" :key="a.key" class="badge" :class="{ earned: a.earned }">
          <span class="medal" aria-hidden="true">{{ a.earned ? '🏅' : '🔒' }}</span>
          <span class="text">
            <span class="name">{{ a.name }}</span>
            <span v-if="a.description" class="desc">{{ a.description }}</span>
            <RouterLink v-if="a.earned" class="when" :to="`/sessions/${a.earned.sessionId}`">{{ day(a.earned.t) }}</RouterLink>
          </span>
        </li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.hint { margin: 0; }
.group h2 { display: flex; align-items: baseline; gap: 10px; margin-top: 0; }
.group .count { color: var(--muted); font-size: 0.75em; font-weight: 600; }
.badges { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; }
.badge { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; border-radius: 12px; background: var(--panel-2); opacity: 0.6; }
.badge.earned { opacity: 1; background: color-mix(in srgb, var(--page) 16%, var(--panel-2)); }
.medal { font-size: 1.8em; line-height: 1; }
.text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.name { font-weight: 800; }
.desc { color: var(--muted); font-size: 0.9em; }
.when { font-size: 0.85em; font-weight: 700; }
</style>
