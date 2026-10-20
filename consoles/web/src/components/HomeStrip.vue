<script setup lang="ts">
// The strip above the games (PLAN.md §18.5): where you are this week, and one thing to do about it.
//
// A grid of games tells a returning player nothing about themselves. This is the first thing on the first
// screen, so it is deliberately short: the week against the goal, the streak, the proudest rank, and one
// sentence saying what would help. The server picks the sentence — see social/home.py — because which
// nudge matters most is a product decision, not a layout one.
import { computed, onMounted, ref } from 'vue'
import { homeSummary } from '../profiles'
import { unitSystem } from '../session'
import * as u from '../units'
import CountUp from './CountUp.vue'
import type { HomeSummary } from '../types'

const home = ref<HomeSummary | null>(null)
const failed = ref(false)

onMounted(async () => {
  try {
    home.value = await homeSummary()
  } catch {
    // A summary is encouragement, not function: if it will not load, the games are still there.
    failed.value = true
  }
})

const sys = computed(() => unitSystem())
const km = (m: number): string => u.distance(m, sys.value, 1).text
const hours = (s: number): string => u.duration(s)

/** The goal as pips: filled for sessions done, hollow for the ones still owed. */
const pips = computed(() => {
  const h = home.value
  if (!h?.goal) return []
  const n = Math.max(h.goal, h.week.sessions)
  return Array.from({ length: n }, (_, i) => i < h.week.sessions)
})
</script>

<template>
  <section v-if="home && !failed" class="strip" :class="`tone-${home.nudge.tone}`">
    <div class="line">
      <div class="facts">
        <span class="fact">
          <b><CountUp :value="home.week.sessions" :format="(v) => String(Math.round(v))" /></b>
          <span v-if="home.goal" class="of">/ {{ home.goal }}</span>
          <span class="label">this week</span>
        </span>
        <span v-if="home.week.distance > 0" class="fact">
          <b>{{ km(home.week.distance) }}</b><span class="label">ridden</span>
        </span>
        <span v-if="home.week.duration > 0" class="fact">
          <b>{{ hours(home.week.duration) }}</b><span class="label">moving</span>
        </span>
        <span v-if="home.streak > 0" class="fact">
          <b>🔥 {{ home.streak }}</b><span class="label">week streak</span>
        </span>
        <RouterLink v-if="home.best" class="fact rank" to="/leaderboards">
          <b>#{{ home.best.rank }}</b><span class="label">{{ home.best.title }}</span>
        </RouterLink>
      </div>
      <ul v-if="pips.length" class="pips" :aria-label="`${home.week.sessions} of ${home.goal} sessions this week`">
        <li v-for="(done, i) in pips" :key="i" :class="{ done }"></li>
      </ul>
    </div>

    <p class="nudge">
      <span>{{ home.nudge.text }}</span>
      <RouterLink v-if="home.nudge.action === 'goal'" to="/preferences" class="go">Set a goal</RouterLink>
      <RouterLink v-if="home.unseenCheers" to="/feed" class="go cheers">
        {{ home.unseenCheers }} new {{ home.unseenCheers === 1 ? 'cheer' : 'cheers' }}
      </RouterLink>
    </p>
  </section>
</template>

<style scoped>
.strip { padding: 14px 18px; border-radius: 16px; background: var(--panel); box-shadow: var(--shadow);
  margin-bottom: 16px; border-left: 4px solid var(--page); }
.strip.tone-good { border-left-color: #6ee7a8; }
.strip.tone-urgent { border-left-color: #ffb648; }

.line { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 26px; }
.facts { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px 22px; flex: 1; min-width: 0; }
.fact { display: inline-flex; align-items: baseline; gap: 6px; text-decoration: none; color: inherit; }
.fact b { font-size: 1.5em; font-weight: 900; font-variant-numeric: tabular-nums; }
.of { font-size: 1.05em; font-weight: 800; opacity: 0.55; }
.label { font-size: 0.82em; opacity: 0.7; }
.rank:hover .label { opacity: 1; text-decoration: underline; }

.pips { display: flex; gap: 5px; list-style: none; margin: 0; padding: 0; }
.pips li { width: 13px; height: 13px; border-radius: 50%;
  background: color-mix(in srgb, var(--text) 14%, transparent); }
.pips li.done { background: linear-gradient(135deg, var(--page), #6ee7a8); }

.nudge { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin: 8px 0 0; font-weight: 600; }
.go { font-weight: 800; padding: 3px 11px; border-radius: 999px; background: var(--page); color: var(--on-page);
  text-decoration: none; font-size: 0.86em; }
.cheers { background: #ff5d5d; }

@media (max-width: 620px) {
  .fact b { font-size: 1.25em; }
}
</style>
