import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Pinned: a dev server that silently walks to the next port is how a demo
    // ends up pointing at the wrong build.
    port: 4920,
    strictPort: true,
  },
  preview: {
    port: 4921,
    strictPort: true,
  },
  build: {
    // The ffmpeg core is served from /public as a plain asset, never bundled.
    assetsInlineLimit: 0,
  },
})
