import type { Range, Sentence } from '../types'

function srtTime(seconds: number): string {
  const s = Math.max(0, seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const ms = Math.round((s - Math.floor(s)) * 1000)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return p(h) + ':' + p(m) + ':' + p(sec) + ',' + p(ms, 3)
}

/**
 * Builds an .srt for an exported cut.
 *
 * A cut is several pieces of the source joined together, so a sentence's
 * subtitle time is its offset inside its own piece plus the total length of
 * every piece before it. Carrying the source's timecodes over, or rebasing only
 * against the first piece, puts every cue after the first cut out of sync.
 */
export function buildSrt(sentences: Sentence[], ranges: Range[]): string {
  const cues: { start: number; end: number; text: string }[] = []
  let elapsed = 0

  for (const range of ranges) {
    const length = Math.max(0, range.end - range.start)
    for (const s of sentences) {
      // A sentence belongs to this piece if it overlaps it at all; clamp so a
      // sentence clipped by a cut still gets a cue that stays inside the piece.
      if (s.end <= range.start || s.start >= range.end) continue
      const start = elapsed + Math.max(0, s.start - range.start)
      const end = elapsed + Math.min(length, s.end - range.start)
      if (end - start < 0.05) continue
      cues.push({ start, end, text: s.text })
    }
    elapsed += length
  }

  cues.sort((a, b) => a.start - b.start)

  return cues
    .map((c, i) => i + 1 + '\n' + srtTime(c.start) + ' --> ' + srtTime(c.end) + '\n' + c.text + '\n')
    .join('\n')
}
