<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api'
import type { Game, GamesResponse, Variant } from '../types'
import { deviceTypeName, initialOf } from '../status'
import LaunchDialog from '../components/LaunchDialog.vue'
import HomeStrip from '../components/HomeStrip.vue'

const games = ref<Game[]>([])
const error = ref<string | null>(null)
const loading = ref(true)
const picked = ref<{ game: Game; variant: Variant } | null>(null)

onMounted(async () => {
  try {
    games.value = (await api<GamesResponse>('/api/games')).games
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <section class="page page-games">
    <HomeStrip />
    <div class="page-head">
      <h1>Games</h1>
      <span class="lead">Pick a game to play</span>
    </div>
    <p v-if="error" class="notice error">{{ error }}</p>
    <p v-else-if="loading" class="muted">Loading…</p>
    <p v-else-if="games.length === 0" class="empty">No games installed yet.</p>
    <div class="cards">
      <template v-for="g in games" :key="g.id">
        <button v-for="v in g.variants" :key="g.id + ':' + v.id" type="button" class="card" @click="picked = { game: g, variant: v }">
          <div class="shot">
            <img v-if="v.screenshotUrl ?? g.screenshotUrl" :src="(v.screenshotUrl ?? g.screenshotUrl)!" :alt="v.name" loading="lazy" />
            <span v-else class="initial">{{ initialOf(g.name) }}</span>
            <span class="pills"><span v-for="d in v.deviceTypes" :key="d" class="pill device">{{ deviceTypeName(d) }}</span></span>
          </div>
          <div class="body">
            <div class="title">{{ v.name }}</div>
            <div class="sub">{{ g.name }}</div>
          </div>
        </button>
      </template>
    </div>
    <LaunchDialog v-if="picked" :game="picked.game" :variant="picked.variant" @close="picked = null" />
  </section>
</template>
