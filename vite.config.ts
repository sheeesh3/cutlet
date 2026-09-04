import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves a project site from /<repo>/, so the build needs to know
  // its own prefix. Everything that loads an asset at runtime — the demo media,
  // the ffmpeg core — already goes through import.meta.env.BASE_URL, so setting
  // this is the whole of it. Unset means root, which is what dev wants.
  base: process.env.BASE_PATH ?? '/',
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
