<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api'
import { store, login } from '../session'

// How this server logs people in: a user number (development) or Google (online). /api/auth needs no login.
const mode = ref<'stub' | 'oidc' | null>(null)
const uid = ref<number | null>(store.me?.uid ?? null)
const busy = ref(false)

onMounted(async () => {
  try {
    mode.value = (await api<{ mode: 'stub' | 'oidc' }>('/api/auth')).mode
  } catch {
    mode.value = 'stub'
  }
})

/** Google sign-in is a full-page trip: the server sends the browser to Google and back here. */
function google(): void {
  const here = location.pathname + location.search + location.hash
  location.href = `/login?next=${encodeURIComponent(here)}`
}

async function submit() {
  if (!uid.value || uid.value <= 0) {
    store.loginError = 'Enter a positive user number'
    return
  }
  busy.value = true
  try {
    await login(Math.floor(uid.value))
  } catch {
    // error is shown from store.loginError
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="login panel page-games">
    <div class="brand"><span class="mark"></span>Dandyhorse</div>
    <template v-if="mode === 'oidc'">
      <p class="muted">Sign in with your Google account. The first time, you'll pick a username.</p>
      <p v-if="store.loginError" class="error small">{{ store.loginError }}</p>
      <button class="btn big primary block" type="button" autofocus @click="google">Sign in with Google</button>
    </template>
    <template v-else-if="mode === 'stub'">
      <p class="muted">Log in with a user number (the development login).</p>
      <form @submit.prevent="submit" class="form one">
        <label class="field">
          <span>User</span>
          <input type="number" min="1" step="1" v-model.number="uid" autofocus />
        </label>
        <p v-if="store.loginError" class="error small">{{ store.loginError }}</p>
        <button class="btn big primary block" type="submit" :disabled="busy">Log in</button>
      </form>
    </template>
  </div>
</template>
