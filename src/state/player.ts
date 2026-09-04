import { getState, sentenceById, clipRanges } from './store'
import type { Range } from '../types'

/**
 * Imperative handle on the single <video>. Kept outside React because the
 * WebMCP tools are plain functions — they must be able to drive playback
 * without pretending to be a component.
 */
let el: HTMLVideoElement | null = null

/**
 * A cut is a list of kept pieces with the weak parts dropped out of the middle,
 * so playback is a queue of ranges rather than one span: at the end of a piece
 * the playhead jumps to the start of the next.
 */
let queue: Range[] = []
let queueIndex = 0
let rafId: number | null = null

const timeListeners = new Set<(t: number) => void>()
const queueListeners = new Set<(index: number, total: number) => void>()

export function attachVideo(node: HTMLVideoElement | null) {
  if (el) el.removeEventListener('timeupdate', onNativeTimeUpdate)
  el = node
  if (!node) {
    stopWatching()
    return
  }
  // A second, independent boundary check. The rAF loop below is what gives the
  // edit its precision, but requestAnimationFrame does not run in a hidden tab —
  // and a backgrounded clip that keeps playing straight through the sentences it
  // just cut is still audible. `timeupdate` keeps firing when hidden, roughly
  // four times a second, which is coarse but honest.
  node.addEventListener('timeupdate', onNativeTimeUpdate)
}

function onNativeTimeUpdate() {
  if (!el) return
  announceTime(el.currentTime)
  advanceIfPastBoundary(el.currentTime)
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

/** Fires as playback moves from one piece of a cut to the next. */
export function onQueueChange(fn: (index: number, total: number) => void): () => void {
  queueListeners.add(fn)
  return () => {
    queueListeners.delete(fn)
  }
}

function announceQueue() {
  for (const fn of queueListeners) fn(queueIndex, queue.length)
}

function announceTime(t: number) {
  for (const fn of timeListeners) fn(t)
}

/**
 * rAF rather than the `timeupdate` event: `timeupdate` fires about four times a
 * second, which is a visible overshoot at a clip boundary — and across a cut it
 * would let a dropped sentence be heard before the jump lands.
 */
/**
 * The single place a boundary is enforced, so the rAF loop and the `timeupdate`
 * listener cannot disagree about what happens at the end of a piece.
 * Returns true when the queue finished.
 */
function advanceIfPastBoundary(t: number): boolean {
  if (!el) return false
  const current = queue[queueIndex]
  if (!current || t < current.end) return false

  const next = queue[queueIndex + 1]
  if (next) {
    queueIndex++
    el.currentTime = next.start
    announceQueue()
    announceTime(el.currentTime)
    return false
  }

  el.pause()
  el.currentTime = current.end
  queue = []
  queueIndex = 0
  announceQueue()
  announceTime(el.currentTime)
  return true
}

function watch() {
  if (rafId !== null) return
  const tick = () => {
    rafId = null
    if (!el) return
    const t = el.currentTime
    announceTime(t)
    if (advanceIfPastBoundary(t)) return
    if (!el.paused) rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)
}

function stopWatching() {
  if (rafId !== null) cancelAnimationFrame(rafId)
  rafId = null
  queue = []
  queueIndex = 0
}

export function seek(time: number) {
  if (!el) return
  queue = []
  queueIndex = 0
  el.currentTime = Math.max(0, time)
  announceTime(el.currentTime)
}

export function pause() {
  queue = []
  queueIndex = 0
  el?.pause()
}

/** Plays a list of ranges back to back, jumping the gaps between them. */
export async function playRanges(ranges: Range[]) {
  if (!el || !ranges.length) return
  queue = ranges
  queueIndex = 0
  el.currentTime = Math.max(0, ranges[0].start)
  announceQueue()
  try {
    await el.play()
    watch()
  } catch {
    // Autoplay can be refused before the first user gesture. Leaving the
    // playhead parked at the in-point is the honest outcome — the frame is
    // right, the user presses play.
    queue = []
    queueIndex = 0
    announceQueue()
  }
}

export async function playRange(start: number, end: number) {
  await playRanges([{ start, end }])
}

export function playFrom(time: number) {
  if (!el) return
  queue = []
  queueIndex = 0
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
  const ranges = clipRanges(clip)
  if (!ranges.length) return false
  void playRanges(ranges)
  return true
}

export function playSentenceRange(startId: string, endId: string): boolean {
  const a = sentenceById(startId)
  const b = sentenceById(endId)
  if (!a || !b) return false
  void playRange(Math.min(a.start, b.start), Math.max(a.end, b.end))
  return true
}

/** Which piece of the active cut is playing, for the UI. */
export function currentQueuePosition(): { index: number; total: number } {
  return { index: queueIndex, total: queue.length }
}
