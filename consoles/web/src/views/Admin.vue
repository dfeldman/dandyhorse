<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api, ApiError } from '../api'
import type { GamesResponse } from '../types'
import AdminPlayers from '../components/AdminPlayers.vue'

const valid = ref<string[]>([])
const invalid = ref<Record<string, unknown>>({})
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const busy = ref(false)

async function load() {
  try {
    const res = await api<GamesResponse>('/api/games')
    valid.value = res.games.map((g) => `${g.id} v${g.version}`)
    invalid.value = res.invalid ?? {}
  } catch (e) {
    error.value = (e as Error).message
  }
}
async function rescan() {
  busy.value = true
  error.value = null
  try {
    const res = await api<{ games: string[]; invalid: Record<string, unknown> }>('/api/admin/rescan', 'POST')
    notice.value = `Rescanned: ${res.games.length} valid, ${Object.keys(res.invalid).length} invalid`
    await load()
  } catch (e) {
    error.value = e instanceof ApiError ? `${e.code}: ${e.message}` : (e as Error).message
  } finally {
    busy.value = false
  }
}
onMounted(load)
</script>

<template>
  <section class="page page-admin">
    <div class="page-head"><h1>Admin</h1></div>
    <p v-if="error" class="notice error">{{ error }}</p>
    <p v-if="notice" class="notice ok">{{ notice }}</p>
    <AdminPlayers />
    <div class="panel">
      <h2>Game catalog</h2>
      <div class="actions"><button type="button" class="btn big primary" :disabled="busy" @click="rescan">Rescan games</button></div>
      <div>
        <h3>Valid</h3>
        <p v-if="valid.length === 0" class="muted">none</p>
        <div v-else class="rows">
          <div v-for="v in valid" :key="v" class="row-plain"><span class="pill ok">ok</span><span class="mono">{{ v }}</span></div>
        </div>
      </div>
      <div>
        <h3>Invalid games</h3>
        <p v-if="Object.keys(invalid).length === 0" class="muted">None.</p>
        <div v-else class="rows">
          <div v-for="(why, id) in invalid" :key="id" class="row-plain">
            <span class="pill bad">invalid</span>
            <span><span class="mono">{{ id }}</span><br /><span class="muted small">{{ typeof why === 'string' ? why : JSON.stringify(why) }}</span></span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.row-plain { display: flex; gap: 12px; align-items: center; padding: 10px 14px; border-radius: var(--radius-sm); background: var(--panel-2); }
</style>
