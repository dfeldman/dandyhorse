import { defineConfig } from 'vite'

// On Dandyhorse the game is served from /games/laneone/; the dev server proxies the platform's API to a local
// `make serve` so a session started from the console can be played from here too.
const API = 'http://localhost:8080'
// '/games' minus this game's own folder, or the dev server would hand its own pages to the built copy on 8080
const proxyPaths = ['/api', '/gameapi', '/bridgeapi', '/login', '/oidc', '/auth', '^/games/(?!laneone/)', '/consoles', '/bridges']

export default defineConfig({
  base: '/games/laneone/',
  server: {
    port: 5198,
    strictPort: true,
    proxy: Object.fromEntries(proxyPaths.map((p) => [p, { target: API, changeOrigin: false }])),
  },
})
