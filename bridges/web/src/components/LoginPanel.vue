<script setup lang="ts">
import { fetchMe, loginUrl, store } from '../bridge'
</script>

<template>
  <div class="card login">
    <h2>Not logged in</h2>
    <p class="muted">The server returned 401. Log in with a user id (stub auth), then come back here.</p>
    <label class="field"><span>uid</span><input type="text" v-model="store.loginUid" inputmode="numeric" /></label>
    <div class="row">
      <a :href="loginUrl()"><button class="primary">Log in as uid {{ store.loginUid || '1' }}</button></a>
      <button @click="fetchMe()">Retry</button>
    </div>
  </div>
</template>
