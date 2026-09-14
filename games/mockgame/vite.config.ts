import { defineConfig } from 'vite'

const API = 'http://localhost:8080'
const proxyPaths = ['/api', '/gameapi', '/bridgeapi', '/games', '/consoles', '/bridges']

export default defineConfig({
  base: '/games/mockgame/',
  server: {
    port: 5175,
    strictPort: true,
    proxy: Object.fromEntries(proxyPaths.map((p) => [p, { target: API, changeOrigin: false }])),
  },
})
