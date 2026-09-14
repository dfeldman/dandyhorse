<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { store } from '../bridge'
import { startRemoteConsumer, stopRemoteConsumer } from '../remoteConsumer'
import DebugDandyhorse from './DebugDandyhorse.vue'
import DebugFtms from './DebugFtms.vue'
import DevicesTab from './DevicesTab.vue'
import Home from './Home.vue'

const route = useRoute()
const launching = computed(() => route.name === 'session')
const routeSessionId = computed(() => (typeof route.params.id === 'string' ? route.params.id : null))
const autoOffer = computed(() => route.query.game === '1')
// A launching bridge is the big screen: let the user's other bridges drive it with their d-pads.
watch(() => launching.value && !store.needLogin, (on) => { if (on) startRemoteConsumer(); else stopRemoteConsumer() }, { immediate: true })
</script>

<template>
  <main class="content">
    <Home v-show="store.tab === 'session'" :launching="launching" :route-session-id="routeSessionId" :auto-offer="autoOffer" />
    <DevicesTab v-show="store.tab === 'devices'" />
    <!-- developer tools stay mounted (v-show): the FTMS console holds a device the user may hand to the session -->
    <DebugDandyhorse v-if="store.devTools" v-show="store.tab === 'debug'" />
    <DebugFtms v-if="store.devTools" v-show="store.tab === 'ftms'" />
  </main>
</template>
