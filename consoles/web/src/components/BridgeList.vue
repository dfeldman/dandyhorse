<script setup lang="ts">
import type { Bridge } from '../types'
import { deviceStatusWord, deviceTypeName, freshBridges, standing } from '../status'
import { ago } from '../units'

const props = defineProps<{ bridges: Bridge[] }>()
const fresh = () => freshBridges(props.bridges)
</script>

<template>
  <p v-if="fresh().length === 0" class="muted">No bridge connected. Open the bridge on your phone or in another tab.</p>
  <ul v-else class="bridges">
    <li v-for="b in fresh()" :key="b.bridgeId">
      <div class="who">
        <span>{{ b.label || 'Bridge' }}</span>
        <span class="muted small">seen {{ ago(b.lastSeen) }}<template v-if="standing(b)"> · {{ standing(b) }}</template></span>
      </div>
      <div v-if="b.devices.length === 0" class="muted small">no devices</div>
      <div v-for="(d, i) in b.devices" :key="i" class="dev">
        <span class="pill" :class="{ ok: d.status === 'connected' || d.status === 'simulated' || d.status === 'readonly', warn: d.status === 'connecting', bad: d.status === 'disconnected' }">{{ deviceStatusWord(d) }}</span>
        <span>{{ d.name || deviceTypeName(d.type) }}</span>
        <span class="muted small">{{ deviceTypeName(d.type) }}</span>
      </div>
    </li>
  </ul>
</template>
