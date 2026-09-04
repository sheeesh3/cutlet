import { useSyncExternalStore } from 'react'
import type { Actor, Clip, ClipKind, Project, Range, Segment, Sentence } from '../types.ts'
import {
  indexOfSentenceId,
  registerSentences,
  nextSentenceId,
  renderWords,
} from '../transcript/sentences.ts'

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
  registerSentences(project.sentences)
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

/**
 * Cuts one sentence in two at a word boundary, so a clip can start or end
 * somewhere the speech recogniser did not put a full stop.
 *
 * This is the answer to "the punctuation is wrong and I want half of this
 * line". Rather than letting a clip carry a boundary with no name — a time
 * nobody can refer to — the boundary becomes a sentence in its own right, with
 * its own id. The agent can then read it, name it, and cut on it like any
 * other.
 *
 * `atWord` is an offset within the sentence: the index of the first word of the
 * second half. Every clip is rewritten so it still contains exactly the words it
 * contained before — splitting is a change to the vocabulary, never to the edit.
 */
export function splitSentence(
  sentenceId: string,
  atWord: number,
  by: Actor
): { first: Sentence; second: Sentence } | { error: string } {
  const project = state.project
  if (!project) return { error: 'No transcript is loaded.' }
  const list = project.sentences
  const at = indexOfSentenceId(sentenceId)
  if (at < 0 || at >= list.length) return { error: unknownId(sentenceId) }

  const target = list[at]
  const words = project.words
  if (!words || target.wordStart === undefined || target.wordEnd === undefined) {
    return {
      error:
        'That transcript has no word timings behind it, so ' + sentenceId +
        ' cannot be split. Load a word-level transcript (Whisper or Deepgram JSON) to split lines.',
    }
  }

  const count = target.wordEnd - target.wordStart + 1
  if (!Number.isInteger(atWord) || atWord < 1 || atWord >= count) {
    return {
      error:
        'Split point must be between 1 and ' + (count - 1) + ' for ' + sentenceId +
        ', which is ' + count + ' words long.',
    }
  }

  const head = words.slice(target.wordStart, target.wordStart + atWord)
  const tail = words.slice(target.wordStart + atWord, target.wordEnd + 1)
  const newId = nextSentenceId(list)

  const first: Sentence = {
    ...target,
    text: renderWords(head).text,
    start: head[0].start,
    end: head[head.length - 1].end,
    wordStart: target.wordStart,
    wordEnd: target.wordStart + atWord - 1,
  }
  const second: Sentence = {
    id: newId,
    index: at + 1,
    text: renderWords(tail).text,
    start: tail[0].start,
    end: tail[tail.length - 1].end,
    wordStart: target.wordStart + atWord,
    wordEnd: target.wordEnd,
    speaker: target.speaker,
  }

  const next = [...list.slice(0, at), first, second, ...list.slice(at + 1)]
  next.forEach((s, i) => {
    s.index = i
  })
  registerSentences(next)

  // A clip that ended on the sentence we just split still means to include all
  // of it, so its end moves to the new half. A clip that started there already
  // starts at the first half and needs nothing.
  const clips = state.clips.map((clip) => {
    const segments = clip.segments.map((seg) =>
      seg.endSentenceId === sentenceId ? { ...seg, endSentenceId: newId } : seg
    )
    return segments.some((s, i) => s !== clip.segments[i]) ? { ...clip, segments } : clip
  })

  mutate({ project: { ...project, sentences: next }, clips })
  logTool(
    'split_sentence',
    'Split ' + sentenceId + ' after word ' + atWord + ' — ' + sentenceId + ' now ends "…' +
      tailWords(first.text) + '" and ' + newId + ' begins "' + headWords(second.text) + '…".',
    true
  )
  void by
  return { first, second }
}

const headWords = (text: string) => text.split(/\s+/).slice(0, 5).join(' ')
const tailWords = (text: string) => text.split(/\s+/).slice(-5).join(' ')

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

  // Deliberately not sorted: `segments` is in play order, and a clip whose
  // pieces have been reordered means to play them out of transcript order.
  const merged: Range[] = []
  for (const range of raw) {
    const last = merged[merged.length - 1]
    // Merge only where this piece carries on from the one before it. Padding can
    // push neighbours into each other, and playing that would seek backwards
    // mid-clip; but two pieces that touch after a reorder are touching by
    // coincidence, and joining them would quietly undo the reorder.
    if (last && range.start >= last.start && range.start <= last.end + 0.001) {
      last.end = Math.max(last.end, range.end)
    } else {
      merged.push({ ...range })
    }
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

/**
 * Where the clip sits in the recording, earliest to latest. Computed from the
 * extremes rather than the first and last piece, because after a reorder the
 * last piece can be the earliest moment.
 */
export function clipSpan(clip: Clip): Range {
  const ranges = clipRanges(clip)
  if (!ranges.length) return { start: 0, end: 0 }
  return {
    start: Math.min(...ranges.map((r) => r.start)),
    end: Math.max(...ranges.map((r) => r.end)),
  }
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
  // min/max rather than first/last: play order need not be transcript order.
  const span = Math.max(...kept) - Math.min(...kept) + 1
  return span - kept.length
}

/**
 * In-bounds, non-overlapping; touching runs joined and put in transcript order.
 *
 * `preserveOrder` skips the sort and the join, for the one case where the order
 * is the point: a clip whose pieces have been deliberately rearranged. Tidying
 * that back into transcript order would silently undo the edit.
 */
function normaliseSegments(
  segments: Segment[],
  preserveOrder = false
): Segment[] | { error: string } {
  const list = sentences()
  const spans: { a: number; b: number }[] = []
  for (const seg of segments) {
    const r = resolveRange(seg.startSentenceId, seg.endSentenceId)
    if ('error' in r) return r
    spans.push({ a: r.start.index, b: r.end.index })
  }
  if (!spans.length) return { error: 'A clip needs at least one range of sentences.' }

  if (preserveOrder) {
    return spans.map((s) => ({
      startSentenceId: list[s.a].id,
      endSentenceId: list[s.b].id,
    }))
  }

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
  /** Keep `segments` in the order given rather than sorting into transcript order. */
  preserveOrder?: boolean
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
    const next = normaliseSegments(input.segments, input.preserveOrder)
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

/**
 * Moves one piece of a cut to another position in the play order.
 *
 * This is the edit a timeline is for, and the reason it is safe here: moving a
 * piece creates no new boundary. Each segment keeps the sentence ids it always
 * had, so the agent can still name every edge of the result — it is the same
 * ranges in a different order, not a new range nobody can describe.
 */
export function moveSegment(
  clipId: string,
  from: number,
  to: number,
  by: Actor
): Clip | { error: string } {
  const clip = state.clips.find((c) => c.id === clipId)
  if (!clip) return { error: 'No clip with id "' + clipId + '".' }
  const count = clip.segments.length
  if (from < 0 || from >= count) return { error: 'No piece ' + (from + 1) + ' in ' + clipId + '.' }
  if (to < 0 || to >= count) return { error: 'Cannot move a piece to position ' + (to + 1) + '.' }
  if (from === to) return clip

  const next = [...clip.segments]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return updateClip({ clipId, segments: next, preserveOrder: true, kind: 'cut', by })
}

/** Drops one piece from a cut entirely, gaps and all. */
export function removeSegment(clipId: string, index: number, by: Actor): Clip | { error: string } {
  const clip = state.clips.find((c) => c.id === clipId)
  if (!clip) return { error: 'No clip with id "' + clipId + '".' }
  if (index < 0 || index >= clip.segments.length) {
    return { error: 'No piece ' + (index + 1) + ' in ' + clipId + '.' }
  }
  if (clip.segments.length === 1) {
    return { error: 'That is the only piece left. Delete the clip instead.' }
  }
  const next = clip.segments.filter((_, i) => i !== index)
  return updateClip({ clipId, segments: next, preserveOrder: true, by })
}

/** True once play order stops matching transcript order — the UI says so. */
export function clipIsReordered(clip: Clip): boolean {
  const starts = clip.segments.map((s) => indexOfSentenceId(s.startSentenceId))
  return starts.some((v, i) => i > 0 && v < starts[i - 1])
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
