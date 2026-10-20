<script setup lang="ts">
// A player's personal bests (PLAN.md §18.4).
//
// The leaderboards compare you with everybody; these compare you only with yourself, which is the kind of
// progress that is still available to somebody who will never be top of a board. Each one links to the
// session that set it, so "furthest ride" is a thing that happened rather than a number.
import { computed, onMounted, ref, watch } from 'vue'
import { personalBests } from '../profiles'
import { unitSystem } from '../session'
import * as u from '../units'
import type { PersonalBest } from '../types'

const props = defineProps<{ username: string }>()
const bests = ref<PersonalBest[]>([])
const loading = ref(true)

async function load(): Promise<void> {
  loading.value = true
  try {
    bests.value = await personalBests(props.username)
  } catch {
    bests.value = []   // a profile without bests simply does not show the panel
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => props.username, load)

const sys = computed(() => unitSystem())

const ICON: Record<PersonalBest['key'], string> = {
  distance: '📏', duration: '⏱️', elevation_gain: '⛰️', energy: '🔋',
}

function shown(b: PersonalBest): string {
  if (b.key === 'distance') return u.distance(b.value, sys.value, 1).text
  if (b.key === 'duration') return u.duration(b.value)
  if (b.key === 'elevation_gain') return u.length(b.value, sys.value, 0).text
  return u.energy(b.value).text
}
</script>

<template>
  <section v-if="!loading && bests.length" class="panel bests">
    <h2>Personal bests</h2>
    <ul>
      <li v-for="b in bests" :key="b.key">
        <RouterLink :to="`/sessions/${b.sessionId}`">
          <span class="icon" aria-hidden="true">{{ ICON[b.key] }}</span>
          <span class="v">{{ shown(b) }}</span>
          <span class="t">{{ b.title }}</span>
        </RouterLink>
      </li>
    </ul>
  </section>
</template>

<style scoped>
/* A grid rather than a flex row, so one best on its own is a card and not a banner across the page. */
.bests ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px;
  grid-template-columns: repeat(auto-fit, minmax(150px, 220px)); }
.bests a { display: flex; flex-direction: column; gap: 1px; padding: 10px 12px; border-radius: 12px;
  background: color-mix(in srgb, var(--text) 4%, transparent); text-decoration: none; color: inherit;
  transition: background 0.12s ease; }
.bests a:hover { background: color-mix(in srgb, var(--page) 16%, transparent); }
.icon { font-size: 1.1em; }
.v { font-weight: 900; font-size: 1.25em; font-variant-numeric: tabular-nums; }
.t { font-size: 0.82em; opacity: 0.72; }
</style>
