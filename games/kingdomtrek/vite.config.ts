import { defineConfig } from 'vite'

// Served by the Dandyhorse server at /games/kingdomtrek/ (data files load through import.meta.env.BASE_URL).
// `npm run dev` proxies the platform's APIs to it, so ?session= works against `make serve` too.
const API = 'http://localhost:8080'
const proxyPaths = ['/api', '/gameapi', '/bridgeapi', '/login', '/consoles', '/bridges']

export default defineConfig({
  base: '/games/kingdomtrek/',
  server: {
    port: 5188,
    strictPort: true,
    proxy: Object.fromEntries(proxyPaths.map((p) => [p, { target: API, changeOrigin: false }])),
  },
})
