import { useSyncExternalStore } from 'react'
import type { Actor, Clip, ClipKind, Project, Range, Segment, Sentence } from '../types.ts'
import { indexOfSentenceId } from '../transcript/sentences.ts'

export interface ToolEvent {
  id: number
  tool: string
  summary: string
  at: number
  ok: boolean
}

export interface Selection {
  startSentenceId: string
  endSentenceId: string
}

export interface EditorState {
  project: Project | null
  loading: boolean
  error: string | null
  clips: Clip[]
  activeClipId: string | null
  /** The human's anchor: the sentence they said has to survive. Theirs alone. */
  selection: Selection | null
  /**
   * Ranges banked by cmd-clicking, so a human can assemble a clip out of moments
   * that are nowhere near each other — the same collection-of-ranges shape the
   * agent can already produce. `selection` is the range currently being worked
   * on; `marks` are the ones already put aside.
   */
  marks: Segment[]
  /**
   * A range the agent is auditioning. Deliberately separate from `selection` —
   * an agent trying out a range must not be able to overwrite the mark the
   * human made, because that mark is the brief.
   */
  audition: Selection | null
  /** Bumped on every mutation. Lets an agent detect that the world moved. */
  revision: number
  toolEvents: ToolEvent[]
  mcpConnected: boolean
  exporting: { clipId: string; stage: string; progress: number } | null
  /** Set while the local heuristic pass is running, so buttons can show it. */
  working: string | null
}

const initial: EditorState = {
  project: null,
  loading: true,
  error: null,
  clips: [],
  activeClipId: null,
  selection: null,
  marks: [],
  audition: null,
  revision: 0,
  toolEvents: [],
  mcpConnected: false,
  exporting: null,
  working: null,
}

let state: EditorState = initial
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function set(patch: Partial<EditorState> | ((s: EditorState) => Partial<EditorState>)) {
  const next = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...next }
  emit()
}

/** Every mutation goes through here so `revision` can never drift. */
function mutate(patch: Partial<EditorState> | ((s: EditorState) => Partial<EditorState>)) {
  const next = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...next, revision: state.revision + 1 }
  emit()
}

export function getState(): EditorState {
  return state
}

export function useStore<T>(selector: (s: EditorState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(initial)
  )
}

// ---------------------------------------------------------------- project

export function setProject(project: Project) {
  set({ project, loading: false, error: null })
}

export function setLoading(loading: boolean) {
  set({ loading })
}

export function setError(error: string | null) {
  set({ error, loading: false })
}

export function setMcpConnected(mcpConnected: boolean) {
  set({ mcpConnected })
}

export function setExporting(exporting: EditorState['exporting']) {
  set({ exporting })
}

export function setWorking(working: string | null) {
  set({ working })
}

// -------------------------------------------------------------- sentences

export function sentences(): Sentence[] {
  return state.project?.sentences ?? []
}

export function sentenceById(id: string): Sentence | undefined {
  const i = indexOfSentenceId(id)
  const list = sentences()
  return i >= 0 && i < list.length ? list[i] : undefined
}

/** Normalises a pair of ids into an ordered, in-bounds range. */
export function resolveRange(
  startSentenceId: string,
  endSentenceId: string
): { start: Sentence; end: Sentence } | { error: string } {
  const list = sentences()
  if (!list.length) return { error: 'No transcript is loaded.' }
  const a = indexOfSentenceId(startSentenceId)
  const b = indexOfSentenceId(endSentenceId)
  if (a < 0 || a >= list.length) return { error: unknownId(startSentenceId) }
  if (b < 0 || b >= list.length) return { error: unknownId(endSentenceId) }
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  return { start: list[lo], end: list[hi] }
}

function unknownId(id: string): string {
  const list = sentences()
  const range = list.length ? ' Ids run ' + list[0].id + '-' + list[list.length - 1].id + '.' : ''
  return 'Unknown sentence id "' + id + '".' + range
}

// ------------------------------------------------------------------ clips

/**
 * Turns a clip's sentence ranges into playable second-ranges, with padding
 * applied. Padding can push neighbouring segments into each other, so anything
 * that now touches is merged — otherwise playback would seek backwards
 * mid-clip and the export would repeat a moment.
 */
export function clipRanges(clip: Clip): Range[] {
  const duration = state.project?.duration ?? Number.POSITIVE_INFINITY
  const raw: Range[] = []

  for (const seg of clip.segments) {
    const r = resolveRange(seg.startSentenceId, seg.endSentenceId)
    if ('error' in r) continue
    raw.push({
      start: Math.max(0, r.start.start - clip.pad),
      end: Math.min(duration, r.end.end + clip.pad),
    })
  }

  raw.sort((a, b) => a.start - b.start)
  const merged: Range[] = []
  for (const range of raw) {
    const last = merged[merged.length - 1]
    if (last && range.start <= last.end + 0.001) last.end = Math.max(last.end, range.end)
    else merged.push({ ...range })
  }
  return merged
}

/** Sentence indices a clip keeps, in play order. */
export function clipSentenceIndices(clip: Clip): number[] {
  const out: number[] = []
  for (const seg of clip.segments) {
    const r = resolveRange(seg.startSentenceId, seg.endSentenceId)
    if ('error' in r) continue
    for (let i = r.start.index; i <= r.end.index; i++) out.push(i)
  }
  return out
}

/** The span from first kept sentence to last, including what was dropped. */
export function clipSpan(clip: Clip): Range {
  const ranges = clipRanges(clip)
  if (!ranges.length) return { start: 0, end: 0 }
  return { start: ranges[0].start, end: ranges[ranges.length - 1].end }
}

/** Playing time — the sum of the kept pieces, not the span they sit in. */
export function clipDuration(clip: Clip): number {
  return clipRanges(clip).reduce((total, r) => total + Math.max(0, r.end - r.start), 0)
}

export function clipText(clip: Clip): string {
  const list = sentences()
  return clipSentenceIndices(clip)
    .map((i) => list[i]?.text ?? '')
    .filter(Boolean)
    .join(' ')
}

/** How many sentences the cut dropped out of its own span. */
export function clipDropped(clip: Clip): number {
  const kept = clipSentenceIndices(clip)
  if (kept.length < 2) return 0
  const span = kept[kept.length - 1] - kept[0] + 1
  return span - kept.length
}

/** Ordered, in-bounds, non-overlapping; touching runs joined. */
function normaliseSegments(segments: Segment[]): Segment[] | { error: string } {
  const list = sentences()
  const spans: { a: number; b: number }[] = []
  for (const seg of segments) {
    const r = resolveRange(seg.startSentenceId, seg.endSentenceId)
    if ('error' in r) return r
    spans.push({ a: r.start.index, b: r.end.index })
  }
  if (!spans.length) return { error: 'A clip needs at least one range of sentences.' }

  spans.sort((x, y) => x.a - y.a)
  const merged: { a: number; b: number }[] = []
  for (const span of spans) {
    const last = merged[merged.length - 1]
    // Touching or overlapping runs become one. A gap of even a single dropped
    // sentence is a real cut, and stays a gap.
    if (last && span.a <= last.b + 1) last.b = Math.max(last.b, span.b)
    else merged.push({ ...span })
  }
  return merged.map((m) => ({
    startSentenceId: list[m.a].id,
    endSentenceId: list[m.b].id,
  }))
}

/** Collapses a set of sentence indices into contiguous runs. */
export function segmentsFromIndices(indices: number[]): Segment[] {
  const list = sentences()
  const sorted = [...new Set(indices)].filter((i) => i >= 0 && i < list.length).sort((a, b) => a - b)
  const out: Segment[] = []
  let runStart = -1
  let previous = -2
  for (const i of sorted) {
    if (i !== previous + 1) {
      if (runStart >= 0) {
        out.push({ startSentenceId: list[runStart].id, endSentenceId: list[previous].id })
      }
      runStart = i
    }
    previous = i
  }
  if (runStart >= 0) {
    out.push({ startSentenceId: list[runStart].id, endSentenceId: list[previous].id })
  }
  return out
}

let clipCounter = 0

export function createClip(input: {
  segments: Segment[]
  kind?: ClipKind
  title?: string
  note?: string
  pad?: number
  sourceClipId?: string
  by: Actor
}): Clip | { error: string } {
  const segments = normaliseSegments(input.segments)
  if ('error' in segments) return segments

  const list = sentences()
  const firstIndex = indexOfSentenceId(segments[0].startSentenceId)
  const clip: Clip = {
    id: 'c' + ++clipCounter,
    title: input.title?.trim() || defaultTitle(list[firstIndex]?.text ?? ''),
    note: input.note?.trim() || undefined,
    kind: input.kind ?? (segments.length > 1 ? 'cut' : 'topic'),
    segments,
    pad: clamp(input.pad ?? 0, 0, 2),
    sourceClipId: input.sourceClipId,
    revision: 1,
    createdBy: input.by,
    lastEditedBy: input.by,
    createdAt: Date.now(),
  }
  mutate((s) => ({ clips: [...s.clips, clip], activeClipId: clip.id }))
  return clip
}

export function updateClip(input: {
  clipId: string
  expectedRevision?: number
  segments?: Segment[]
  title?: string
  note?: string
  pad?: number
  kind?: ClipKind
  by: Actor
}): Clip | { error: string; currentRevision?: number } {
  const existing = state.clips.find((c) => c.id === input.clipId)
  if (!existing) return { error: 'No clip with id "' + input.clipId + '".' }

  if (typeof input.expectedRevision === 'number' && input.expectedRevision !== existing.revision) {
    return {
      error:
        'Clip ' +
        existing.id +
        ' has moved on since you read it — you expected revision ' +
        input.expectedRevision +
        ', it is now ' +
        existing.revision +
        '. Someone edited it in the UI. Call get_editor_state and decide again ' +
        'from the real cut.',
      currentRevision: existing.revision,
    }
  }

  let segments = existing.segments
  if (input.segments) {
    const next = normaliseSegments(input.segments)
    if ('error' in next) return next
    segments = next
  }

  const clip: Clip = {
    ...existing,
    segments,
    kind: input.kind ?? existing.kind,
    title: input.title?.trim() || existing.title,
    note: input.note === undefined ? existing.note : input.note.trim() || undefined,
    pad: input.pad === undefined ? existing.pad : clamp(input.pad, 0, 2),
    revision: existing.revision + 1,
    lastEditedBy: input.by,
  }
  mutate((s) => ({ clips: s.clips.map((c) => (c.id === clip.id ? clip : c)) }))
  return clip
}

/**
 * Drops one sentence from a clip. If it sits in the interior the segment splits
 * in two — which is the whole reason a clip is a list of segments rather than a
 * single range.
 */
export function removeSentence(
  clipId: string,
  sentenceId: string,
  by: Actor
): Clip | { error: string } {
  const clip = state.clips.find((c) => c.id === clipId)
  if (!clip) return { error: 'No clip with id "' + clipId + '".' }
  const target = indexOfSentenceId(sentenceId)
  const list = sentences()
  if (target < 0 || target >= list.length) return { error: unknownId(sentenceId) }

  const kept = clipSentenceIndices(clip)
  if (!kept.includes(target)) return { error: sentenceId + ' is not in ' + clipId + '.' }
  const next = kept.filter((i) => i !== target)
  if (!next.length) return { error: 'That would empty the clip. Delete it instead.' }

  return updateClip({ clipId, segments: segmentsFromIndices(next), by, kind: 'cut' })
}

/** Puts a sentence back into a clip, in transcript order. */
export function addSentence(
  clipId: string,
  sentenceId: string,
  by: Actor
): Clip | { error: string } {
  const clip = state.clips.find((c) => c.id === clipId)
  if (!clip) return { error: 'No clip with id "' + clipId + '".' }
  const target = indexOfSentenceId(sentenceId)
  const list = sentences()
  if (target < 0 || target >= list.length) return { error: unknownId(sentenceId) }

  const kept = clipSentenceIndices(clip)
  if (kept.includes(target)) return { error: sentenceId + ' is already in ' + clipId + '.' }
  return updateClip({ clipId, segments: segmentsFromIndices([...kept, target]), by })
}

export function deleteClip(clipId: string) {
  mutate((s) => ({
    clips: s.clips.filter((c) => c.id !== clipId),
    activeClipId: s.activeClipId === clipId ? null : s.activeClipId,
  }))
}

export function setActiveClip(clipId: string | null) {
  set({ activeClipId: clipId })
}

/**
 * A human setting an anchor clears whatever the agent was auditioning; the two
 * are alternative answers to "what are we looking at". Marks default to empty
 * because a plain click means "start again" — shift- and cmd-click pass the
 * banked ranges back in to keep them.
 */
export function setSelection(selection: Selection | null, marks: Segment[] = []) {
  set({ selection, audition: null, marks })
}

/**
 * Shift-click and shift-arrow: move the live range's far edge, leaving banked
 * marks alone.
 *
 * This reads `state` rather than taking the marks as an argument, which the
 * caller would have to source from a React render — and a second click landing
 * before that render would hand back a stale list and silently empty the bank.
 */
export function extendSelection(endSentenceId: string) {
  const current = state.selection
  if (!current) {
    setSelection({ startSentenceId: endSentenceId, endSentenceId })
    return
  }
  set({
    selection: { startSentenceId: current.startSentenceId, endSentenceId },
    audition: null,
  })
}

/**
 * Cmd-click: put the range being worked on aside and start another somewhere
 * else. What comes back is a clip made of moments that never touched.
 */
export function markAndStartNew(sentenceId: string) {
  const current = state.selection
  const banked = current
    ? [
        ...state.marks,
        { startSentenceId: current.startSentenceId, endSentenceId: current.endSentenceId },
      ]
    : state.marks
  setSelection({ startSentenceId: sentenceId, endSentenceId: sentenceId }, banked)
}

/** Every sentence index the human has marked, banked ranges and current alike. */
export function selectedIndices(): number[] {
  const out: number[] = []
  const add = (seg: Segment) => {
    const r = resolveRange(seg.startSentenceId, seg.endSentenceId)
    if ('error' in r) return
    for (let i = r.start.index; i <= r.end.index; i++) out.push(i)
  }
  for (const m of state.marks) add(m)
  if (state.selection) {
    add({
      startSentenceId: state.selection.startSentenceId,
      endSentenceId: state.selection.endSentenceId,
    })
  }
  return [...new Set(out)].sort((a, b) => a - b)
}

/** The marked ranges as clip segments — contiguous runs joined. */
export function selectedSegments(): Segment[] {
  return segmentsFromIndices(selectedIndices())
}

/** The marked ranges as playable second-ranges, so a collection can be auditioned. */
export function selectedRanges(): Range[] {
  const list = sentences()
  const out: Range[] = []
  for (const seg of selectedSegments()) {
    const r = resolveRange(seg.startSentenceId, seg.endSentenceId)
    if ('error' in r) continue
    out.push({ start: list[r.start.index].start, end: list[r.end.index].end })
  }
  return out
}

/** Playing time of everything marked, so the UI can say what a clip would cost. */
export function selectedDuration(): number {
  return selectedRanges().reduce((total, r) => total + Math.max(0, r.end - r.start), 0)
}

export function setAudition(audition: Selection | null) {
  set({ audition })
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo))
}

function defaultTitle(text: string): string {
  const words = text.replace(/[^\w\s'-]/g, '').split(/\s+/).filter(Boolean)
  const head = words.slice(0, 6).join(' ')
  return head ? head.charAt(0).toUpperCase() + head.slice(1) : 'Untitled clip'
}

// ------------------------------------------------------------- tool events

let eventCounter = 0

export function logTool(tool: string, summary: string, ok = true) {
  const event: ToolEvent = { id: ++eventCounter, tool, summary, at: Date.now(), ok }
  set((s) => ({ toolEvents: [event, ...s.toolEvents].slice(0, 60) }))
}
