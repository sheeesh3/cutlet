import type { Sentence, Word } from '../types'

/** Words that end in a period but almost never end a sentence. */
const ABBREVIATIONS = new Set([
  'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'sr.', 'jr.', 'st.', 'mt.',
  'vs.', 'etc.', 'inc.', 'ltd.', 'co.', 'no.', 'fig.', 'approx.',
  'jan.', 'feb.', 'mar.', 'apr.', 'jun.', 'jul.', 'aug.', 'sep.', 'sept.',
  'oct.', 'nov.', 'dec.',
])

/** A single capital letter followed by a period is an initial: "John F. Kennedy". */
const INITIAL = /^[A-Z]\.$/

const TERMINAL = /[.!?]["')\]]?$/

export interface SentenceOptions {
  /**
   * A silence at least this long can end a sentence without punctuation — but
   * only once the run is already `pauseMinWords` long. Oratory is full of
   * rhetorical pauses mid-clause; splitting on those shreds real sentences into
   * fragments, and a fragment makes a bad clip boundary.
   */
  pauseSeconds?: number
  pauseMinWords?: number
  /**
   * Hard ceiling, so a transcript with no punctuation at all still yields
   * editable units. Set high on purpose: when punctuation is present it should
   * decide every boundary, and the ceiling should never fire.
   */
  maxWords?: number
  /** Never split below this, so "Yes." does not become its own row. */
  minWords?: number
}

export function buildSentences(words: Word[], options: SentenceOptions = {}): Sentence[] {
  const {
    pauseSeconds = 1.4,
    pauseMinWords = 14,
    maxWords = 70,
    minWords = 4,
  } = options
  const sentences: Sentence[] = []
  let current: Word[] = []

  const flush = () => {
    if (!current.length) return
    const index = sentences.length
    sentences.push({
      id: sentenceId(index),
      index,
      text: current
        .map((w) => w.text)
        .join(' ')
        .replace(/\s+([,.!?;:])/g, '$1')
        // ASR emits "C -1" and "48 -story" as separate tokens; rejoin them so a
        // clip's text reads like something a person wrote.
        .replace(/\s+-(?=\w)/g, '-'),
      start: current[0].start,
      end: current[current.length - 1].end,
    })
    current = []
  }

  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    current.push(word)
    const next = words[i + 1]
    if (!next) break

    if (current.length >= maxWords) {
      // Back off to the last clause boundary so the ceiling lands between
      // phrases. Cutting at exactly the 46th word reliably lands mid-phrase
      // ("...as tall as" / "a 48-story structure"), which is the one thing a
      // sentence boundary must never do here — it becomes a clip edge.
      let cut = current.length
      for (let k = current.length - 2; k >= Math.max(minWords, current.length - 18); k--) {
        if (/[,;:]$/.test(current[k].text)) {
          cut = k + 1
          break
        }
      }
      const carry = current.slice(cut)
      current = current.slice(0, cut)
      flush()
      current = carry
      continue
    }
    if (current.length < minWords) continue

    if (endsSentence(word.text)) {
      flush()
      continue
    }

    const gap = next.start - word.end
    // A pause only counts at a clause boundary, and only once the run is long
    // enough that splitting it yields two usable units rather than a fragment.
    if (gap >= pauseSeconds && current.length >= pauseMinWords && /[,;:]$/.test(word.text)) {
      flush()
    }
  }
  flush()

  return sentences
}

function endsSentence(text: string): boolean {
  if (!TERMINAL.test(text)) return false
  const lower = text.toLowerCase()
  if (ABBREVIATIONS.has(lower)) return false
  if (INITIAL.test(text)) return false
  return true
}

/**
 * Ids are positional and zero-padded so they sort lexicographically and read
 * cleanly in an agent transcript: s0001, s0002, ... They are stable for a given
 * transcript, which is the whole contract behind range-based editing.
 */
export function sentenceId(index: number): string {
  return `s${String(index + 1).padStart(4, '0')}`
}

export function indexOfSentenceId(id: string): number {
  const n = Number(id.replace(/^s/, ''))
  return Number.isFinite(n) ? n - 1 : -1
}

export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export function formatDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds))
  if (rounded < 60) return `${rounded}s`
  const m = Math.floor(rounded / 60)
  const s = rounded % 60
  return s === 0 ? `${m}m` : `${m}m ${s}s`
}
