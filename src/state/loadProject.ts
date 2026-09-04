import { parseTranscript } from '../transcript/parse'
import { buildSentences } from '../transcript/sentences'
import { setProject, setError, setLoading } from './store'
import type { Project } from '../types'

const DEMO_VIDEO = 'demo/jfk-rice-moon.mp4'
const DEMO_TRANSCRIPT = 'demo/jfk-rice-moon.words.json'

function url(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`
}

async function videoDuration(src: string): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => resolve(Number.isFinite(v.duration) ? v.duration : 0)
    v.onerror = () => resolve(0)
    v.src = src
  })
}

export async function loadDemoProject(): Promise<void> {
  setLoading(true)
  try {
    const res = await fetch(url(DEMO_TRANSCRIPT))
    if (!res.ok) throw new Error(`Could not load the demo transcript (${res.status}).`)
    const raw = await res.text()
    const meta = JSON.parse(raw) as { title?: string; speaker?: string; attribution?: string; durationSeconds?: number }

    const { words } = parseTranscript(raw, DEMO_TRANSCRIPT)
    const sentences = buildSentences(words)
    const videoUrl = url(DEMO_VIDEO)

    // The video is fetched at setup rather than committed, so a fresh checkout
    // that skipped it would otherwise load a transcript against a silent black
    // rectangle. Say what happened and what fixes it.
    const probe = await fetch(videoUrl, { method: 'HEAD' }).catch(() => null)
    if (!probe || !probe.ok) {
      throw new Error(
        'The demo transcript loaded, but the demo video is not here. It is ' +
          'fetched rather than committed — run "npm run fetch:demo" to get it. ' +
          'You can also just open your own video and transcript.'
      )
    }

    const project: Project = {
      name: meta.title ?? 'Demo project',
      videoUrl,
      videoLabel: `${meta.title ?? 'Demo'}${meta.speaker ? ` — ${meta.speaker}` : ''}`,
      attribution: meta.attribution,
      sentences,
      duration: meta.durationSeconds ?? (await videoDuration(videoUrl)),
    }
    setProject(project)
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err))
  }
}

/**
 * Opens a video and transcript the user picked from their own disk. The file
 * never leaves the tab — it is handed to the <video> as an object URL and to
 * ffmpeg.wasm as bytes, and nothing uploads it anywhere.
 */
export async function loadLocalProject(video: File, transcript: File): Promise<void> {
  setLoading(true)
  try {
    const raw = await transcript.text()
    const { words, coarse } = parseTranscript(raw, transcript.name)
    if (!words.length) throw new Error('That transcript had no usable timings in it.')

    const sentences = buildSentences(words, coarse ? { pauseSeconds: 999, minWords: 1 } : {})
    const videoUrl = URL.createObjectURL(video)

    setProject({
      name: video.name.replace(/\.[^.]+$/, ''),
      videoUrl,
      videoLabel: video.name,
      sentences,
      duration: await videoDuration(videoUrl),
    })
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err))
  }
}
