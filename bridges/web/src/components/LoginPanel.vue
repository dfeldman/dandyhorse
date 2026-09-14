<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { fetchMe, loginUrl, store } from '../bridge'

// How this server logs people in: a user number (development) or Google (online). /api/auth needs no login.
const mode = ref<'stub' | 'oidc' | null>(null)
onMounted(async () => {
  try {
    const r = await fetch('/api/auth', { credentials: 'same-origin' })
    mode.value = r.ok ? ((await r.json()) as { mode: 'stub' | 'oidc' }).mode : 'stub'
  } catch {
    mode.value = 'stub'
  }
})
</script>

<template>
  <div class="card login">
    <h2>Not logged in</h2>
    <template v-if="mode === 'oidc'">
      <p class="muted">Sign in with your Google account; you'll come straight back here.</p>
      <div class="row">
        <a :href="loginUrl('oidc')"><button class="primary">Sign in with Google</button></a>
        <button @click="fetchMe()">Retry</button>
      </div>
    </template>
    <template v-else-if="mode === 'stub'">
      <p class="muted">The server returned 401. Log in with a user id (the development login), then come back here.</p>
      <label class="field"><span>uid</span><input type="text" v-model="store.loginUid" inputmode="numeric" /></label>
      <div class="row">
        <a :href="loginUrl()"><button class="primary">Log in as uid {{ store.loginUid || '1' }}</button></a>
        <button @click="fetchMe()">Retry</button>
      </div>
    </template>
  </div>
</template>
