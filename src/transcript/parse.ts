import type { Word } from '../types'

/**
 * ClipClub accepts three transcript shapes. Word-level JSON is the primary
 * target — it is what gives sentence boundaries their accuracy. SRT and VTT are
 * accepted so an existing subtitle file is never a reason you cannot open a
 * video, but their timings are cue-level, so a "sentence" from them is really a
 * cue.
 */
export type TranscriptSource = 'words-json' | 'srt' | 'vtt' | 'segments-json'

export interface ParsedTranscript {
  words: Word[]
  source: TranscriptSource
  /** Set when the source only had cue-level timing, not word-level. */
  coarse: boolean
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

export function parseTranscript(raw: string, filename = ''): ParsedTranscript {
  const trimmed = raw.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return parseJson(JSON.parse(trimmed))
  }
  if (/^WEBVTT/i.test(trimmed) || filename.toLowerCase().endsWith('.vtt')) {
    return { words: parseCues(trimmed, true), source: 'vtt', coarse: true }
  }
  return { words: parseCues(trimmed, false), source: 'srt', coarse: true }
}

/**
 * Handles the shapes that actually show up in the wild: a bare word array, a
 * Whisper `{ segments: [{ words: [...] }] }` result, a Deepgram
 * `results.channels[0].alternatives[0].words`, and a segments-only file.
 */
function parseJson(data: unknown): ParsedTranscript {
  const words = collectWords(data)
  if (words.length) return { words, source: 'words-json', coarse: false }

  const segments = collectSegments(data)
  if (segments.length) return { words: segments, source: 'segments-json', coarse: true }

  throw new Error(
    'Could not find word or segment timings in that JSON. Expected an array of ' +
      '{ word|text, start, end }, or a Whisper/Deepgram result object.'
  )
}

function toNumber(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : (v as number)
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function asWord(o: Record<string, unknown>): Word | null {
  const text = o.word ?? o.text ?? o.punctuated_word ?? o.value
  const start = toNumber(o.start ?? o.startTime ?? o.from ?? o.s)
  const end = toNumber(o.end ?? o.endTime ?? o.to ?? o.e)
  if (typeof text !== 'string' || start === null || end === null) return null
  const t = clean(text)
  if (!t) return null
  return { text: t, start, end: Math.max(end, start) }
}

/** Walks the object graph looking for the deepest array that parses as words. */
function collectWords(data: unknown): Word[] {
  const out: Word[] = []
  const visit = (node: unknown, key?: string) => {
    if (Array.isArray(node)) {
      const parsed = node
        .map((x) => (x && typeof x === 'object' ? asWord(x as Record<string, unknown>) : null))
        .filter((x): x is Word => x !== null)
      // A `words` key is authoritative. Any other array only counts if every
      // entry parsed — otherwise we are looking at segments, not words.
      if (parsed.length && (key === 'words' || parsed.length === node.length)) {
        out.push(...parsed)
        return
      }
      node.forEach((x) => visit(x))
      return
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) visit(v, k)
    }
  }
  visit(data)
  out.sort((a, b) => a.start - b.start)
  return out
}

/** Fallback: treat each segment's text as one long "word". */
function collectSegments(data: unknown): Word[] {
  const out: Word[] = []
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const x of node) {
        if (x && typeof x === 'object') {
          const o = x as Record<string, unknown>
          const text = o.text ?? o.transcript ?? o.sentence
          const start = toNumber(o.start ?? o.startTime)
          const end = toNumber(o.end ?? o.endTime)
          if (typeof text === 'string' && start !== null && end !== null) {
            const t = clean(text)
            if (t) out.push({ text: t, start, end: Math.max(end, start) })
            continue
          }
        }
        visit(x)
      }
      return
    }
    if (node && typeof node === 'object') Object.values(node).forEach(visit)
  }
  visit(data)
  out.sort((a, b) => a.start - b.start)
  return out
}

const TIME = /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})|(\d{1,2}):(\d{2})[.,](\d{1,3})/

function parseTimestamp(s: string): number | null {
  const m = TIME.exec(s)
  if (!m) return null
  if (m[1] !== undefined) {
    return (
      Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000
    )
  }
  return Number(m[5]) * 60 + Number(m[6]) + Number(m[7].padEnd(3, '0')) / 1000
}

/** Shared SRT/VTT cue reader — the two formats differ only in decoration. */
function parseCues(raw: string, vtt: boolean): Word[] {
  const out: Word[] = []
  const blocks = raw.replace(/\r/g, '').split(/\n{2,}/)
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim())
    if (!lines.length) continue
    if (vtt && /^WEBVTT/i.test(lines[0])) continue
    const arrowLine = lines.findIndex((l) => l.includes('-->'))
    if (arrowLine === -1) continue
    const [left, right] = lines[arrowLine].split('-->')
    const start = parseTimestamp(left)
    const end = parseTimestamp(right ?? '')
    if (start === null || end === null) continue
    const text = clean(
      lines
        .slice(arrowLine + 1)
        .join(' ')
        .replace(/<[^>]+>/g, '')
    )
    if (text) out.push({ text, start, end: Math.max(end, start) })
  }
  out.sort((a, b) => a.start - b.start)
  return out
}
