<script setup lang="ts">
import { ref } from 'vue'
import { api } from '../api'
import { store } from '../session'
import type { Me } from '../types'

// A first Google sign-in makes the account; the username is the one thing left to ask (the server's rule).
const RULE = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,23}$/
const name = ref(suggest())
const error = ref<string | null>(null)
const busy = ref(false)

/** The display name Google gave, if it makes a valid username once accents and spaces are dropped. */
function suggest(): string {
  const base = (store.me?.displayName ?? '').normalize('NFKD').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 24)
  return RULE.test(base) ? base : ''
}

async function save(): Promise<void> {
  const v = name.value.trim()
  if (!RULE.test(v)) {
    error.value = '2 to 24 letters, digits, dots, dashes or underscores, starting with a letter or digit'
    return
  }
  busy.value = true
  error.value = null
  try {
    store.me = await api<Me>('/api/me', 'PUT', { username: v })
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="login panel page-games">
    <div class="brand"><span class="mark"></span>Dandyhorse</div>
    <h2>Welcome{{ store.me?.displayName ? `, ${store.me.displayName}` : '' }}!</h2>
    <p class="muted">Pick a username. It's how you show up on leaderboards, and you can change it later in Preferences.</p>
    <form @submit.prevent="save" class="form one">
      <label class="field">
        <span>Username</span>
        <input type="text" v-model="name" maxlength="24" autocomplete="username" autocapitalize="off" spellcheck="false" autofocus />
      </label>
      <p v-if="error" class="error small">{{ error }}</p>
      <button class="btn big primary block" type="submit" :disabled="busy">Continue</button>
    </form>
  </div>
</template>
