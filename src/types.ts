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

export type Actor = 'agent' | 'human'

/** A clip is a contiguous, inclusive range of sentence ids. */
export interface Clip {
  id: string
  title: string
  startSentenceId: string
  endSentenceId: string
  note?: string
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
