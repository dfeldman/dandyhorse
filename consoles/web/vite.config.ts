import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const API = 'http://localhost:8080'
const proxyPaths = ['/api', '/gameapi', '/bridgeapi', '/games', '/consoles', '/bridges']

export default defineConfig({
  plugins: [vue()],
  base: '/consoles/web/',
  server: {
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(proxyPaths.map((p) => [p, { target: API, changeOrigin: false }])),
  },
})
