import { createRouter, createWebHashHistory } from 'vue-router'
import Main from './views/Main.vue'

export const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: Main },
    { path: '/join', name: 'join', component: Main },
    { path: '/session/:id', name: 'session', component: Main },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
