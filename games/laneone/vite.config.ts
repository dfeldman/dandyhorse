import { defineConfig } from 'vite'

// base './' so the build works from any folder (on Dandyhorse it will be /games/laneone/).
export default defineConfig({
  base: './',
  server: { port: 5198, strictPort: true },
})
