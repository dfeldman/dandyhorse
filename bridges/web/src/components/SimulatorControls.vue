<script setup lang="ts">
import { computed } from 'vue'
import { simulator, simulatorHrm, store, toggleSimulator, toggleSimulatorHrm } from '../bridge'
import { fmtSpeed } from '../units'

const sim = computed(() => simulator())
const hrm = computed(() => simulatorHrm())
const KMH = 3.6

// Dragging an "actual" slider means "I am the machine now": stop following commanded so the slider wins.
function num(e: Event): number { return parseFloat((e.target as HTMLInputElement).value) }
function sliderSpeed(e: Event) { const s = sim.value; if (!s) return; s.controls.follow = false; s.controls.speed = num(e) }
function sliderIncline(e: Event) { const s = sim.value; if (!s) return; s.controls.follow = false; s.controls.incline = num(e) }
function sliderPower(e: Event) { const s = sim.value; if (!s) return; s.controls.follow = false; s.controls.power = num(e) }
</script>

<template>
  <div class="card">
    <h3>Simulator</h3>
    <div class="row">
      <button :class="{ primary: sim?.deviceType === 'treadmill' }" @click="toggleSimulator('treadmill')">{{ sim?.deviceType === 'treadmill' ? 'Stop treadmill sim' : 'Treadmill sim' }}</button>
      <button :class="{ primary: sim?.deviceType === 'bike' }" @click="toggleSimulator('bike')">{{ sim?.deviceType === 'bike' ? 'Stop bike sim' : 'Bike sim' }}</button>
      <button :class="{ primary: !!hrm }" @click="toggleSimulatorHrm()">{{ hrm ? 'Stop HR sim' : 'HR sim' }}</button>
    </div>
    <template v-if="sim">
      <div class="row" style="margin-top: 10px">
        <label class="chip"><input type="checkbox" v-model="sim.controls.follow" /> follow commanded (2 s lag)</label>
        <label class="chip"><input type="checkbox" v-model="sim.controls.noData" /> device sends no data</label>
        <button v-if="sim.status !== 'disconnected'" @click="sim.powerOff()">Switch device off</button>
        <button v-else class="primary" @click="sim.powerOn()">Switch device on</button>
      </div>
      <p class="muted small">Any of these, or "stop reporting" below, pauses the game after 5 s. The heart-rate sim never does.</p>
      <template v-if="sim.deviceType === 'treadmill'">
        <label class="field"><span>actual speed: {{ fmtSpeed(sim.controls.speed, store.unitSystem) }} {{ sim.controls.follow ? '(follow is on: drag to take over)' : '' }}</span>
          <input type="range" min="0" max="8" step="0.05" :value="sim.controls.speed" @input="sliderSpeed($event)" /></label>
        <label class="field"><span>actual incline: {{ sim.controls.incline.toFixed(1) }} %</span>
          <input type="range" min="-3" max="15" step="0.5" :value="sim.controls.incline" @input="sliderIncline($event)" /></label>
        <div class="row">
          <button v-if="!sim.userStopped" class="danger" @click="sim.userPressStop()">User pressed STOP on the machine</button>
          <button v-else @click="sim.userPressStart()">User pressed START on the machine</button>
        </div>
        <div class="row">
          <button @click="sim.userPressSpeed(0.5 / KMH)">User pressed +0.5 km/h</button>
          <button @click="sim.userPressSpeed(-0.5 / KMH)">User pressed −0.5 km/h</button>
          <span class="muted" v-if="sim.controls.manualSpeed != null">manual target {{ fmtSpeed(sim.controls.manualSpeed, store.unitSystem) }} until the next command</span>
        </div>
      </template>
      <template v-else>
        <label class="field"><span>cadence: {{ sim.controls.cadence }} rpm</span>
          <input type="range" min="0" max="140" step="1" v-model.number="sim.controls.cadence" /></label>
        <label class="field"><span>power: {{ sim.controls.power }} W {{ sim.controls.follow ? '(follow is on: drag to take over)' : '' }}</span>
          <input type="range" min="0" max="600" step="5" :value="sim.controls.power" @input="sliderPower($event)" /></label>
      </template>
    </template>
    <template v-if="hrm">
      <label class="field" style="margin-top: 10px"><span>heart rate: {{ hrm.controls.heartRate }} bpm</span>
        <input type="range" min="40" max="200" step="1" v-model.number="hrm.controls.heartRate" /></label>
      <label class="chip"><input type="checkbox" v-model="hrm.controls.wobble" /> wobble</label>
    </template>
  </div>
</template>
