import { defineConfig } from 'vite'

// Pubblicata su GitHub Pages sotto /officina-3d/
export default defineConfig({
  base: '/officina-3d/',
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
})
