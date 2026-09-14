<script setup lang="ts">
import { computed } from 'vue'
import type { Series } from '../charts'

const props = defineProps<{
  title: string
  series: Series
  w: number
  h: number
  pad: number
  xLabel?: (v: number) => string
  yLabel?: (v: number) => string
  fill?: boolean
}>()

const xl = computed(() => props.xLabel ?? ((v: number) => String(v)))
const yl = computed(() => props.yLabel ?? ((v: number) => String(v)))
const fillPath = computed(() => {
  if (!props.fill || !props.series.path) return ''
  // Close each subpath to the baseline for a soft area fill.
  const base = props.series.sy(Math.max(props.series.yDomain.min, 0))
  return props.series.path
    .split('M')
    .filter((s) => s.trim())
    .map((seg) => {
      const pts = seg.trim().split(/\s*L\s*/)
      const first = pts[0]!.split(' ')
      const last = pts[pts.length - 1]!.split(' ')
      return `M${seg.trim()} L${last[0]} ${base.toFixed(1)} L${first[0]} ${base.toFixed(1)} Z`
    })
    .join(' ')
})
</script>

<template>
  <div>
    <h3>{{ title }}</h3>
    <svg class="chart" :viewBox="`0 0 ${w} ${h}`" :aria-label="title">
      <g v-for="t in series.yTicks" :key="'y' + t">
        <line class="grid-line" :x1="pad" :x2="w - pad" :y1="series.sy(t)" :y2="series.sy(t)" />
        <text :x="pad - 4" :y="series.sy(t) + 3" text-anchor="end">{{ yl(t) }}</text>
      </g>
      <g v-for="t in series.xTicks" :key="'x' + t">
        <line class="grid-line" :y1="pad" :y2="h - pad" :x1="series.sx(t)" :x2="series.sx(t)" />
        <text :x="series.sx(t)" :y="h - pad + 12" text-anchor="middle">{{ xl(t) }}</text>
      </g>
      <path v-if="fillPath" class="fill" :d="fillPath" />
      <path class="series" :d="series.path" vector-effect="non-scaling-stroke" />
    </svg>
  </div>
</template>
