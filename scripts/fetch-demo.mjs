/**
 * Fetches the demo video into public/demo/, the same way sync-ffmpeg.mjs fetches
 * the wasm core: a large binary that the project needs at runtime but that has
 * no business sitting in git history.
 *
 * The video is 18MB of public-domain footage. Committing it would put that in
 * every clone forever, so it lives on a release instead and is pulled down on
 * demand. Everything else about the demo — the transcript, the timings, the
 * attribution — is small, and stays in the repository where it can be diffed.
 *
 * Failing here is not fatal. A checkout with no demo video still runs; it opens
 * on "bring your own video", which is a legitimate way to use ClipClub and the
 * only way anyone uses it on their own footage.
 */
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'public/demo/jfk-rice-moon.mp4')

/** Overridable so a fork can point at its own copy without editing this file. */
const url =
  process.env.DEMO_VIDEO_URL ??
  'https://github.com/sheeesh3/clipclub/releases/download/demo-assets/jfk-rice-moon.mp4'

// Roughly 18MB. Checked only to notice a redirect-to-HTML or a truncated body,
// not to pin an exact byte count.
const MIN_BYTES = 5_000_000

async function alreadyHere() {
  try {
    const info = await stat(target)
    return info.size > MIN_BYTES
  } catch {
    return false
  }
}

function giveUp(reason) {
  console.warn(
    `\n[fetch-demo] ${reason}\n` +
      `The app will still run — it opens on "bring your own video".\n` +
      `To get the demo, download it yourself to public/demo/jfk-rice-moon.mp4:\n` +
      `  ${url}\n`
  )
  process.exit(0)
}

if (await alreadyHere()) {
  console.log('[fetch-demo] public/demo/jfk-rice-moon.mp4 is already here')
  process.exit(0)
}

await mkdir(dirname(target), { recursive: true })

// A private repo's release assets need credentials; a public one's do not. Send
// a token when the environment has one, which covers CI without requiring it.
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
const headers = { Accept: 'application/octet-stream' }
if (token) headers.Authorization = `Bearer ${token}`

let response
try {
  response = await fetch(url, { headers, redirect: 'follow' })
} catch (err) {
  giveUp(`Could not reach the download (${err.message}).`)
}

if (!response.ok) {
  giveUp(
    response.status === 404
      ? 'The demo video is not published at that URL yet (404).'
      : `The download answered ${response.status}.`
  )
}

const bytes = new Uint8Array(await response.arrayBuffer())
if (bytes.byteLength < MIN_BYTES) {
  giveUp(`That download was only ${bytes.byteLength} bytes — not the video.`)
}

await writeFile(target, bytes)
console.log(
  `[fetch-demo] wrote public/demo/jfk-rice-moon.mp4 (${(bytes.byteLength / 1e6).toFixed(1)}MB)`
)
