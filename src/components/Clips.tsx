import styles from './Clips.module.css'
import {
  useStore,
  setActiveClip,
  updateClip,
  deleteClip,
  clipBounds,
  clipText,
  sentences,
  sentenceById,
} from '../state/store'
import { playClip } from '../state/player'
import { formatTimecode, formatDuration } from '../transcript/sentences'
import { exportClip } from '../export/exportClip'
import type { Clip } from '../types'

export function ClipsRail() {
  const clips = useStore((s) => s.clips)
  const activeClipId = useStore((s) => s.activeClipId)
  const events = useStore((s) => s.toolEvents)
  const exporting = useStore((s) => s.exporting)

  return (
    <div className={styles.pane}>
      <div className={`${styles.card} ${styles.clipsCard}`}>
        <div className={styles.head}>
          <span className={styles.title}>Clips</span>
          <span className={styles.count}>{clips.length}</span>
        </div>
        <div className={styles.body}>
          {!clips.length && (
            <p className={styles.empty}>
              No clips yet. Select a sentence in the transcript and make one, or ask the
              agent to build a clip around it.
            </p>
          )}
          {clips.map((clip) => (
            <ClipCard
              key={clip.id}
              clip={clip}
              active={clip.id === activeClipId}
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
  exporting,
}: {
  clip: Clip
  active: boolean
  exporting: { stage: string; progress: number } | null
}) {
  const bounds = clipBounds(clip)
  const list = sentences()
  const startIndex = sentenceById(clip.startSentenceId)?.index ?? 0
  const endIndex = sentenceById(clip.endSentenceId)?.index ?? 0

  /**
   * Moving an edge is a human edit, so it bumps the revision — which is exactly
   * what makes the agent's next `update_clip` come back rejected until it looks.
   */
  const nudge = (edge: 'start' | 'end', delta: number) => {
    const nextStart = edge === 'start' ? startIndex + delta : startIndex
    const nextEnd = edge === 'end' ? endIndex + delta : endIndex
    if (nextStart < 0 || nextEnd >= list.length || nextStart > nextEnd) return
    updateClip({
      clipId: clip.id,
      startSentenceId: list[nextStart].id,
      endSentenceId: list[nextEnd].id,
      by: 'human',
    })
    setActiveClip(clip.id)
  }

  return (
    <div
      className={`${styles.clip} ${active ? styles.clipActive : ''}`}
      onClick={() => setActiveClip(clip.id)}
    >
      <div className={styles.clipTop}>
        <span className={styles.clipTitle}>{clip.title}</span>
        <span
          className={`${styles.badge} ${
            clip.lastEditedBy === 'agent' ? styles.badgeAgent : styles.badgeHuman
          }`}
        >
          {clip.lastEditedBy}
        </span>
      </div>

      <div className={styles.meta}>
        <span>
          {clip.startSentenceId}–{clip.endSentenceId}
        </span>
        <span>{formatTimecode(bounds.start)}</span>
        <span>{formatDuration(bounds.end - bounds.start)}</span>
        <span>r{clip.revision}</span>
      </div>

      {clip.note && <div className={styles.note}>{clip.note}</div>}
      <div className={styles.excerpt}>{clipText(clip)}</div>

      <div className={styles.edges} onClick={(e) => e.stopPropagation()}>
        <div className={styles.edgeGroup}>
          <span className={styles.edgeLabel}>In</span>
          <button
            className={styles.nudge}
            onClick={() => nudge('start', -1)}
            disabled={startIndex === 0}
            title="Start one sentence earlier"
          >
            −
          </button>
          <button
            className={styles.nudge}
            onClick={() => nudge('start', 1)}
            disabled={startIndex >= endIndex}
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
            disabled={endIndex <= startIndex}
            title="End one sentence earlier"
          >
            −
          </button>
          <button
            className={styles.nudge}
            onClick={() => nudge('end', 1)}
            disabled={endIndex >= list.length - 1}
            title="End one sentence later"
          >
            +
          </button>
        </div>

        <span className={styles.spacer} />

        <button className={styles.action} onClick={() => playClip(clip.id)}>
          Play
        </button>
        <button
          className={styles.action}
          disabled={!!exporting}
          onClick={() => void exportClip(clip.id)}
        >
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
