/** A single timed word, as produced by Whisper/Deepgram-style ASR. */
export interface Word {
  text: string
  start: number
  end: number
}

/**
 * A sentence is the atomic unit of editing in ClipClub. Its `id` is stable for
 * the lifetime of a transcript, which is what lets the agent name a cut without
 * ever handling a floating timestamp.
 */
export interface Sentence {
  id: string
  index: number
  text: string
  start: number
  end: number
  speaker?: string
}

/** `auto` is the page's own heuristic pass — no agent involved. */
export type Actor = 'agent' | 'human' | 'auto'

/** A contiguous, inclusive run of sentences. */
export interface Segment {
  startSentenceId: string
  endSentenceId: string
}

/**
 * `topic` is a whole subject as spoken — often two or three minutes, always one
 * segment. `cut` is that topic reduced to something short enough to post, which
 * means dropping sentences out of the middle, which means more than one segment.
 */
export type ClipKind = 'topic' | 'cut'

export interface Clip {
  id: string
  title: string
  note?: string
  kind: ClipKind
  /** In play order. A topic has exactly one; a cut has several. */
  segments: Segment[]
  /** Seconds added at each segment edge so the cuts breathe. */
  pad: number
  /** For a cut, the topic it came from. */
  sourceClipId?: string
  /** Bumped on every edit. `update_clip` must match it to win. */
  revision: number
  createdBy: Actor
  lastEditedBy: Actor
  createdAt: number
}

export interface Project {
  name: string
  videoUrl: string
  videoLabel: string
  attribution?: string
  sentences: Sentence[]
  duration: number
}

/** Resolved playback bounds for one segment, in seconds. */
export interface Range {
  start: number
  end: number
}
