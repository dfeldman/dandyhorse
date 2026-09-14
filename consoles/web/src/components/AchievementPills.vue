<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api'
import { label } from '../achievements'
import type { Game } from '../types'

// Achievements earned in one session, by name, each a way to the Achievements page.
defineProps<{ keys: string[] }>()
const games = ref<Game[]>([])
onMounted(async () => {
  try {
    games.value = (await api<{ games: Game[] }>('/api/games')).games
  } catch {
    // the names then come from the ids
  }
})
</script>

<template>
  <div class="actions">
    <RouterLink v-for="k in keys" :key="k" to="/achievements" class="pill">🏅 {{ label(k, games) }}</RouterLink>
  </div>
</template>
