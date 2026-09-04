import styles from './Clips.module.css'
import {
  useStore,
  setActiveClip,
  updateClip,
  deleteClip,
  clipRanges,
  clipSpan,
  clipDuration,
  clipDropped,
  clipText,
  clipSentenceIndices,
  segmentsFromIndices,
  sentences,
} from '../state/store'
import { playClip } from '../state/player'
import { formatTimecode } from '../transcript/sentences'
import { exportClip } from '../export/exportClip'
import type { Clip } from '../types'

/**
 * The empty state is the instruction. There is no button that starts the agent
 * working — asking it is what starts it — so the inspector's job before any
 * clip exists is to say what to ask for.
 */
function AskPanel() {
  return (
    <div className={styles.ask}>
      <ol className={styles.askSteps}>
        <li>
          <span className={styles.askSay}>“Find the best clips in this.”</span>
          <span className={styles.askThen}>
            It reads the whole transcript and decides how many are worth making. They
            land in the list, each with a title and why it works.
          </span>
        </li>
        <li>
          <span className={styles.askDo}>Click one to select it, double-click to play.</span>
          <span className={styles.askThen}>
            Selecting is how the agent knows what you mean by “this”.
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
        this”. Deciding which moments are worth a clip is the judgement this page
        does not make on its own — everything else here, you can do by hand.
      </p>
    </div>
  )
}

/** Every clip, one row each. Which one is selected is what the inspector shows. */
export function ClipsList() {
  const clips = useStore((s) => s.clips)
  const activeClipId = useStore((s) => s.activeClipId)

  return (
    <div className={styles.pane}>
      <div className={styles.head}>
        <span className={styles.title}>Clips</span>
        <span className={styles.count}>{clips.length}</span>
      </div>
      <div className={styles.body}>
        {!clips.length && <div className={styles.listEmpty}>No clips yet.</div>}
        {clips.map((clip) => (
          <ClipRow key={clip.id} clip={clip} active={clip.id === activeClipId} />
        ))}
      </div>
    </div>
  )
}

function ClipRow({ clip, active }: { clip: Clip; active: boolean }) {
  const ranges = clipRanges(clip)
  const span = clipSpan(clip)
  return (
    <div
      className={`${styles.row} ${active ? styles.rowActive : ''}`}
      onClick={() => setActiveClip(clip.id)}
      onDoubleClick={() => playClip(clip.id)}
      title="Click to select, double-click to play"
    >
      <span className={`${styles.rowBar} ${styles['bar_' + clip.lastEditedBy]}`} />
      <span className={styles.rowMain}>
        <span className={styles.rowTitle}>{clip.title}</span>
        <span className={styles.rowMeta}>
          {formatTimecode(span.start)} · {formatTimecode(clipDuration(clip))} ·{' '}
          {ranges.length === 1 ? '1 piece' : `${ranges.length} pieces`}
        </span>
      </span>
      <Who by={clip.lastEditedBy} />
    </div>
  )
}

function Who({ by }: { by: Clip['lastEditedBy'] }) {
  return (
    <span className={`${styles.who} ${styles['who_' + by]}`}>{by === 'human' ? 'you' : by}</span>
  )
}

/** The selected clip in full: what it is, what to say about it, how to trim it. */
export function ClipInspector() {
  const clips = useStore((s) => s.clips)
  const activeClipId = useStore((s) => s.activeClipId)
  const exporting = useStore((s) => s.exporting)
  const connected = useStore((s) => s.mcpConnected)
  const clip = clips.find((c) => c.id === activeClipId) ?? null

  return (
    <div className={styles.pane}>
      <div className={styles.head}>
        <span className={styles.title}>{clip ? 'Selected clip' : 'Clip'}</span>
        {clip && <span className={styles.kindTag}>{clip.kind}</span>}
        <span className={styles.spacer} />
        {clip && <Who by={clip.lastEditedBy} />}
      </div>
      <div className={styles.inspectorBody}>
        {clip ? (
          <ClipDetail
            clip={clip}
            connected={connected}
            exporting={exporting?.clipId === clip.id ? exporting : null}
          />
        ) : clips.length ? (
          <p className={styles.hint}>Select a clip to see it here, trim its edges, and export it.</p>
        ) : connected ? (
          <AskPanel />
        ) : (
          <NoAgentPanel />
        )}
      </div>
    </div>
  )
}

function ClipDetail({
  clip,
  connected,
  exporting,
}: {
  clip: Clip
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
  }

  const setPad = (pad: number) => {
    updateClip({ clipId: clip.id, pad, by: 'human' })
  }

  return (
    <div className={styles.detail}>
      <div className={styles.detailTitle}>{clip.title}</div>

      <div className={styles.meta}>
        <span>{formatTimecode(span.start)}</span>
        <span className={styles.strong}>{formatTimecode(duration)}</span>
        {ranges.length > 1 && (
          <span title={dropped + ' sentence(s) cut out of the middle'}>
            {ranges.length} pieces · {dropped} {dropped === 1 ? 'line' : 'lines'} cut
          </span>
        )}
      </div>

      {/* The cut itself: kept pieces against the span they were taken from. */}
      {ranges.length > 0 && (
        <div className={styles.segmentBar} title={ranges.length + ' piece(s) kept'}>
          {ranges.map((r, i) => (
            <span
              key={i}
              className={`${styles.segmentPiece} ${
                clip.lastEditedBy === 'human' ? '' : styles.segmentPieceAgent
              }`}
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
      <div className={styles.edges}>
        <div className={styles.edgeGroup}>
          <span className={styles.edgeLabel}>Start</span>
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
          <span className={styles.edgeLabel}>End</span>
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

      {/* The selected clip is what "this" refers to, so the panel says what to
          say. A button here would be a lie — nothing in the page can start the
          agent — but the referent is real, and naming the phrase turns a
          selection into an instruction the user does not have to invent. */}
      {connected && (
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

      <div className={styles.actions}>
        <button className={styles.action} onClick={() => playClip(clip.id)}>
          Play
        </button>
        <span className={styles.spacer} />
        <button
          className={`${styles.action} ${styles.actionPrimary}`}
          disabled={!!exporting}
          onClick={() => void exportClip(clip.id)}
        >
          {exporting ? 'Exporting' : 'Export'}
        </button>
        <button
          className={`${styles.action} ${styles.danger}`}
          onClick={() => deleteClip(clip.id)}
          title="Delete clip"
          aria-label="Delete clip"
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
