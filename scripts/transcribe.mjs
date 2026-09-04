/**
 * Transcribes a video into the word-level JSON the library expects, using
 * ElevenLabs Scribe.
 *
 * Deliberately a script you run rather than anything the page does. Cutlet
 * ships with no backend and no keys — the page's whole privacy claim is that
 * your video never leaves the tab, and an in-page transcription button would be
 * a lie in the footer. Preparing library material is a different job from using
 * the app, and this is where it belongs.
 *
 *   export ELEVENLABS_API_KEY="…"
 *   npm run transcribe -- some-video.mp4 apollo-11-crew
 *
 * Writes public/demo/<name>.words.json. Add the entry to library.json and
 * upload the mp4 to the demo-assets release, and the picker does the rest.
 */
import { writeFile, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openAsBlob } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const [videoPath, name] = process.argv.slice(2)

if (!videoPath || !name) {
  console.error('Usage: npm run transcribe -- <video file> <output name>')
  process.exit(1)
}

const key = process.env.ELEVENLABS_API_KEY
if (!key) {
  console.error(
    'ELEVENLABS_API_KEY is not set.\n' +
      '  export ELEVENLABS_API_KEY="…"   then run this again.\n' +
      'The key is read from the environment and never written anywhere.'
  )
  process.exit(1)
}

try {
  await stat(videoPath)
} catch {
  console.error(`No such file: ${videoPath}`)
  process.exit(1)
}

// Sending audio rather than video: the API only listens to the audio anyway,
// and a 150MB mp4 is a slow upload for a 6MB answer. Mono 16k is what speech
// recognition wants.
const audioPath = join(root, 'node_modules/.tmp-transcribe.mp3')
console.log('[transcribe] extracting audio…')
execFileSync(
  'ffmpeg',
  ['-y', '-i', videoPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', audioPath],
  { stdio: ['ignore', 'ignore', 'pipe'] }
)
const audioSize = (await stat(audioPath)).size
console.log(`[transcribe] audio is ${(audioSize / 1e6).toFixed(1)}MB, sending to Scribe…`)

const form = new FormData()
form.set('file', await openAsBlob(audioPath), `${name}.mp3`)
form.set('model_id', process.env.ELEVENLABS_MODEL ?? 'scribe_v2')
// Word-level timings are the whole point — sentence boundaries and every clip
// edge are derived from them, and a cue-level transcript cannot be split.
form.set('timestamps_granularity', 'word')
form.set('diarize', 'true')

const started = Date.now()
const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
  method: 'POST',
  headers: { 'xi-api-key': key },
  body: form,
})

if (!res.ok) {
  console.error(`[transcribe] Scribe answered ${res.status}: ${(await res.text()).slice(0, 400)}`)
  process.exit(1)
}

const result = await res.json()
const words = (result.words ?? []).filter((w) => w.type === 'word' || w.type === undefined)
if (!words.length) {
  console.error('[transcribe] came back with no words in it.')
  process.exit(1)
}

const out = join(root, 'public/demo', `${name}.words.json`)
await writeFile(
  out,
  JSON.stringify(
    {
      title: process.env.TITLE ?? name,
      speaker: process.env.SPEAKER ?? undefined,
      attribution: process.env.ATTRIBUTION ?? undefined,
      durationSeconds: result.audio_duration_secs,
      language: result.language_code,
      words,
    },
    null,
    2
  )
)

console.log(
  `[transcribe] wrote ${out}\n` +
    `  ${words.length} words, ${Math.round(result.audio_duration_secs ?? 0)}s of audio, ` +
    `${((Date.now() - started) / 1000).toFixed(1)}s round trip`
)
