<template>
  <section class="page page-leaderboards">
    <div class="page-head">
      <h1>Leaderboards</h1>
    </div>
    <p class="lead-text">Leaderboards are coming soon.</p>
    <div class="skeleton" aria-hidden="true">
      <div v-for="i in 5" :key="i" class="sk"><span></span><span></span><span></span></div>
    </div>
  </section>
</template>

<style scoped>
.lead-text { font-weight: 700; font-size: 1.1em; color: var(--muted); margin: 0; }
</style>
