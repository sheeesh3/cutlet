import type { ToolDescriptor } from './types'
import { ok, fail } from './types'
import {
  getState,
  sentences,
  sentenceById,
  resolveRange,
  clipRanges,
  clipSpan,
  clipDuration,
  clipDropped,
  clipText,
  clipSentenceIndices,
  segmentsFromIndices,
  createClip,
  updateClip,
  removeSentence,
  addSentence,
  setAudition,
  setActiveClip,
  logTool,
} from '../state/store'
import { playClip, playRanges, seek, getVideo } from '../state/player'
import { formatTimecode, formatDuration, indexOfSentenceId } from '../transcript/sentences'
import { findTopics, cutToDuration } from '../edit/autoEdit'
import type { Clip, Segment } from '../types'

/** A window this size keeps a tool result readable without a second call. */
const DEFAULT_WINDOW = 40
const MAX_WINDOW = 120

const round = (n: number) => Math.round(n * 100) / 100

function clipView(clip: Clip) {
  const span = clipSpan(clip)
  return {
    id: clip.id,
    title: clip.title,
    kind: clip.kind,
    segments: clip.segments,
    segmentCount: clip.segments.length,
    droppedSentences: clipDropped(clip),
    spanSeconds: round(span.end - span.start),
    durationSeconds: round(clipDuration(clip)),
    startSeconds: round(span.start),
    padSeconds: clip.pad,
    note: clip.note,
    sourceClipId: clip.sourceClipId,
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

/** Accepts either a segment list or a single start/end pair. */
function readSegments(args: Record<string, unknown>): Segment[] | null {
  if (Array.isArray(args.segments)) {
    const out: Segment[] = []
    for (const raw of args.segments) {
      if (!raw || typeof raw !== 'object') continue
      const o = raw as Record<string, unknown>
      if (typeof o.startSentenceId === 'string' && typeof o.endSentenceId === 'string') {
        out.push({ startSentenceId: o.startSentenceId, endSentenceId: o.endSentenceId })
      }
    }
    if (out.length) return out
  }
  if (typeof args.startSentenceId === 'string') {
    const end =
      typeof args.endSentenceId === 'string' ? args.endSentenceId : args.startSentenceId
    return [{ startSentenceId: args.startSentenceId, endSentenceId: end }]
  }
  return null
}

// ------------------------------------------------------------ 1. state

const getEditorState: ToolDescriptor = {
  name: 'get_editor_state',
  description:
    'Read the current state of the ClipClub editor: the loaded video, how many ' +
    'sentences the transcript has, what the user has anchored, and every clip ' +
    'with its segments, duration and revision. Call this before editing a clip, ' +
    'and again after the user says they changed something — revisions change when ' +
    'a human edits, and you need the current one to write safely.',
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
      ? s.project.name + ': ' + list.length + ' sentences, ' + s.clips.length +
        ' clip(s), revision ' + s.revision + '.' +
        (s.selection
          ? ' The user has anchored ' + s.selection.startSentenceId + '-' +
            s.selection.endSentenceId + ' — that sentence has to survive whatever you propose.'
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
    "when you propose a clip. Start from the user's anchor or from a search hit " +
    'and expand outward; do not try to read the whole transcript at once.',
  annotations: { readOnlyHint: true, title: 'Read transcript window' },
  inputSchema: {
    type: 'object',
    properties: {
      startSentenceId: {
        type: 'string',
        description:
          'First sentence to return, e.g. "s0042". Defaults to the start of the transcript, ' +
          'or to the user\'s anchor when there is one.',
      },
      count: {
        type: 'number',
        description: 'How many sentences to return. Default ' + DEFAULT_WINDOW + ', maximum ' + MAX_WINDOW + '.',
      },
      before: {
        type: 'number',
        description:
          'Also include this many sentences of context before startSentenceId. Useful when ' +
          'you need to find where a thought begins.',
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
      if (!s) {
        return fail(
          'Unknown sentence id "' + requested + '". Ids run ' + list[0].id + '-' +
            list[list.length - 1].id + '.'
        )
      }
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
      'Sentences ' + window[0]?.id + '-' + window[window.length - 1]?.id +
      ' (' + window.length + ' of ' + list.length + ').'
    logTool('read_transcript', summary)
    return ok(
      summary + '\n' +
        window.map((s) => s.id + ' [' + formatTimecode(s.startSeconds) + '] ' + s.text).join('\n'),
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
        description:
          'Words to look for. Case-insensitive; all words must appear in the sentence, in any order.',
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
      ? hits.length + ' match' + (hits.length === 1 ? '' : 'es') + ' for "' + query + '".'
      : 'Nothing matched "' + query + '".'
    logTool('search_transcript', summary, hits.length > 0)
    return ok(
      summary + '\n' +
        hits.map((h) => h.id + ' [' + formatTimecode(h.startSeconds) + '] ' + h.text).join('\n'),
      payload
    )
  },
}

// -------------------------------------------------------- 4. guidelines

const GUIDELINES = `
The two shapes of clip

- A topic is a whole subject as spoken, usually one to four minutes, always one
  unbroken run of sentences. It is a candidate, not a deliverable.
- A cut is that topic reduced to something postable, which means dropping
  sentences out of the middle. A cut is a list of segments with gaps between
  them, and those gaps are the edit.

How cuts work here

- Address everything by sentence id. Never send a timestamp; the ids are stable
  and the timestamps are not yours to compute.
- The user anchors, you expand. When someone anchors a sentence, that sentence
  must survive in whatever you propose. Grow outward from it until the thought
  is whole, then stop.
- Two sentences in a row almost always play better than two good sentences with
  a hole between them. Every gap costs the viewer something.
- A sentence that opens on "but", "so", "they", "it" or "that" is nonsense once
  the thing it refers to has been cut. Either keep the sentence before it or
  choose a different one.

Length

- 30 to 60 seconds is the target for a cut. Under 20 seconds rarely has room to
  breathe; over 90 needs a real reason.
- Start on the breath before the idea, not mid-sentence. End on the landing, not
  on the next thought's first word.

Working with the human

- Propose one thing at a time and let them watch it. Do not fill the rail with
  variants nobody asked for.
- After they edit, call get_editor_state before you touch that clip again. Their
  edit is the brief.
- update_clip takes expectedRevision. Send the revision you last saw. If it comes
  back rejected, the human changed something — read the state and work from what
  is actually there, not from what you proposed.
- The page has its own lexical pass behind the Find clips and Cut buttons. It
  knows which words are unusual and where the speaker paused; it does not know
  what any of it means. Clips marked "auto" came from that pass and are the ones
  most worth your judgement.
`

const getGuidelines: ToolDescriptor = {
  name: 'get_guidelines',
  description:
    'Read the editorial rules this editor works by: the difference between a ' +
    'topic and a cut, what makes a cut land, how long clips should be, and what ' +
    'this tool set can and cannot do. Read this once before your first edit.',
  annotations: { readOnlyHint: true, title: 'Get editing guidelines' },
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  execute() {
    const text = GUIDELINES.trim()
    logTool('get_guidelines', 'Read the editing guidelines.')
    return ok(text, { guidelines: text })
  },
}

// ------------------------------------------------------- 5. suggest topics

const suggestTopics: ToolDescriptor = {
  name: 'suggest_topics',
  description:
    "Run the page's own lexical pass over the transcript and return candidate " +
    'topics — stretches that hang together by vocabulary, each with a sentence ' +
    'range and a rough title. This is what the Find clips button runs. It is a ' +
    'starting point, not an answer: it can see that the words changed, not that ' +
    'the subject did. Use it to orient yourself in a long recording, then judge ' +
    'the boundaries yourself and create the clips you actually want.',
  annotations: { readOnlyHint: true, title: 'Suggest topics' },
  inputSchema: {
    type: 'object',
    properties: {
      minSeconds: { type: 'number', description: 'Shortest topic worth returning. Default 60.' },
      maxSeconds: { type: 'number', description: 'Longest, before it is split again. Default 240.' },
    },
    additionalProperties: false,
  },
  execute(args) {
    const missing = requireProject()
    if (missing) return fail(missing)
    const list = sentences()
    const topics = findTopics(list, {
      minSeconds: Number(args.minSeconds) || undefined,
      maxSeconds: Number(args.maxSeconds) || undefined,
    })

    const payload = {
      topics: topics.map((t) => ({
        startSentenceId: list[t.startIndex].id,
        endSentenceId: list[t.endIndex].id,
        title: t.title,
        note: t.note,
        keywords: t.keywords,
        durationSeconds: round(list[t.endIndex].end - list[t.startIndex].start),
      })),
    }
    const summary = topics.length + ' candidate topic(s) from the lexical pass.'
    logTool('suggest_topics', summary)
    return ok(
      summary + '\n' +
        payload.topics
          .map(
            (t) =>
              t.startSentenceId + '-' + t.endSentenceId + ' (' +
              formatDuration(t.durationSeconds) + ') ' + t.title
          )
          .join('\n'),
      payload
    )
  },
}

// -------------------------------------------------------------- 6. create

const createClipTool: ToolDescriptor = {
  name: 'create_clip',
  description:
    'Create a clip and add it to the rail. Pass one contiguous range for a topic ' +
    '(startSentenceId + endSentenceId), or a list of segments for a cut with gaps ' +
    'in it. Ranges are inclusive of both ends. If the user has anchored a sentence, ' +
    'that sentence should fall inside what you create.',
  annotations: { title: 'Create clip' },
  inputSchema: {
    type: 'object',
    properties: {
      startSentenceId: { type: 'string', description: 'First sentence, for a single-range clip.' },
      endSentenceId: { type: 'string', description: 'Last sentence, inclusive, for a single-range clip.' },
      segments: {
        type: 'array',
        description:
          'For a cut: the pieces to keep, in order. Each is {startSentenceId, endSentenceId}, ' +
          'inclusive. Gaps between them are the sentences you are dropping.',
        items: {
          type: 'object',
          properties: {
            startSentenceId: { type: 'string' },
            endSentenceId: { type: 'string' },
          },
          required: ['startSentenceId', 'endSentenceId'],
        },
      },
      title: { type: 'string', description: 'Short human title. A few words, sentence case.' },
      note: { type: 'string', description: 'One line on why this shape — the user reads this.' },
      preview: {
        type: 'boolean',
        description: 'Play it immediately. Default true — the point is for the human to watch it.',
      },
    },
    additionalProperties: false,
  },
  execute(args) {
    const missing = requireProject()
    if (missing) return fail(missing)

    const segments = readSegments(args)
    if (!segments) {
      return fail('Give me startSentenceId and endSentenceId, or a segments array.')
    }

    const result = createClip({
      segments,
      title: typeof args.title === 'string' ? args.title : undefined,
      note: typeof args.note === 'string' ? args.note : undefined,
      by: 'agent',
    })
    if ('error' in result) {
      logTool('create_clip', result.error, false)
      return fail(result.error)
    }

    const view = clipView(result)
    let warning = ''
    const anchor = getState().selection
    if (anchor) {
      const anchorIndex = indexOfSentenceId(anchor.startSentenceId)
      if (!clipSentenceIndices(result).includes(anchorIndex)) {
        warning =
          "\nNote: the user's anchored sentence " + anchor.startSentenceId +
          ' is NOT in this clip. That is usually a mistake — the anchor is the moment they ' +
          'asked to keep.'
      }
    }

    if (args.preview !== false) playClip(result.id)
    const summary =
      'Created ' + result.id + ' "' + result.title + '" — ' + view.kind + ', ' +
      view.segmentCount + ' segment(s), ' + formatDuration(view.durationSeconds) +
      ' (revision ' + result.revision + ').'
    logTool('create_clip', summary)
    return ok(summary + warning + '\n' + view.text, view)
  },
}

// -------------------------------------------------------------- 7. update

const updateClipTool: ToolDescriptor = {
  name: 'update_clip',
  description:
    'Change an existing clip: replace its segments, move an edge, retitle it, or ' +
    'set the padding around each cut. Pass expectedRevision with the revision you ' +
    'last read — if a human has edited it since, the write is refused and you are ' +
    'told the real revision, so you can look at what they did instead of ' +
    'overwriting it.',
  annotations: { title: 'Update clip' },
  inputSchema: {
    type: 'object',
    properties: {
      clipId: { type: 'string', description: 'Which clip, e.g. "c2".' },
      expectedRevision: {
        type: 'number',
        description:
          'The revision you last saw on this clip. Strongly recommended — it is what stops ' +
          'you clobbering a human edit.',
      },
      startSentenceId: { type: 'string', description: 'New single range, first sentence.' },
      endSentenceId: { type: 'string', description: 'New single range, last sentence.' },
      segments: {
        type: 'array',
        description: 'Replace every segment. Each is {startSentenceId, endSentenceId}, inclusive.',
        items: {
          type: 'object',
          properties: {
            startSentenceId: { type: 'string' },
            endSentenceId: { type: 'string' },
          },
          required: ['startSentenceId', 'endSentenceId'],
        },
      },
      title: { type: 'string', description: 'New title.' },
      note: { type: 'string', description: 'New one-line note.' },
      pad: {
        type: 'number',
        description:
          'Seconds of breathing room added at each end of every segment, 0 to 2. Raise it if ' +
          'the cuts feel clipped; lower it if they feel slack.',
      },
      preview: { type: 'boolean', description: 'Play the revised clip. Default true.' },
    },
    required: ['clipId'],
    additionalProperties: false,
  },
  execute(args) {
    const missing = requireProject()
    if (missing) return fail(missing)

    const segments = readSegments(args)
    const result = updateClip({
      clipId: String(args.clipId),
      expectedRevision:
        typeof args.expectedRevision === 'number' ? args.expectedRevision : undefined,
      segments: segments ?? undefined,
      title: typeof args.title === 'string' ? args.title : undefined,
      note: typeof args.note === 'string' ? args.note : undefined,
      pad: typeof args.pad === 'number' ? args.pad : undefined,
      by: 'agent',
    })
    if ('error' in result) {
      logTool('update_clip', result.error, false)
      return fail(result.error, { currentRevision: result.currentRevision })
    }

    if (args.preview !== false) playClip(result.id)
    const view = clipView(result)
    const summary =
      'Updated ' + result.id + ' — ' + view.segmentCount + ' segment(s), ' +
      formatDuration(view.durationSeconds) + ' (revision ' + result.revision + ').'
    logTool('update_clip', summary)
    return ok(summary + '\n' + view.text, view)
  },
}

// ----------------------------------------------------------------- 8. cut

const cutClip: ToolDescriptor = {
  name: 'cut_clip',
  description:
    'Reduce a clip to a target duration by dropping sentences out of its middle, ' +
    'and write the result back to the same clip. Give it sentence ids to keep and ' +
    'it uses exactly those. Omit them and it falls back to the page\'s lexical ' +
    'pass, which is the Cut button — usable, but it cannot tell a throwaway aside ' +
    'from the payoff, so prefer choosing the sentences yourself.',
  annotations: { title: 'Cut clip to length' },
  inputSchema: {
    type: 'object',
    properties: {
      clipId: { type: 'string', description: 'The clip to cut down, usually a topic.' },
      expectedRevision: { type: 'number', description: 'The revision you last saw on it.' },
      keepSentenceIds: {
        type: 'array',
        description:
          'The sentences to keep, in any order. Runs of consecutive ids become one segment; ' +
          'every break between them becomes a cut. This is the good path — decide yourself.',
        items: { type: 'string' },
      },
      minSeconds: { type: 'number', description: 'Target floor. Default 30.' },
      maxSeconds: { type: 'number', description: 'Target ceiling. Default 60.' },
      note: { type: 'string', description: 'One line on what you kept and why.' },
      preview: { type: 'boolean', description: 'Play the cut. Default true.' },
    },
    required: ['clipId'],
    additionalProperties: false,
  },
  execute(args) {
    const missing = requireProject()
    if (missing) return fail(missing)

    const clip = getState().clips.find((c) => c.id === args.clipId)
    if (!clip) return fail('No clip with id "' + args.clipId + '".')

    const list = sentences()
    let keptIndices: number[]
    let how: string

    if (Array.isArray(args.keepSentenceIds) && args.keepSentenceIds.length) {
      const indices: number[] = []
      for (const raw of args.keepSentenceIds) {
        if (typeof raw !== 'string') continue
        const i = indexOfSentenceId(raw)
        if (i < 0 || i >= list.length) return fail('Unknown sentence id "' + raw + '".')
        indices.push(i)
      }
      if (!indices.length) return fail('keepSentenceIds had nothing usable in it.')
      keptIndices = indices
      how = 'your selection'
    } else {
      const pool = clipSentenceIndices(clip)
      const result = cutToDuration(list, pool, {
        minSeconds: Number(args.minSeconds) || undefined,
        maxSeconds: Number(args.maxSeconds) || undefined,
      })
      keptIndices = result.keptIndices
      how = 'the lexical pass'
    }

    const updated = updateClip({
      clipId: clip.id,
      expectedRevision:
        typeof args.expectedRevision === 'number' ? args.expectedRevision : undefined,
      segments: segmentsFromIndices(keptIndices),
      kind: 'cut',
      note: typeof args.note === 'string' ? args.note : undefined,
      by: 'agent',
    })
    if ('error' in updated) {
      logTool('cut_clip', updated.error, false)
      return fail(updated.error, { currentRevision: updated.currentRevision })
    }

    if (args.preview !== false) playClip(updated.id)
    const view = clipView(updated)
    const summary =
      'Cut ' + updated.id + ' to ' + formatDuration(view.durationSeconds) + ' using ' + how +
      ' — ' + view.segmentCount + ' segment(s), ' + view.droppedSentences +
      ' sentence(s) dropped (revision ' + updated.revision + ').'
    logTool('cut_clip', summary)
    return ok(summary + '\n' + view.text, view)
  },
}

// ------------------------------------------------------ 9. sentence edits

const editClipSentence: ToolDescriptor = {
  name: 'edit_clip_sentence',
  description:
    'Drop a single sentence out of a clip, or put one back. Dropping an interior ' +
    'sentence splits the clip into two segments with a gap where it was. This is ' +
    'the fine adjustment after the shape is roughly right — reach for it when the ' +
    'user says one specific line has to go or come back.',
  annotations: { title: 'Add or remove one sentence' },
  inputSchema: {
    type: 'object',
    properties: {
      clipId: { type: 'string', description: 'Which clip.' },
      sentenceId: { type: 'string', description: 'Which sentence, e.g. "s0031".' },
      action: {
        type: 'string',
        enum: ['remove', 'add'],
        description: 'remove drops it from the clip; add puts it back in transcript order.',
      },
      preview: { type: 'boolean', description: 'Play the result. Default true.' },
    },
    required: ['clipId', 'sentenceId', 'action'],
    additionalProperties: false,
  },
  execute(args) {
    const missing = requireProject()
    if (missing) return fail(missing)
    const clipId = String(args.clipId)
    const sentenceId = String(args.sentenceId)
    const action = args.action === 'add' ? 'add' : 'remove'

    const result =
      action === 'add'
        ? addSentence(clipId, sentenceId, 'agent')
        : removeSentence(clipId, sentenceId, 'agent')

    if ('error' in result) {
      logTool('edit_clip_sentence', result.error, false)
      return fail(result.error)
    }

    if (args.preview !== false) playClip(result.id)
    const view = clipView(result)
    const summary =
      (action === 'add' ? 'Put ' : 'Dropped ') + sentenceId +
      (action === 'add' ? ' back into ' : ' from ') + result.id + ' — now ' +
      view.segmentCount + ' segment(s), ' + formatDuration(view.durationSeconds) +
      ' (revision ' + result.revision + ').'
    logTool('edit_clip_sentence', summary)
    return ok(summary + '\n' + view.text, view)
  },
}

// ------------------------------------------------------------- 10. preview

const previewClip: ToolDescriptor = {
  name: 'preview_clip',
  description:
    'Play something in the player so the human can watch it. Give it a clipId to ' +
    'play a clip, gaps and all, or a pair of sentence ids to audition a range ' +
    "before committing to it. Playback happens in the user's tab; you get back " +
    'what you asked it to do, not the video.',
  annotations: { title: 'Preview or seek' },
  inputSchema: {
    type: 'object',
    properties: {
      clipId: { type: 'string', description: 'Play this existing clip, jumping its gaps.' },
      startSentenceId: {
        type: 'string',
        description: 'Play from this sentence. Use with endSentenceId to audition a range.',
      },
      endSentenceId: { type: 'string', description: 'Play up to and including this sentence.' },
      mode: {
        type: 'string',
        enum: ['play', 'seek'],
        description:
          'play (default) runs it and stops at the end. seek parks the playhead at the start.',
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
      if (!clip) return fail('No clip with id "' + args.clipId + '".')
      setActiveClip(clip.id)
      const ranges = clipRanges(clip)
      if (!ranges.length) return fail('That clip has no playable range.')
      if (mode === 'seek') seek(ranges[0].start)
      else void playRanges(ranges)

      const summary =
        (mode === 'seek' ? 'Moved the playhead to ' : 'Playing ') + clip.id + ' "' + clip.title +
        '" (' + formatDuration(clipDuration(clip)) + ', ' + ranges.length + ' piece(s)).'
      logTool('preview_clip', summary)
      return ok(summary, {
        clipId: clip.id,
        mode,
        ranges: ranges.map((r) => ({ startSeconds: round(r.start), endSeconds: round(r.end) })),
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
    else void playRanges([{ start: r.start.start, end: r.end.end }])

    const dur = r.end.end - r.start.start
    const summary =
      (mode === 'seek' ? 'Moved the playhead to ' : 'Playing ') + r.start.id + '-' + r.end.id +
      ' (' + formatDuration(dur) + '), and marked it in the transcript as an audition. ' +
      "The user's own anchor is untouched."
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
  suggestTopics,
  createClipTool,
  updateClipTool,
  cutClip,
  editClipSentence,
  previewClip,
]
