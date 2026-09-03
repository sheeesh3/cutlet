import { getState, sentenceById, clipBounds } from './store'

/**
 * Imperative handle on the single <video>. Kept outside React because the
 * WebMCP tools are plain functions — they must be able to drive playback
 * without pretending to be a component.
 */
let el: HTMLVideoElement | null = null
let rangeEnd: number | null = null
let rafId: number | null = null

const timeListeners = new Set<(t: number) => void>()

export function attachVideo(node: HTMLVideoElement | null) {
  el = node
  if (!node) stopWatching()
}

export function getVideo(): HTMLVideoElement | null {
  return el
}

export function onTimeUpdate(fn: (t: number) => void): () => void {
  timeListeners.add(fn)
  return () => {
    timeListeners.delete(fn)
  }
}

/**
 * rAF rather than the `timeupdate` event: `timeupdate` fires about four times a
 * second, which is a visible overshoot at a clip boundary.
 */
function watch() {
  if (rafId !== null) return
  const tick = () => {
    rafId = null
    if (!el) return
    const t = el.currentTime
    for (const fn of timeListeners) fn(t)
    if (rangeEnd !== null && t >= rangeEnd) {
      el.pause()
      el.currentTime = rangeEnd
      rangeEnd = null
      for (const fn of timeListeners) fn(el.currentTime)
      return
    }
    if (!el.paused) rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)
}

function stopWatching() {
  if (rafId !== null) cancelAnimationFrame(rafId)
  rafId = null
  rangeEnd = null
}

export function seek(time: number) {
  if (!el) return
  rangeEnd = null
  el.currentTime = Math.max(0, time)
  for (const fn of timeListeners) fn(el.currentTime)
}

export function pause() {
  rangeEnd = null
  el?.pause()
}

export async function playRange(start: number, end: number) {
  if (!el) return
  rangeEnd = end
  el.currentTime = Math.max(0, start)
  try {
    await el.play()
    watch()
  } catch {
    // Autoplay can be refused before the first user gesture. Leaving the
    // playhead parked at `start` is the honest outcome — the frame is right,
    // the user presses play.
    rangeEnd = null
  }
}

export function playFrom(time: number) {
  if (!el) return
  rangeEnd = null
  el.currentTime = Math.max(0, time)
  void el.play().catch(() => {})
  watch()
}

export function toggle() {
  if (!el) return
  if (el.paused) {
    void el.play().catch(() => {})
    watch()
  } else {
    el.pause()
  }
}

export function playClip(clipId: string): boolean {
  const clip = getState().clips.find((c) => c.id === clipId)
  if (!clip) return false
  const { start, end } = clipBounds(clip)
  void playRange(start, end)
  return true
}

export function playSentenceRange(startId: string, endId: string): boolean {
  const a = sentenceById(startId)
  const b = sentenceById(endId)
  if (!a || !b) return false
  void playRange(Math.min(a.start, b.start), Math.max(a.end, b.end))
  return true
}
