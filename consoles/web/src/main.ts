import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { bootstrap } from './session'
import { applyTheme, readTheme } from './theme'
import './style.css'

applyTheme(readTheme())

// Log in from ?uid= and load /api/me before the router resolves the first route (admin guard needs me).
bootstrap().finally(() => {
  createApp(App).use(router).mount('#app')
})
