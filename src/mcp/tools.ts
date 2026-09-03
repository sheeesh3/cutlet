import type { ToolDescriptor } from './types'
import { ok, fail } from './types'
import {
  getState,
  sentences,
  sentenceById,
  resolveRange,
  clipBounds,
  clipDuration,
  clipText,
  createClip,
  updateClip,
  setAudition,
  setActiveClip,
  logTool,
} from '../state/store'
import { playClip, playSentenceRange, seek, getVideo } from '../state/player'
import { formatTimecode, formatDuration } from '../transcript/sentences'
import type { Clip } from '../types'

/** A window this size keeps a tool result readable without a second call. */
const DEFAULT_WINDOW = 40
const MAX_WINDOW = 120

const round = (n: number) => Math.round(n * 100) / 100

function clipView(clip: Clip) {
  const { start, end } = clipBounds(clip)
  return {
    id: clip.id,
    title: clip.title,
    startSentenceId: clip.startSentenceId,
    endSentenceId: clip.endSentenceId,
    startSeconds: round(start),
    endSeconds: round(end),
    durationSeconds: round(end - start),
    note: clip.note,
    revision: clip.revision,
    createdBy: clip.createdBy,
    lastEditedBy: clip.lastEditedBy,
    text: clipText(clip),
  }
}

function sentenceView(index: number) {
  const s = sentences()[index]
  return {
    id: s.id,
    startSeconds: round(s.start),
    endSeconds: round(s.end),
    text: s.text,
  }
}

function requireProject(): string | null {
  return getState().project ? null : 'No project is loaded yet. Ask the user to open a video.'
}

// ------------------------------------------------------------ 1. state

const getEditorState: ToolDescriptor = {
  name: 'get_editor_state',
  description:
    'Read the current state of the ClipClub editor: the loaded video, how many ' +
    'sentences the transcript has, what the user has selected, every clip that ' +
    'exists with its sentence range and revision, and where the playhead is. ' +
    'Call this before editing a clip, and again after the user says they changed ' +
    'something — clip revisions change when a human drags an edge, and you need ' +
    'the current revision to edit safely.',
  annotations: { readOnlyHint: true, title: 'Get editor state' },
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  execute() {
    const s = getState()
    const video = getVideo()
    const list = sentences()
    const payload = {
      project: s.project
        ? {
            name: s.project.name,
            video: s.project.videoLabel,
            durationSeconds: round(s.project.duration),
            sentenceCount: list.length,
            firstSentenceId: list[0]?.id ?? null,
            lastSentenceId: list[list.length - 1]?.id ?? null,
          }
        : null,
      revision: s.revision,
      selection: s.selection
        ? {
            ...s.selection,
            text: (() => {
              const r = resolveRange(s.selection.startSentenceId, s.selection.endSentenceId)
              return 'error' in r
                ? ''
                : list.slice(r.start.index, r.end.index + 1).map((x) => x.text).join(' ')
            })(),
          }
        : null,
      audition: s.audition,
      activeClipId: s.activeClipId,
      clips: s.clips.map(clipView),
      playback: {
        currentTimeSeconds: round(video?.currentTime ?? 0),
        paused: video?.paused ?? true,
      },
    }
    const summary = s.project
      ? `${s.project.name}: ${list.length} sentences, ${s.clips.length} clip(s), revision ${s.revision}.` +
        (s.selection
          ? ` The user has anchored ${s.selection.startSentenceId}–${s.selection.endSentenceId}` +
            ' — that sentence has to survive whatever you propose.'
          : ' The user has not anchored anything.')
      : 'No project loaded.'
    logTool('get_editor_state', summary)
    return ok(summary + '\n' + JSON.stringify(payload, null, 2), payload)
  },
}

// -------------------------------------------------------- 2. read window

const readTranscript: ToolDescriptor = {
  name: 'read_transcript',
  description:
    'Read a bounded window of the transcript as sentences, each with a stable id ' +
    'like s0042 and its start and end time. Use the ids — never raw timestamps — ' +
    'when you propose a clip. Start from the user\'s selection or from a search ' +
    'hit and expand outward; do not try to read the whole transcript at once.',
  annotations: { readOnlyHint: true, title: 'Read transcript window' },
  inputSchema: {
    type: 'object',
    properties: {
      startSentenceId: {
        type: 'string',
        description: 'First sentence to return, e.g. "s0042". Defaults to the start of the transcript, or to the sentence before the current selection when there is one.',
      },
      count: {
        type: 'number',
        description: `How many sentences to return. Default ${DEFAULT_WINDOW}, maximum ${MAX_WINDOW}.`,
      },
      before: {
        type: 'number',
        description: 'Also include this many sentences of context before startSentenceId. Useful when you need to find where a thought begins.',
      },
    },
    additionalProperties: false,
  },
  execute(args) {
    const missing = requireProject()
    if (missing) return fail(missing)
    const list = sentences()

    const requested = typeof args.startSentenceId === 'string' ? args.startSentenceId : null
    let from = 0
    if (requested) {
      const s = sentenceById(requested)
      if (!s) return fail(`Unknown sentence id "${requested}". Ids run ${list[0].id}–${list[list.length - 1].id}.`)
      from = s.index
    } else if (getState().selection) {
      const s = sentenceById(getState().selection!.startSentenceId)
      if (s) from = s.index
    }

    const before = Math.max(0, Math.min(20, Number(args.before) || 0))
    from = Math.max(0, from - before)

    const count = Math.max(1, Math.min(MAX_WINDOW, Number(args.count) || DEFAULT_WINDOW))
    const to = Math.min(list.length, from + count)
    const window = []
    for (let i = from; i < to; i++) window.push(sentenceView(i))

    const payload = {
      sentences: window,
      returned: window.length,
      totalSentences: list.length,
      hasMoreBefore: from > 0,
      hasMoreAfter: to < list.length,
      nextSentenceId: to < list.length ? list[to].id : null,
      previousSentenceId: from > 0 ? list[Math.max(0, from - count)].id : null,
    }
    const summary =
      `Sentences ${window[0]?.id}–${window[window.length - 1]?.id} ` +
      `(${window.length} of ${list.length}).`
    logTool('read_transcript', summary)
    return ok(
      summary +
        '\n' +
        window.map((s) => `${s.id} [${formatTimecode(s.startSeconds)}] ${s.text}`).join('\n'),
      payload
    )
  },
}

// ------------------------------------------------------------ 3. search

const searchTranscript: ToolDescriptor = {
  name: 'search_transcript',
  description:
    'Find sentences matching a word or phrase, anywhere in the transcript. ' +
    'Returns matching sentence ids with a little surrounding context so you can ' +
    'judge where a thought starts and ends before proposing a range. This is the ' +
    'cheap way to locate a moment in a long recording.',
  annotations: { readOnlyHint: true, title: 'Search transcript' },
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Words to look for. Matching is case-insensitive; all words must appear in the sentence, in any order.',
      },
      limit: { type: 'number', description: 'Maximum number of hits. Default 8, maximum 25.' },
      contextSentences: {
        type: 'number',
        description: 'How many sentences either side of each hit to include. Default 1.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  execute(args) {
    const missing = requireProject()
    if (missing) return fail(missing)
    const query = String(args.query ?? '').trim()
    if (!query) return fail('Give me something to search for.')

    const limit = Math.max(1, Math.min(25, Number(args.limit) || 8))
    // `??` would not help here: Number(undefined) is NaN, not nullish, so the
    // default has to be chosen before the conversion. An explicit 0 must still
    // mean "no context".
    const ctx =
      args.contextSentences === undefined
        ? 1
        : Math.max(0, Math.min(4, Number(args.contextSentences) || 0))
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    const list = sentences()

    const hits = []
    for (const s of list) {
      const hay = s.text.toLowerCase()
      if (!terms.every((t) => hay.includes(t))) continue
      const from = Math.max(0, s.index - ctx)
      const to = Math.min(list.length, s.index + ctx + 1)
      hits.push({
        id: s.id,
        startSeconds: round(s.start),
        endSeconds: round(s.end),
        text: s.text,
        context: list.slice(from, to).map((c) => ({ id: c.id, text: c.text })),
      })
      if (hits.length >= limit) break
    }

    const payload = { query, hits, matchCount: hits.length, totalSentences: list.length }
    const summary = hits.length
      ? `${hits.length} match${hits.length === 1 ? '' : 'es'} for "${query}".`
      : `Nothing matched "${query}".`
    logTool('search_transcript', summary, hits.length > 0)
    return ok(
      summary +
        '\n' +
        hits.map((h) => `${h.id} [${formatTimecode(h.startSeconds)}] ${h.text}`).join('\n'),
      payload
    )
  },
}

// -------------------------------------------------------- 4. guidelines

const getGuidelines: ToolDescriptor = {
  name: 'get_guidelines',
  description:
    'Read the editorial rules this editor works by: what makes a good cut, how ' +
    'long clips should be, and what this tool set can and cannot do. Read this ' +
    'once before your first edit.',
  annotations: { readOnlyHint: true, title: 'Get editing guidelines' },
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  execute() {
    const text = GUIDELINES.trim()
    logTool('get_guidelines', 'Read the editing guidelines.')
    return ok(text, { guidelines: text })
  },
}

const GUIDELINES = `
How ClipClub cuts work

- A clip is a contiguous, inclusive range of sentence ids. There is no way to
  drop a sentence out of the middle. If the middle is weak, the range is wrong —
  find a tighter one.
- Address every edit by sentence id. Never send a timestamp; the ids are stable
  and the timestamps are not yours to compute.
- The user anchors, you expand. When someone selects a sentence, that sentence
  must survive in whatever you propose. Grow outward from it until the thought is
  whole, then stop.

What makes a cut land

- Start on the breath before the idea, not mid-sentence. A clip that opens on a
  subordinate clause reads as an accident.
- End on the landing, not on the next thought's first word. If the speaker starts
  a new sentence, you have gone one too far.
- Keep a setup if the payoff is meaningless without it. Cut it if the payoff
  stands alone — most do.
- 20 to 60 seconds is the useful range for a social cut. Under 12 seconds rarely
  has room to breathe; over 90 seconds needs a real reason.

Working with the human

- Propose one clip at a time and let them watch it. Do not fill the rail with
  variants nobody asked for.
- After they move an edge, call get_editor_state before you touch that clip
  again. Their edit is the brief.
- update_clip takes expectedRevision. Send the revision you last saw. If it comes
  back rejected, the human changed something — read the state and work from what
  is actually there, not from what you proposed.
`

// -------------------------------------------------------------- 5. create

const createClipTool: ToolDescriptor = {
  name: 'create_clip',
  description:
    'Create a clip from a contiguous range of sentence ids and add it to the ' +
    'clips rail. The range is inclusive of both ends. If the user has selected a ' +
    'sentence, that sentence must fall inside the range you choose.',
  annotations: { title: 'Create clip' },
  inputSchema: {
    type: 'object',
    properties: {
      startSentenceId: { type: 'string', description: 'First sentence in the clip, e.g. "s0031".' },
      endSentenceId: { type: 'string', description: 'Last sentence in the clip, inclusive, e.g. "s0038".' },
      title: { type: 'string', description: 'Short human title. A few words, sentence case.' },
      note: { type: 'string', description: 'One line on why this range — the user reads this.' },
      preview: {
        type: 'boolean',
        description: 'Play the clip immediately after creating it. Default true — the point is for the human to watch it.',
      },
    },
    required: ['startSentenceId', 'endSentenceId'],
    additionalProperties: false,
  },
  execute(args) {
    const missing = requireProject()
    if (missing) return fail(missing)

    const result = createClip({
      startSentenceId: String(args.startSentenceId),
      endSentenceId: String(args.endSentenceId),
      title: typeof args.title === 'string' ? args.title : undefined,
      note: typeof args.note === 'string' ? args.note : undefined,
      by: 'agent',
    })
    if ('error' in result) {
      logTool('create_clip', result.error, false)
      return fail(result.error)
    }

    const view = clipView(result)
    const anchor = getState().selection
    let warning = ''
    if (anchor) {
      const a = sentenceById(anchor.startSentenceId)
      const s = sentenceById(result.startSentenceId)
      const e = sentenceById(result.endSentenceId)
      if (a && s && e && (a.index < s.index || a.index > e.index)) {
        warning =
          `\nNote: the user's selected sentence ${anchor.startSentenceId} is NOT inside ` +
          `this range. That is usually a mistake — the selection is the moment they asked to keep.`
      }
    }

    if (args.preview !== false) playClip(result.id)
    const summary =
      `Created ${result.id} "${result.title}" — ${view.startSentenceId}–${view.endSentenceId}, ` +
      `${formatDuration(view.durationSeconds)} (revision ${result.revision}).`
    logTool('create_clip', summary)
    return ok(summary + warning + '\n' + view.text, view)
  },
}

// -------------------------------------------------------------- 6. update

const updateClipTool: ToolDescriptor = {
  name: 'update_clip',
  description:
    'Change an existing clip: move either edge to a different sentence id, or ' +
    'retitle it. Pass expectedRevision with the revision you last read for that ' +
    'clip — if a human has edited it since, the write is refused and you are told ' +
    'the real revision, so you can look at what they did instead of overwriting it.',
  annotations: { title: 'Update clip' },
  inputSchema: {
    type: 'object',
    properties: {
      clipId: { type: 'string', description: 'Which clip, e.g. "c2".' },
      expectedRevision: {
        type: 'number',
        description: 'The revision you last saw on this clip. Strongly recommended — it is what stops you clobbering a human edit.',
      },
      startSentenceId: { type: 'string', description: 'New first sentence. Omit to leave it alone.' },
      endSentenceId: { type: 'string', description: 'New last sentence, inclusive. Omit to leave it alone.' },
      title: { type: 'string', description: 'New title.' },
      note: { type: 'string', description: 'New one-line note.' },
      preview: { type: 'boolean', description: 'Play the revised clip. Default true.' },
    },
    required: ['clipId'],
    additionalProperties: false,
  },
  execute(args) {
    const missing = requireProject()
    if (missing) return fail(missing)

    const result = updateClip({
      clipId: String(args.clipId),
      expectedRevision:
        typeof args.expectedRevision === 'number' ? args.expectedRevision : undefined,
      startSentenceId:
        typeof args.startSentenceId === 'string' ? args.startSentenceId : undefined,
      endSentenceId: typeof args.endSentenceId === 'string' ? args.endSentenceId : undefined,
      title: typeof args.title === 'string' ? args.title : undefined,
      note: typeof args.note === 'string' ? args.note : undefined,
      by: 'agent',
    })
    if ('error' in result) {
      logTool('update_clip', result.error, false)
      return fail(result.error, { currentRevision: result.currentRevision })
    }

    if (args.preview !== false) playClip(result.id)
    const view = clipView(result)
    const summary =
      `Updated ${result.id} — now ${view.startSentenceId}–${view.endSentenceId}, ` +
      `${formatDuration(view.durationSeconds)} (revision ${result.revision}).`
    logTool('update_clip', summary)
    return ok(summary + '\n' + view.text, view)
  },
}

// ------------------------------------------------------------- 7. preview

const previewClip: ToolDescriptor = {
  name: 'preview_clip',
  description:
    'Play a range in the player so the human can watch it, or just move the ' +
    'playhead there. Give it a clipId, or a pair of sentence ids to audition a ' +
    'range before you commit it to a clip. Playback happens in the user\'s tab; ' +
    'you get back what you asked it to do, not the video.',
  annotations: { title: 'Preview or seek' },
  inputSchema: {
    type: 'object',
    properties: {
      clipId: { type: 'string', description: 'Play this existing clip.' },
      startSentenceId: { type: 'string', description: 'Play from this sentence. Use with endSentenceId to audition a range you have not created yet.' },
      endSentenceId: { type: 'string', description: 'Play up to and including this sentence.' },
      mode: {
        type: 'string',
        enum: ['play', 'seek'],
        description: 'play (default) runs the range and stops at its end. seek parks the playhead at the start without playing.',
      },
    },
    additionalProperties: false,
  },
  execute(args) {
    const missing = requireProject()
    if (missing) return fail(missing)
    const mode = args.mode === 'seek' ? 'seek' : 'play'

    if (typeof args.clipId === 'string') {
      const clip = getState().clips.find((c) => c.id === args.clipId)
      if (!clip) return fail(`No clip with id "${args.clipId}".`)
      setActiveClip(clip.id)
      const { start, end } = clipBounds(clip)
      if (mode === 'seek') seek(start)
      else playClip(clip.id)
      const summary = `${mode === 'seek' ? 'Moved the playhead to' : 'Playing'} ${clip.id} "${clip.title}" (${formatDuration(clipDuration(clip))}).`
      logTool('preview_clip', summary)
      return ok(summary, {
        clipId: clip.id,
        mode,
        startSeconds: round(start),
        endSeconds: round(end),
      })
    }

    const startId = typeof args.startSentenceId === 'string' ? args.startSentenceId : null
    if (!startId) return fail('Give me a clipId, or a startSentenceId to play from.')
    const endId = typeof args.endSentenceId === 'string' ? args.endSentenceId : startId

    const r = resolveRange(startId, endId)
    if ('error' in r) return fail(r.error)

    // An audition, not a selection. The human's anchor is theirs; an agent
    // trying a range out must not overwrite the brief it was given.
    setAudition({ startSentenceId: r.start.id, endSentenceId: r.end.id })
    if (mode === 'seek') seek(r.start.start)
    else playSentenceRange(r.start.id, r.end.id)

    const dur = r.end.end - r.start.start
    const summary =
      `${mode === 'seek' ? 'Moved the playhead to' : 'Playing'} ${r.start.id}–${r.end.id} ` +
      `(${formatDuration(dur)}), and marked it in the transcript as an audition. ` +
      `The user's own anchor is untouched.`
    logTool('preview_clip', summary)
    return ok(summary, {
      startSentenceId: r.start.id,
      endSentenceId: r.end.id,
      mode,
      startSeconds: round(r.start.start),
      endSeconds: round(r.end.end),
      durationSeconds: round(dur),
    })
  },
}

export const TOOLS: ToolDescriptor[] = [
  getEditorState,
  readTranscript,
  searchTranscript,
  getGuidelines,
  createClipTool,
  updateClipTool,
  previewClip,
]
