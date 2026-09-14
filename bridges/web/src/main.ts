import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { applyTheme, store } from './bridge'
import './style.css'

applyTheme() // before the first paint, so a dark phone does not flash light on every launch
createApp(App).use(router).mount('#app')
// handy in the devtools console: dhBridge.commanded, dhBridge.log, ...
;(window as unknown as { dhBridge: unknown }).dhBridge = store
