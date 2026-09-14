import { defineConfig } from 'vite'

const API = 'http://localhost:8080'
const proxyPaths = ['/api', '/gameapi', '/bridgeapi', '/games', '/consoles', '/bridges']

export default defineConfig({
  base: '/games/rollinghills/',
  server: {
    port: 5176,
    strictPort: true,
    proxy: Object.fromEntries(proxyPaths.map((p) => [p, { target: API, changeOrigin: false }])),
  },
})
