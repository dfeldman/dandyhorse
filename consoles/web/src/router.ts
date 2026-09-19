import { createRouter, createWebHashHistory } from 'vue-router'
import { store } from './session'
import Games from './views/Games.vue'
import History from './views/History.vue'
import SessionDetail from './views/SessionDetail.vue'
import Preferences from './views/Preferences.vue'
import Status from './views/Status.vue'
import Leaderboards from './views/Leaderboards.vue'
import Achievements from './views/Achievements.vue'
import Admin from './views/Admin.vue'
// the designer and Babylon load only when the page is opened (see views/Avatar.vue)
const Avatar = () => import('./views/Avatar.vue')

export const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'games', component: Games },
    { path: '/sessions', name: 'history', component: History },
    { path: '/sessions/:id', name: 'session', component: SessionDetail, props: true },
    { path: '/devices', redirect: '/preferences' },
    { path: '/preferences', name: 'preferences', component: Preferences },
    { path: '/avatar', name: 'avatar', component: Avatar }, // reached from Preferences, not a tab
    { path: '/status', name: 'status', component: Status }, // developer route, not linked
    { path: '/leaderboards', name: 'leaderboards', component: Leaderboards },
    { path: '/achievements', name: 'achievements', component: Achievements },
    { path: '/admin', name: 'admin', component: Admin, beforeEnter: () => (store.me?.isAdmin ? true : { path: '/' }) },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
