<script setup lang="ts">
import { ref } from 'vue'
import { store, login } from '../session'

const uid = ref<number | null>(store.me?.uid ?? null)
const busy = ref(false)

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
    <p class="muted">Log in with a user number (stub login; single sign-on comes later).</p>
    <form @submit.prevent="submit" class="form one">
      <label class="field">
        <span>User</span>
        <input type="number" min="1" step="1" v-model.number="uid" autofocus />
      </label>
      <p v-if="store.loginError" class="error small">{{ store.loginError }}</p>
      <button class="btn big primary block" type="submit" :disabled="busy">Log in</button>
    </form>
  </div>
</template>
