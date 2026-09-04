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
  /**
   * Floor on a sentence, to stop a stray token becoming its own row. Kept low:
   * merging two real sentences because one is short is a worse failure than a
   * short row, and short sentences are often the best clip anchors.
   */
  minWords?: number
}

/**
 * Renders a run of words the way a person would write it, and records which
 * word each character came from.
 *
 * The mapping is the point: splitting a sentence from a mouse selection means
 * turning a character offset back into a word, and interpolating across the
 * sentence's duration would put the cut in the middle of a word. This is built
 * a word at a time rather than by regex over the joined string precisely so
 * that offsets stay exact — ASR emits "C -1" and "48 -story" as two tokens, and
 * closing those gaps shifts every character after them.
 */
export function renderWords(words: Word[]): { text: string; charToWord: number[] } {
  let text = ''
  const charToWord: number[] = []
  words.forEach((word, i) => {
    if (i > 0 && !/^[,.!?;:]/.test(word.text) && !/^-\w/.test(word.text)) {
      charToWord.push(i)
      text += ' '
    }
    for (let c = 0; c < word.text.length; c++) charToWord.push(i)
    text += word.text
  })
  return { text, charToWord }
}

export function buildSentences(words: Word[], options: SentenceOptions = {}): Sentence[] {
  const {
    pauseSeconds = 1.4,
    pauseMinWords = 14,
    maxWords = 70,
    minWords = 2,
  } = options
  const sentences: Sentence[] = []
  let current: Word[] = []

  let consumed = 0
  const flush = () => {
    if (!current.length) return
    const index = sentences.length
    sentences.push({
      id: sentenceId(index),
      index,
      text: renderWords(current).text,
      start: current[0].start,
      end: current[current.length - 1].end,
      wordStart: consumed,
      wordEnd: consumed + current.length - 1,
    })
    consumed += current.length
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

  // Registering here keeps the id lookup correct for anything that builds a
  // transcript without going through the store — the tests, mainly.
  registerSentences(sentences)
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
 * Ids are zero-padded so they read cleanly in an agent transcript: s0001,
 * s0002, ... At build time they are positional, but they stop being positional
 * the moment a sentence is split — the new half is appended to the id space and
 * inserted into the middle of the list.
 *
 * That is deliberate. An id has to keep meaning the same thing for as long as
 * the agent might be holding it, and renumbering on a split would silently
 * repoint every id after the split at its neighbour. A stale id that resolves
 * to the wrong sentence is far worse than one that fails to resolve.
 */
export function sentenceId(index: number): string {
  return `s${String(index + 1).padStart(4, '0')}`
}

/** An id not already taken, for the second half of a split. */
export function nextSentenceId(list: Sentence[]): string {
  let highest = 0
  for (const s of list) {
    const n = Number(s.id.replace(/^s/, ''))
    if (Number.isFinite(n) && n > highest) highest = n
  }
  return `s${String(highest + 1).padStart(4, '0')}`
}

/**
 * id -> position, maintained rather than computed. Positional arithmetic cannot
 * survive an insertion, and splitting a sentence is an insertion.
 */
let positions = new Map<string, number>()

export function registerSentences(list: Sentence[]): void {
  positions = new Map(list.map((s, i) => [s.id, i]))
}

export function indexOfSentenceId(id: string): number {
  const at = positions.get(id)
  if (at !== undefined) return at
  // Nothing registered yet — fall back to reading the id positionally, which is
  // how they are handed out before anything has been split.
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
