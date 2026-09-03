import type { Sentence } from '../types'

function srtTime(seconds: number): string {
  const s = Math.max(0, seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const ms = Math.round((s - Math.floor(s)) * 1000)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(h)}:${p(m)}:${p(sec)},${p(ms, 3)}`
}

/**
 * Builds an .srt for the exported clip with every cue rebased so the file
 * starts at zero. A subtitle file that still carries the source's timecodes is
 * useless the moment the video is trimmed.
 */
export function buildSrt(sentences: Sentence[], clipStart: number): string {
  return sentences
    .map((s, i) => {
      const start = Math.max(0, s.start - clipStart)
      const end = Math.max(start + 0.2, s.end - clipStart)
      return `${i + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${s.text}\n`
    })
    .join('\n')
}
