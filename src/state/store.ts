import { useSyncExternalStore } from 'react'
import type { Actor, Clip, Project, Sentence } from '../types'
import { indexOfSentenceId } from '../transcript/sentences'

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
}

const initial: EditorState = {
  project: null,
  loading: true,
  error: null,
  clips: [],
  activeClipId: null,
  selection: null,
  audition: null,
  revision: 0,
  toolEvents: [],
  mcpConnected: false,
  exporting: null,
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
  if (a < 0 || a >= list.length) return { error: `Unknown sentence id "${startSentenceId}".` }
  if (b < 0 || b >= list.length) return { error: `Unknown sentence id "${endSentenceId}".` }
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  return { start: list[lo], end: list[hi] }
}

export function clipBounds(clip: Clip): { start: number; end: number } {
  const r = resolveRange(clip.startSentenceId, clip.endSentenceId)
  if ('error' in r) return { start: 0, end: 0 }
  return { start: r.start.start, end: r.end.end }
}

export function clipDuration(clip: Clip): number {
  const { start, end } = clipBounds(clip)
  return Math.max(0, end - start)
}

export function clipText(clip: Clip): string {
  const r = resolveRange(clip.startSentenceId, clip.endSentenceId)
  if ('error' in r) return ''
  return sentences()
    .slice(r.start.index, r.end.index + 1)
    .map((s) => s.text)
    .join(' ')
}

// ------------------------------------------------------------------ clips

let clipCounter = 0

export function createClip(input: {
  startSentenceId: string
  endSentenceId: string
  title?: string
  note?: string
  by: Actor
}): Clip | { error: string } {
  const r = resolveRange(input.startSentenceId, input.endSentenceId)
  if ('error' in r) return r
  const clip: Clip = {
    id: `c${++clipCounter}`,
    title: input.title?.trim() || defaultTitle(r.start.text),
    startSentenceId: r.start.id,
    endSentenceId: r.end.id,
    note: input.note?.trim() || undefined,
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
  startSentenceId?: string
  endSentenceId?: string
  title?: string
  note?: string
  by: Actor
}): Clip | { error: string; currentRevision?: number } {
  const existing = state.clips.find((c) => c.id === input.clipId)
  if (!existing) return { error: `No clip with id "${input.clipId}".` }

  if (
    typeof input.expectedRevision === 'number' &&
    input.expectedRevision !== existing.revision
  ) {
    return {
      error:
        `Clip ${existing.id} has moved on since you read it — you expected revision ` +
        `${input.expectedRevision}, it is now ${existing.revision}. Someone edited it in ` +
        `the UI. Call get_editor_state and decide again from the real range.`,
      currentRevision: existing.revision,
    }
  }

  const r = resolveRange(
    input.startSentenceId ?? existing.startSentenceId,
    input.endSentenceId ?? existing.endSentenceId
  )
  if ('error' in r) return r

  const next: Clip = {
    ...existing,
    startSentenceId: r.start.id,
    endSentenceId: r.end.id,
    title: input.title?.trim() || existing.title,
    note: input.note === undefined ? existing.note : input.note.trim() || undefined,
    revision: existing.revision + 1,
    lastEditedBy: input.by,
  }
  mutate((s) => ({ clips: s.clips.map((c) => (c.id === next.id ? next : c)) }))
  return next
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

export function setSelection(selection: Selection | null) {
  // A human setting an anchor clears whatever the agent was auditioning; the
  // two are alternative answers to "what are we looking at".
  set({ selection, audition: null })
}

export function setAudition(audition: Selection | null) {
  set({ audition })
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
