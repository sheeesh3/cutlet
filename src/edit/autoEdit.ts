import type { Sentence } from '../types'

/**
 * The page's own editing pass.
 *
 * WebMCP is one-directional — an agent can call into the page, but the page has
 * no way to call out to an agent. So a "find clips" button cannot summon one.
 * These heuristics are what the buttons run: they always work, including in a
 * browser with no agent at all, and they give the agent something concrete to
 * disagree with rather than a blank rail.
 *
 * They are lexical, not semantic. They know which words are unusual and where
 * the speaker paused. They do not know what any of it means — which is exactly
 * the gap the agent fills.
 */

const STOPWORDS = new Set(
  ('a about all also am an and any are as at be because been but by can could did do does ' +
    'for from get go had has have he her here him his how i if in into is it its just like ' +
    'make many me more most my no not now of on one only or other our out over own said say ' +
    'says she so some such than that the their them then there these they this those through ' +
    'to too up us very was we well were what when where which while who will with would you ' +
    'your they\'re we\'re it\'s that\'s don\'t doesn\'t i\'m will shall may might must been being ' +
    'having doing upon among between within without').split(' ')
)

/** Openers that only make sense if what came before is still there. */
const DEPENDENT_OPENERS = new Set(
  ('but and so then therefore thus however yet also because although though besides ' +
    'meanwhile otherwise instead that this these those they them it its their there ' +
    'he she his her him we our us').split(' ')
)

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
}

/** Crude singular/plural and tense folding, enough for overlap comparison. */
function fold(word: string): string {
  return word
    .replace(/(ies)$/, 'y')
    .replace(/(sses|ses|xes|zes|ches|shes)$/, '')
    .replace(/([^s])s$/, '$1')
    .replace(/(ing|ed)$/, '')
}

function bag(sentences: Sentence[], from: number, to: number): Map<string, number> {
  const out = new Map<string, number>()
  for (let i = Math.max(0, from); i < Math.min(sentences.length, to); i++) {
    for (const w of contentWords(sentences[i].text)) {
      const k = fold(w)
      out.set(k, (out.get(k) ?? 0) + 1)
    }
  }
  return out
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (const [, v] of a) na += v * v
  for (const [k, v] of b) {
    nb += v * v
    const av = a.get(k)
    if (av) dot += av * v
  }
  if (!na || !nb) return 0
  return dot / Math.sqrt(na * nb)
}

export interface Topic {
  startIndex: number
  endIndex: number
  title: string
  note: string
  keywords: string[]
}

export interface FindTopicsOptions {
  /** A topic shorter than this is not worth a card. */
  minSeconds?: number
  /** A topic longer than this gets split at its weakest internal seam. */
  maxSeconds?: number
  /** Sentences either side of a seam used to compare vocabulary. */
  window?: number
  maxTopics?: number
}

/**
 * Splits the transcript where the vocabulary turns over, in the manner of
 * TextTiling: compare the words either side of every sentence boundary and cut
 * where the overlap dips furthest below its neighbours. A long pause counts as
 * corroborating evidence, never on its own — oratory pauses mid-thought.
 */
export function findTopics(sentences: Sentence[], options: FindTopicsOptions = {}): Topic[] {
  const { minSeconds = 60, maxSeconds = 240, window = 3, maxTopics = 8 } = options
  if (sentences.length < 4) {
    return sentences.length
      ? [describeTopic(sentences, 0, sentences.length - 1)]
      : []
  }

  // Cohesion across every internal seam.
  const seams: { index: number; score: number }[] = []
  for (let i = 1; i < sentences.length; i++) {
    const before = bag(sentences, i - window, i)
    const after = bag(sentences, i, i + window)
    const overlap = cosine(before, after)
    const pause = sentences[i].start - sentences[i - 1].end
    // Low overlap is the signal; a pause nudges an already-weak seam.
    const score = overlap - Math.min(0.12, Math.max(0, pause) * 0.05)
    seams.push({ index: i, score })
  }

  const ordered = [...seams].sort((a, b) => a.score - b.score)
  const cuts: number[] = []
  const duration = (from: number, to: number) => sentences[to].end - sentences[from].start

  const wouldRespectMinimums = (candidate: number) => {
    const all = [0, ...cuts, candidate, sentences.length].sort((a, b) => a - b)
    for (let i = 0; i < all.length - 1; i++) {
      const from = all[i]
      const to = all[i + 1] - 1
      if (to < from) return false
      if (duration(from, to) < minSeconds) return false
    }
    return true
  }

  for (const seam of ordered) {
    if (cuts.length >= maxTopics - 1) break
    if (wouldRespectMinimums(seam.index)) cuts.push(seam.index)
  }
  cuts.sort((a, b) => a - b)

  // Anything still too long gets split again at its weakest internal seam,
  // even if that leaves a shorter piece than the minimum — an eight-minute
  // "topic" is not a topic.
  let bounds = [0, ...cuts, sentences.length]
  for (let guard = 0; guard < 6; guard++) {
    let split = false
    const next: number[] = [bounds[0]]
    for (let i = 0; i < bounds.length - 1; i++) {
      const from = bounds[i]
      const to = bounds[i + 1] - 1
      if (duration(from, to) > maxSeconds && to - from >= 3) {
        const inner = seams
          .filter((s) => s.index > from + 1 && s.index < to)
          .sort((a, b) => a.score - b.score)[0]
        if (inner) {
          next.push(inner.index)
          split = true
        }
      }
      next.push(bounds[i + 1])
    }
    bounds = [...new Set(next)].sort((a, b) => a - b)
    if (!split) break
  }

  const topics: Topic[] = []
  for (let i = 0; i < bounds.length - 1; i++) {
    const from = bounds[i]
    const to = bounds[i + 1] - 1
    if (to >= from) topics.push(describeTopic(sentences, from, to))
  }
  return topics
}

/** Inverse document frequency over the whole transcript, for distinctiveness. */
function idf(sentences: Sentence[]): Map<string, number> {
  const df = new Map<string, number>()
  for (const s of sentences) {
    for (const w of new Set(contentWords(s.text).map(fold))) {
      df.set(w, (df.get(w) ?? 0) + 1)
    }
  }
  const out = new Map<string, number>()
  for (const [w, n] of df) out.set(w, Math.log(sentences.length / (1 + n)) + 1)
  return out
}

function describeTopic(sentences: Sentence[], from: number, to: number): Topic {
  const weights = idf(sentences)
  const counts = new Map<string, number>()
  for (let i = from; i <= to; i++) {
    for (const w of contentWords(sentences[i].text)) {
      const k = fold(w)
      counts.set(k, (counts.get(k) ?? 0) + (weights.get(k) ?? 1))
    }
  }
  const keywords = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([w]) => w)

  // The sentence that carries the most of the topic's own weight. Its most
  // characteristic phrase becomes the title.
  let best = from
  let bestScore = -1
  for (let i = from; i <= to; i++) {
    const words = contentWords(sentences[i].text).map(fold)
    if (!words.length) continue
    const score = words.reduce((t, w) => t + (weights.get(w) ?? 0), 0) / Math.sqrt(words.length)
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  }

  const seconds = Math.round(sentences[to].end - sentences[from].start)
  return {
    startIndex: from,
    endIndex: to,
    title: titleFrom(sentences[best].text, counts),
    note:
      'Runs ' +
      formatShort(seconds) +
      ' across ' +
      (to - from + 1) +
      ' sentences. Recurring: ' +
      keywords.slice(0, 3).join(', ') +
      '.',
    keywords,
  }
}

/**
 * Titles a topic with its most characteristic phrase, taken from the strongest
 * sentence but not from that sentence's opening — openings are where the
 * throat-clearing lives ("I do not say that we", "We have seen the site
 * where"), while the words that identify a topic sit further in.
 *
 * Scored on the topic's own weighted counts rather than global rarity. Global
 * rarity would mark down the phrase a speaker repeats, and the phrase a speaker
 * repeats is usually the point — "we choose to go to the moon" is said three
 * times here, and is the last thing a title should discard.
 */
function titleFrom(text: string, weights: Map<string, number>): string {
  const words = text.replace(/[^\w\s'-]/g, '').split(/\s+/).filter(Boolean)
  if (!words.length) return 'Untitled topic'

  const SPAN = 6
  if (words.length <= SPAN) return sentenceCase(words.join(' '))

  const weightAt = (i: number) => {
    const w = words[i].toLowerCase()
    if (STOPWORDS.has(w) || w.length <= 2) return 0
    return weights.get(fold(w)) ?? 0
  }

  let bestStart = 0
  let bestScore = -1
  for (let i = 0; i + SPAN <= words.length; i++) {
    let score = 0
    for (let k = i; k < i + SPAN; k++) score += weightAt(k)
    // Starting on a stopword reads like a fragment cut from the middle, which
    // it is; nudge the window to open on something that carries meaning.
    if (weightAt(i) === 0) score *= 0.7
    if (score > bestScore) {
      bestScore = score
      bestStart = i
    }
  }

  // Trim a trailing stopword so the title does not end on "of" or "the".
  let end = bestStart + SPAN
  while (end - 1 > bestStart && weightAt(end - 1) === 0) end--

  return sentenceCase(words.slice(bestStart, end).join(' '))
}

function sentenceCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Untitled topic'
}

function formatShort(seconds: number): string {
  if (seconds < 60) return seconds + 's'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s === 0 ? m + 'm' : m + 'm ' + s + 's'
}

export interface CutOptions {
  minSeconds?: number
  maxSeconds?: number
}

export interface CutResult {
  keptIndices: number[]
  seconds: number
  droppedCount: number
}

/**
 * Reduces a topic to something postable.
 *
 * Scores every sentence on how distinctive its vocabulary is, then grows a
 * selection greedily from the strongest one, favouring sentences next to
 * something already kept. Two sentences in a row almost always play better than
 * two good sentences with a hole between them, and a sentence that opens on
 * "but" or "they" is nonsense once its antecedent has been cut — so both are
 * priced in rather than left to chance.
 */
export function cutToDuration(
  sentences: Sentence[],
  candidateIndices: number[],
  options: CutOptions = {}
): CutResult {
  const { minSeconds = 30, maxSeconds = 60 } = options
  const pool = [...candidateIndices].sort((a, b) => a - b)
  const lengthOf = (i: number) => Math.max(0.1, sentences[i].end - sentences[i].start)

  const total = pool.reduce((t, i) => t + lengthOf(i), 0)
  if (total <= maxSeconds) {
    return { keptIndices: pool, seconds: total, droppedCount: 0 }
  }

  const weights = idf(sentences)
  const baseScore = new Map<number, number>()
  for (const i of pool) {
    const words = contentWords(sentences[i].text).map(fold)
    const distinct = words.reduce((t, w) => t + (weights.get(w) ?? 0), 0)
    // Per-second, so a long rambling sentence does not win on bulk alone.
    baseScore.set(i, words.length ? distinct / Math.sqrt(lengthOf(i)) : 0)
  }

  const kept = new Set<number>()
  let seconds = 0

  const seed = pool.reduce((best, i) =>
    (baseScore.get(i) ?? 0) > (baseScore.get(best) ?? 0) ? i : best
  , pool[0])
  kept.add(seed)
  seconds += lengthOf(seed)

  while (seconds < minSeconds || seconds < maxSeconds) {
    let choice = -1
    let choiceScore = -Infinity

    for (const i of pool) {
      if (kept.has(i)) continue
      if (seconds + lengthOf(i) > maxSeconds) continue

      let score = baseScore.get(i) ?? 0
      // Adjacency bonus: keeping a run reads better than keeping fragments.
      if (kept.has(i - 1) || kept.has(i + 1)) score *= 1.6
      // A sentence whose opener refers backwards is worth much less if the
      // thing it refers to is not being kept.
      const opener = sentences[i].text.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z']/g, '')
      if (opener && DEPENDENT_OPENERS.has(opener) && !kept.has(i - 1)) score *= 0.45
      if (score > choiceScore) {
        choiceScore = score
        choice = i
      }
    }

    if (choice < 0) break
    kept.add(choice)
    seconds += lengthOf(choice)
    if (seconds >= minSeconds && choiceScore <= 0) break
  }

  const keptIndices = [...kept].sort((a, b) => a - b)
  return {
    keptIndices,
    seconds,
    droppedCount: pool.length - keptIndices.length,
  }
}
