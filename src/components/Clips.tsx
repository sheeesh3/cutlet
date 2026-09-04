import styles from './Clips.module.css'
import {
  useStore,
  setActiveClip,
  updateClip,
  deleteClip,
  createClip,
  clipRanges,
  clipSpan,
  clipDuration,
  clipDropped,
  clipText,
  clipSentenceIndices,
  segmentsFromIndices,
  sentences,
  setWorking,
  getState,
  logTool,
} from '../state/store'
import { playClip } from '../state/player'
import { formatTimecode, formatDuration } from '../transcript/sentences'
import { findTopics, cutToDuration } from '../edit/autoEdit'
import { exportClip } from '../export/exportClip'
import type { Clip } from '../types'

/**
 * The fallback for a browser with no agent in it.
 *
 * Finding clips is a judgement call and belongs to the agent — it reads the
 * transcript and decides, which is the whole point of this page. But WebMCP is
 * one-directional, so nothing here can summon an agent that is not already being
 * spoken to, and a page that does nothing at all in an ordinary browser is a
 * page nobody can evaluate. Hence a lexical pass, shown only when there is no
 * agent, and labelled as the rough thing it is.
 */
function findTopicsNow() {
  const list = sentences()
  if (!list.length) return
  setWorking('Finding clips')

  // A timeout, not requestAnimationFrame: rAF does not fire in a hidden tab, so
  // deferring that way leaves the button stuck on "Finding..." forever for
  // anyone who clicks and switches away. This still yields long enough for the
  // pressed state to paint when the tab is visible.
  setTimeout(() => {
    try {
      const existing = new Set(getState().clips.map((c) => c.segments[0]?.startSentenceId))
      const topics = findTopics(list)
      let added = 0
      for (const topic of topics) {
        const startId = list[topic.startIndex].id
        if (existing.has(startId)) continue
        createClip({
          segments: [{ startSentenceId: startId, endSentenceId: list[topic.endIndex].id }],
          kind: 'topic',
          title: topic.title,
          note: topic.note,
          by: 'auto',
        })
        added++
      }
      logTool(
        'find',
        added
          ? 'Lexical pass found ' + added + ' topic(s). The agent can judge them better.'
          : 'Lexical pass found nothing new.',
        added > 0
      )
    } finally {
      setWorking(null)
    }
  }, 0)
}

function cutClipNow(clip: Clip) {
  const list = sentences()
  setWorking('Cutting')
  setTimeout(() => {
    try {
      const pool = clipSentenceIndices(clip)
      const result = cutToDuration(list, pool)
      if (result.keptIndices.length === pool.length) {
        logTool('cut', clip.id + ' is already inside the target length.', false)
        return
      }
      const updated = updateClip({
        clipId: clip.id,
        segments: segmentsFromIndices(result.keptIndices),
        kind: 'cut',
        note:
          'Lexical cut to ' + formatDuration(result.seconds) + ', keeping ' +
          result.keptIndices.length + ' of ' + pool.length +
          ' sentences. Worth a second opinion.',
        by: 'auto',
      })
      if ('error' in updated) {
        logTool('cut', updated.error, false)
        return
      }
      logTool(
        'cut',
        'Cut ' + clip.id + ' to ' + formatDuration(clipDuration(updated)) + ' across ' +
          updated.segments.length + ' piece(s).'
      )
      playClip(clip.id)
    } finally {
      setWorking(null)
    }
  }, 0)
}

/**
 * The empty state is the instruction. There is no button that starts the agent
 * working — asking it is what starts it — so the rail's job before any clip
 * exists is to say what to ask for.
 */
function AskPanel() {
  return (
    <div className={styles.ask}>
      <ol className={styles.askSteps}>
        <li>
          <span className={styles.askSay}>“Find the best clips in this.”</span>
          <span className={styles.askThen}>
            It reads the whole transcript and decides how many are worth making. They
            land here, each with a title and why it works.
          </span>
        </li>
        <li>
          <span className={styles.askDo}>Click one to play it.</span>
          <span className={styles.askThen}>
            Clicking also selects it — that is how the agent knows what you mean by
            “this”.
          </span>
        </li>
        <li>
          <span className={styles.askSay}>“Cut this to forty seconds.”</span>
          <span className={styles.askThen}>
            It picks which lines survive. The rest are dropped, and you can see exactly
            which in the transcript.
          </span>
        </li>
        <li>
          <span className={styles.askDo}>Fix it yourself.</span>
          <span className={styles.askThen}>
            Drop or restore any line with the controls beside it, then say “tighten
            this” to hand it back.
          </span>
        </li>
      </ol>
    </div>
  )
}

function NoAgentPanel() {
  return (
    <div className={styles.ask}>
      <p className={styles.askLead}>
        This browser has no agent in it, so there is nothing to ask.
      </p>
      <p className={styles.askFoot}>
        Open the page in ChatGPT’s desktop browser and say “find the best clips in
        this”. Or press <strong>Rough pass</strong> for a lexical first cut — it
        matches vocabulary and pauses, it does not understand a word of it.
      </p>
    </div>
  )
}

export function ClipsRail() {
  const clips = useStore((s) => s.clips)
  const activeClipId = useStore((s) => s.activeClipId)
  const exporting = useStore((s) => s.exporting)
  const working = useStore((s) => s.working)
  const hasProject = useStore((s) => !!s.project)
  const connected = useStore((s) => s.mcpConnected)

  return (
    <div className={styles.pane}>
      <div className={`${styles.card} ${styles.clipsCard}`}>
        <div className={styles.head}>
          <span className={styles.title}>Clips</span>
          <span className={styles.count}>{clips.length}</span>
          <span className={styles.spacer} />
          {/* Only offered when there is no agent to ask. With one present, the
              ask is the interaction, and a mechanical button beside it would
              just be the worse of two options sitting in the better one's way. */}
          {!connected && (
            <button
              className={styles.findBtn}
              onClick={findTopicsNow}
              disabled={!hasProject || working !== null}
              title="A lexical pass over the transcript. No AI — it matches vocabulary, it does not understand anything."
            >
              {working === 'Finding clips' ? 'Finding…' : 'Rough pass'}
            </button>
          )}
        </div>
        <div className={styles.body}>
          {!clips.length && (connected ? <AskPanel /> : <NoAgentPanel />)}
          {clips.map((clip) => (
            <ClipCard
              key={clip.id}
              clip={clip}
              active={clip.id === activeClipId}
              busy={working !== null}
              connected={connected}
              exporting={exporting?.clipId === clip.id ? exporting : null}
            />
          ))}
        </div>
      </div>

    </div>
  )
}

function ClipCard({
  clip,
  active,
  busy,
  connected,
  exporting,
}: {
  clip: Clip
  active: boolean
  busy: boolean
  connected: boolean
  exporting: { stage: string; progress: number } | null
}) {
  const list = sentences()
  const ranges = clipRanges(clip)
  const span = clipSpan(clip)
  const duration = clipDuration(clip)
  const dropped = clipDropped(clip)
  const kept = clipSentenceIndices(clip)
  const spanLength = Math.max(0.001, span.end - span.start)

  // The earliest and latest sentence, not the first and last played — after a
  // reorder those are different, and nudging "the start" has to mean the start
  // of the material, not whichever piece happens to play first.
  const firstIndex = kept.length ? Math.min(...kept) : 0
  const lastIndex = kept.length ? Math.max(...kept) : 0

  /**
   * Moving an edge is a human edit, so it bumps the revision — which is exactly
   * what makes the agent's next update_clip come back rejected until it looks.
   */
  const nudge = (edge: 'start' | 'end', delta: number) => {
    const nextStart = edge === 'start' ? firstIndex + delta : firstIndex
    const nextEnd = edge === 'end' ? lastIndex + delta : lastIndex
    if (nextStart < 0 || nextEnd >= list.length || nextStart > nextEnd) return

    const inner = kept.filter((i) => i > firstIndex && i < lastIndex)
    const next = [...new Set([nextStart, ...inner, nextEnd])].filter(
      (i) => i >= nextStart && i <= nextEnd
    )
    updateClip({ clipId: clip.id, segments: segmentsFromIndices(next), by: 'human' })
    setActiveClip(clip.id)
  }

  const setPad = (pad: number) => {
    updateClip({ clipId: clip.id, pad, by: 'human' })
    setActiveClip(clip.id)
  }

  return (
    <div
      className={`${styles.clip} ${active ? styles.clipActive : ''}`}
      onClick={() => setActiveClip(clip.id)}
    >
      <div className={styles.clipTop}>
        <span className={styles.clipTitle}>{clip.title}</span>
        <span className={`${styles.badge} ${styles['badge_' + clip.lastEditedBy]}`}>
          {clip.lastEditedBy === 'auto' ? 'auto' : clip.lastEditedBy}
        </span>
      </div>

      <div className={styles.meta}>
        <span className={styles.kindTag}>{clip.kind}</span>
        <span>{formatTimecode(span.start)}</span>
        <span className={styles.strong}>{formatDuration(duration)}</span>
        {ranges.length > 1 && (
          <span title={dropped + ' sentence(s) cut out of the middle'}>
            {ranges.length} pieces
          </span>
        )}
        <span>r{clip.revision}</span>
      </div>

      {/* The cut itself: kept pieces against the span they were taken from. */}
      {ranges.length > 0 && (
        <div className={styles.segmentBar} title={ranges.length + ' piece(s) kept'}>
          {ranges.map((r, i) => (
            <span
              key={i}
              className={styles.segmentPiece}
              style={{
                left: `${((r.start - span.start) / spanLength) * 100}%`,
                width: `${Math.max(1.2, ((r.end - r.start) / spanLength) * 100)}%`,
              }}
            />
          ))}
        </div>
      )}

      {clip.note && <div className={styles.note}>{clip.note}</div>}
      <div className={styles.excerpt}>{clipText(clip)}</div>

      {/* Arrows, not plus and minus. With ± the same glyph meant "grow" on one
          edge and "shrink" on the other, which is a coin toss every time. An
          arrow means one thing on both: move this edge earlier, or later. */}
      <div className={styles.edges} onClick={(e) => e.stopPropagation()}>
        <div className={styles.edgeGroup}>
          <span className={styles.edgeLabel}>Starts</span>
          <button
            className={styles.nudge}
            onClick={() => nudge('start', -1)}
            disabled={firstIndex === 0}
            title="Start one sentence earlier — the clip grows"
            aria-label="Start one sentence earlier"
          >
            ←
          </button>
          <button
            className={styles.nudge}
            onClick={() => nudge('start', 1)}
            disabled={firstIndex >= lastIndex}
            title="Start one sentence later — the clip loses its first line"
            aria-label="Start one sentence later"
          >
            →
          </button>
        </div>

        <div className={styles.edgeGroup}>
          <span className={styles.edgeLabel}>Ends</span>
          <button
            className={styles.nudge}
            onClick={() => nudge('end', -1)}
            disabled={lastIndex <= firstIndex}
            title="End one sentence earlier — the clip loses its last line"
            aria-label="End one sentence earlier"
          >
            ←
          </button>
          <button
            className={styles.nudge}
            onClick={() => nudge('end', 1)}
            disabled={lastIndex >= list.length - 1}
            aria-label="End one sentence later"
            title="End one sentence later — the clip grows"
          >
            →
          </button>
        </div>

        <label className={styles.padGroup} title="Breathing room added at every cut">
          <span className={styles.edgeLabel}>Gap</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={clip.pad}
            onChange={(e) => setPad(Number(e.target.value))}
            className={styles.padSlider}
          />
          <span className={styles.padValue}>{clip.pad.toFixed(2)}s</span>
        </label>
      </div>

      {/* The selected clip is what "this" refers to, so the card says what to
          say. A button here would be a lie — nothing in the page can start the
          agent — but the referent is real, and naming the phrase turns a
          selection into an instruction the user does not have to invent. */}
      {active && connected && (
        <div className={styles.sayRow}>
          <span className={styles.sayLabel}>Say</span>
          <span className={styles.sayPhrases}>
            {clip.kind === 'topic' && duration > 65 ? (
              <>
                <code>“cut this to 40 seconds”</code>
                <code>“cut this, keep the part about …”</code>
              </>
            ) : clip.segments.length > 1 ? (
              // Once a clip has gaps, the useful ask changes: the agent can now
              // read the cut back as it plays and hear its own joins.
              <>
                <code>“read this back and check the joins”</code>
                <code>“put the last line back”</code>
              </>
            ) : (
              <>
                <code>“tighten this”</code>
                <code>“put the last line back”</code>
              </>
            )}
          </span>
        </div>
      )}

      <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
        <button className={styles.action} onClick={() => playClip(clip.id)}>
          Play
        </button>
        {!connected && duration > 65 && (
          <button
            className={styles.action}
            onClick={() => cutClipNow(clip)}
            disabled={busy}
            title="Lexical cut to 30-60s. No AI — ask an agent for a cut that makes sense."
          >
            Rough cut
          </button>
        )}
        <span className={styles.spacer} />
        <button className={styles.action} disabled={!!exporting} onClick={() => void exportClip(clip.id)}>
          {exporting ? 'Exporting' : 'Export'}
        </button>
        <button
          className={`${styles.action} ${styles.danger}`}
          onClick={() => deleteClip(clip.id)}
          title="Delete clip"
        >
          ×
        </button>
      </div>

      {exporting && (
        <>
          <div className={styles.progress}>
            <div
              className={styles.progressFill}
              style={{ width: `${Math.round(exporting.progress * 100)}%` }}
            />
          </div>
          <div className={styles.progressLabel}>{exporting.stage}</div>
        </>
      )}
    </div>
  )
}
