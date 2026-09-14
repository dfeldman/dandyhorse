<template>
  <section class="page page-achievements">
    <div class="page-head">
      <h1>Achievements</h1>
    </div>
    <p class="lead-text">Achievements are coming soon.</p>
    <div class="skeleton" aria-hidden="true">
      <div v-for="i in 4" :key="i" class="sk"><span></span><span></span><span></span></div>
    </div>
  </section>
</template>

<style scoped>
.lead-text { font-weight: 700; font-size: 1.1em; color: var(--muted); margin: 0; }
</style>
