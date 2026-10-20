<script setup lang="ts">
// A player in one line: their avatar thumbnail (or initials), their name, their country's flag and their
// streak. Used by the Players page, the leaderboards and the profile header, so a player looks the same
// everywhere (PLAN.md §18.6).
import { computed } from 'vue'
import { countryName, flagOrCode } from '../flags'
import { playerName, streakIcon, streakText } from '../profiles'
import type { PlayerCard, Streak } from '../types'

const props = withDefaults(defineProps<{
  player: Pick<PlayerCard, 'username' | 'displayName' | 'firstName' | 'lastName' | 'country'> & {
    thumbnailUrl?: string | null
    streak?: Streak
    me?: boolean
  }
  size?: 'sm' | 'md' | 'lg'
  /** Show the @handle under the name. */
  handle?: boolean
  link?: boolean
}>(), { size: 'md', handle: false, link: true })

const name = computed(() => playerName(props.player))
const initials = computed(() =>
  name.value.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?')
const flag = computed(() => flagOrCode(props.player.country))
const where = computed(() => countryName(props.player.country))
</script>

<template>
  <component
    :is="link ? 'RouterLink' : 'span'"
    :to="link ? `/players/${player.username}` : undefined"
    class="chip" :class="[`chip-${size}`, { mine: player.me }]"
  >
    <span class="face" aria-hidden="true">
      <img v-if="player.thumbnailUrl" :src="player.thumbnailUrl" alt="" />
      <span v-else class="initials">{{ initials }}</span>
    </span>
    <span class="who">
      <span class="name">
        {{ name }}
        <span v-if="flag" class="flag" :title="where">{{ flag }}</span>
        <span v-if="player.me" class="you">you</span>
      </span>
      <span v-if="handle" class="handle">@{{ player.username }}</span>
      <span v-if="player.streak?.goal" class="streak" :title="streakText(player.streak)">
        <span class="fire" :class="{ lit: (player.streak.length ?? 0) > 0 }">{{ streakIcon(player.streak) }}</span>
        <template v-if="player.streak.length">{{ player.streak.length }}w</template>
      </span>
    </span>
  </component>
</template>

<style scoped>
.chip { display: flex; align-items: center; gap: 10px; min-width: 0; color: inherit; text-decoration: none; }
.chip:hover .name { text-decoration: underline; }
.face { flex: none; display: grid; place-items: center; overflow: hidden; border-radius: 50%;
  background: var(--panel-2); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 12%, transparent); }
.face img { width: 100%; height: 100%; object-fit: cover; }
.initials { font-weight: 800; color: var(--muted); }
.chip-sm .face { width: 28px; height: 28px; } .chip-sm .initials { font-size: 0.7em; }
.chip-md .face { width: 40px; height: 40px; } .chip-md .initials { font-size: 0.85em; }
.chip-lg .face { width: 76px; height: 76px; } .chip-lg .initials { font-size: 1.5em; }
.who { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.name { font-weight: 800; display: flex; align-items: center; gap: 6px; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
/* on a card there is room for two lines, and a cut-off name is worse than a wrapped one */
.chip-lg .name { font-size: 1.25em; white-space: normal; overflow: visible; flex-wrap: wrap; }
.flag { font-size: 1.05em; line-height: 1; }
.you { font-size: 0.62em; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase;
  padding: 1px 6px; border-radius: 999px; background: var(--page); color: #fff; }
.handle, .streak { font-size: 0.8em; color: var(--muted); font-weight: 600; display: flex; align-items: center; gap: 4px; }
.fire { filter: grayscale(1); opacity: 0.55; }
.fire.lit { filter: none; opacity: 1; animation: flicker 2.4s ease-in-out infinite; }
@keyframes flicker { 0%, 100% { transform: scale(1); } 45% { transform: scale(1.14) rotate(-3deg); } }
@media (prefers-reduced-motion: reduce) { .fire.lit { animation: none; } }
</style>
