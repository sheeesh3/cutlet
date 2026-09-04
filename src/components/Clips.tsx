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
 * WebMCP is one-directional: an agent can call into this page, but the page
 * cannot call out to an agent. So these buttons cannot summon one. They run the
 * page's own lexical pass instead — which means they work in any browser, and
 * they leave the agent something concrete to improve rather than a blank rail.
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

export function ClipsRail() {
  const clips = useStore((s) => s.clips)
  const activeClipId = useStore((s) => s.activeClipId)
  const events = useStore((s) => s.toolEvents)
  const exporting = useStore((s) => s.exporting)
  const working = useStore((s) => s.working)
  const hasProject = useStore((s) => !!s.project)

  return (
    <div className={styles.pane}>
      <div className={`${styles.card} ${styles.clipsCard}`}>
        <div className={styles.head}>
          <span className={styles.title}>Clips</span>
          <span className={styles.count}>{clips.length}</span>
          <span className={styles.spacer} />
          <button
            className={styles.findBtn}
            onClick={findTopicsNow}
            disabled={!hasProject || working !== null}
          >
            {working === 'Finding clips' ? 'Finding…' : 'Find clips'}
          </button>
        </div>
        <div className={styles.body}>
          {!clips.length && (
            <p className={styles.empty}>
              Press <strong>Find clips</strong> for a first pass over the transcript, or
              anchor a sentence and ask the agent to build one around it.
            </p>
          )}
          {clips.map((clip) => (
            <ClipCard
              key={clip.id}
              clip={clip}
              active={clip.id === activeClipId}
              busy={working !== null}
              exporting={exporting?.clipId === clip.id ? exporting : null}
            />
          ))}
        </div>
      </div>

      <div className={`${styles.card} ${styles.activityCard}`}>
        <div className={styles.head}>
          <span className={styles.title}>Agent activity</span>
          <span className={styles.count}>{events.length}</span>
        </div>
        <div className={styles.body}>
          {!events.length && (
            <p className={styles.empty}>
              Tool calls from the agent appear here, so you can see what it did and why.
            </p>
          )}
          {events.map((e) => (
            <div key={e.id} className={styles.event}>
              <span className={`${styles.eventTool} ${e.ok ? '' : styles.eventToolError}`}>
                {e.tool}
              </span>
              <span className={styles.eventText}>{e.summary}</span>
            </div>
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
  exporting,
}: {
  clip: Clip
  active: boolean
  busy: boolean
  exporting: { stage: string; progress: number } | null
}) {
  const list = sentences()
  const ranges = clipRanges(clip)
  const span = clipSpan(clip)
  const duration = clipDuration(clip)
  const dropped = clipDropped(clip)
  const kept = clipSentenceIndices(clip)
  const spanLength = Math.max(0.001, span.end - span.start)

  const firstIndex = kept[0] ?? 0
  const lastIndex = kept[kept.length - 1] ?? 0

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

      <div className={styles.edges} onClick={(e) => e.stopPropagation()}>
        <div className={styles.edgeGroup}>
          <span className={styles.edgeLabel}>In</span>
          <button
            className={styles.nudge}
            onClick={() => nudge('start', -1)}
            disabled={firstIndex === 0}
            title="Start one sentence earlier"
          >
            −
          </button>
          <button
            className={styles.nudge}
            onClick={() => nudge('start', 1)}
            disabled={firstIndex >= lastIndex}
            title="Start one sentence later"
          >
            +
          </button>
        </div>

        <div className={styles.edgeGroup}>
          <span className={styles.edgeLabel}>Out</span>
          <button
            className={styles.nudge}
            onClick={() => nudge('end', -1)}
            disabled={lastIndex <= firstIndex}
            title="End one sentence earlier"
          >
            −
          </button>
          <button
            className={styles.nudge}
            onClick={() => nudge('end', 1)}
            disabled={lastIndex >= list.length - 1}
            title="End one sentence later"
          >
            +
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

      <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
        <button className={styles.action} onClick={() => playClip(clip.id)}>
          Play
        </button>
        {duration > 65 && (
          <button
            className={`${styles.action} ${styles.actionPrimary}`}
            onClick={() => cutClipNow(clip)}
            disabled={busy}
            title="Drop the weakest sentences until this fits 30–60s"
          >
            Cut to 30–60s
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
