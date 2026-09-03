/**
 * Copies the single-thread ffmpeg core out of node_modules and into public/, so
 * the page can serve it from its own origin.
 *
 * Two things here are deliberate:
 *  - The ESM build, not the UMD one. Bundlers spawn ffmpeg.wasm's worker as a
 *    module worker, where `importScripts` does not exist; the loader then falls
 *    back to a dynamic import, which a UMD bundle cannot satisfy.
 *  - Copied at build time rather than committed. The wasm is 31MB, and a
 *    checked-in binary that large is a repository nobody wants to clone.
 */
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const from = join(root, 'node_modules/@ffmpeg/core/dist/esm')
const to = join(root, 'public/ffmpeg')
const files = ['ffmpeg-core.js', 'ffmpeg-core.wasm']

await mkdir(to, { recursive: true })

for (const file of files) {
  const source = join(from, file)
  try {
    await stat(source)
  } catch {
    console.error(
      `\n[sync-ffmpeg] Missing ${source}\n` +
        `Run "npm install" first — @ffmpeg/core provides these.\n`
    )
    process.exit(1)
  }
  await copyFile(source, join(to, file))
}

console.log(`[sync-ffmpeg] copied ${files.length} files to public/ffmpeg`)
