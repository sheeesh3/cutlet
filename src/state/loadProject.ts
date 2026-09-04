import { parseTranscript } from '../transcript/parse'
import { buildSentences } from '../transcript/sentences'
import { setProject, setError, setLoading } from './store'
import type { Project } from '../types'

const LIBRARY = 'demo/library.json'

/**
 * One entry in the shipped library. Everything here has to be redistributable —
 * the demo is served to strangers, so a video nobody licensed us to hand out
 * has no business in it.
 */
export interface LibraryEntry {
  id: string
  title: string
  speaker?: string
  video: string
  transcript: string
  attribution?: string
  durationSeconds?: number
}

function url(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`
}

export async function loadLibrary(): Promise<LibraryEntry[]> {
  try {
    const res = await fetch(url(LIBRARY))
    if (!res.ok) return []
    const parsed = (await res.json()) as { projects?: LibraryEntry[] }
    return Array.isArray(parsed.projects) ? parsed.projects : []
  } catch {
    // A missing library is not an error worth stopping for — the page still
    // opens on "bring your own video".
    return []
  }
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

/** Opens the first thing in the library, which is what the page starts on. */
export async function loadDemoProject(): Promise<void> {
  const library = await loadLibrary()
  if (!library.length) {
    setError(
      'No recordings are listed in public/demo/library.json, so there is nothing ' +
        'to open.'
    )
    return
  }
  await loadLibraryEntry(library[0])
}

export async function loadLibraryEntry(entry: LibraryEntry): Promise<void> {
  setLoading(true)
  try {
    const transcriptPath = 'demo/' + entry.transcript
    const res = await fetch(url(transcriptPath))
    if (!res.ok) throw new Error(`Could not load the transcript for ${entry.title} (${res.status}).`)
    const raw = await res.text()
    const meta = { ...entry }

    const { words } = parseTranscript(raw, transcriptPath)
    const sentences = buildSentences(words)
    const videoUrl = url('demo/' + entry.video)

    // The video is fetched at setup rather than committed, so a fresh checkout
    // that skipped it would otherwise load a transcript against a silent black
    // rectangle. Say what happened and what fixes it.
    const probe = await fetch(videoUrl, { method: 'HEAD' }).catch(() => null)
    if (!probe || !probe.ok) {
      throw new Error(
        'The transcript for "' + entry.title + '" loaded, but its video is not ' +
          'here. Videos are fetched rather than committed — run ' +
          '"npm run fetch:demo" to get them.'
      )
    }

    const project: Project = {
      name: meta.title ?? 'Demo project',
      videoUrl,
      videoLabel: `${meta.title ?? 'Demo'}${meta.speaker ? ` — ${meta.speaker}` : ''}`,
      attribution: meta.attribution,
      sentences,
      words,
      duration: meta.durationSeconds ?? (await videoDuration(videoUrl)),
    }
    setProject(project)
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err))
  }
}
