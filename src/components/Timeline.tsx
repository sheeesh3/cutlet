import { useEffect, useMemo, useState } from 'react'
import styles from './Timeline.module.css'
import {
  useStore,
  clipRanges,
  clipDuration,
  sentenceById,
  moveSegment,
  removeSegment,
  clipIsReordered,
  logTool,
} from '../state/store'
import { onTimeUpdate, seek, playRanges, cutTimeOf } from '../state/player'
import { formatTimecode } from '../transcript/sentences'
import type { Clip, Range } from '../types'

/**
 * The two timelines, stacked under a shared ruler.
 *
 * The source lane is the recording: everything drawn against the whole
 * duration, so a cut appears as islands with the dropped material still taking
 * up room between them. The sequence lane is the same cut with the gaps closed,
 * laid out in the time it actually plays for. One shows where the material
 * came from, the other how the edit runs — you are holding both at once, so
 * both are on screen at once.
 */
export function Timeline() {
  const project = useStore((s) => s.project)
  const clips = useStore((s) => s.clips)
  const activeClipId = useStore((s) => s.activeClipId)
  const selection = useStore((s) => s.selection)
  const audition = useStore((s) => s.audition)
  const [time, setTime] = useState(0)

  useEffect(() => onTimeUpdate(setTime), [])

  const duration = project?.duration ?? 0
  const pct = (t: number) => (duration > 0 ? (t / duration) * 100 : 0)

  const ticks = useMemo(() => {
    if (duration <= 0) return []
    const step = tickStep(duration)
    const out: { t: number; major: boolean }[] = []
    for (let i = 0; i * step <= duration; i++) out.push({ t: i * step, major: i % 2 === 0 })
    return out
  }, [duration])

  const boundsOf = (range: { startSentenceId: string; endSentenceId: string } | null) => {
    if (!range) return null
    const a = sentenceById(range.startSentenceId)
    const b = sentenceById(range.endSentenceId)
    if (!a || !b) return null
    return { start: a.start, end: b.end }
  }
  const selectionBounds = boundsOf(selection)
  const auditionBounds = boundsOf(audition)

  const scrubTo = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    seek(ratio * duration)
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.ruler} aria-hidden="true">
        {ticks.map(({ t, major }) => (
          <span key={t}>
            <span
              className={`${styles.tick} ${major ? styles.tickMajor : ''}`}
              style={{ left: `${pct(t)}%` }}
            />
            {/* The last label would hang off the right edge of the ruler. */}
            {major && pct(t) < 95 && (
              <span className={styles.tickLabel} style={{ left: `${pct(t)}%` }}>
                {formatTimecode(t)}
              </span>
            )}
          </span>
        ))}
      </div>

      <div className={styles.lane}>
        <div className={styles.gutter}>
          Source
          <span className={styles.gutterMeta}>{formatTimecode(duration)}</span>
        </div>
        <div className={styles.track} onClick={scrubTo} role="presentation" title="Click to seek">
          {/* One block per sentence, so the lane shows where the talking is
              rather than a flat rule that says nothing. */}
          {(project?.sentences ?? []).map((s) => (
            <div
              key={s.id}
              className={styles.speech}
              style={{
                left: `${pct(s.start)}%`,
                width: `${Math.max(0.15, pct(s.end - s.start))}%`,
              }}
            />
          ))}

          {/* One band per kept piece, so the gaps a cut leaves are visible on
              the lane rather than implied by a single span. */}
          {clips.flatMap((clip) =>
            clipRanges(clip).map((r, i) => (
              <div
                key={clip.id + ':' + i}
                className={[
                  styles.band,
                  clip.id === activeClipId &&
                    (clip.lastEditedBy === 'human' ? styles.bandActiveHuman : styles.bandActiveAgent),
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{ left: `${pct(r.start)}%`, width: `${Math.max(0.4, pct(r.end - r.start))}%` }}
                title={`${clip.id} · ${clip.title}`}
              />
            ))
          )}

          {auditionBounds && (
            <div
              className={styles.auditionBand}
              style={{
                left: `${pct(auditionBounds.start)}%`,
                width: `${Math.max(0.3, pct(auditionBounds.end - auditionBounds.start))}%`,
              }}
            />
          )}

          {selectionBounds && (
            <div
              className={styles.selectionBand}
              style={{
                left: `${pct(selectionBounds.start)}%`,
                width: `${Math.max(0.3, pct(selectionBounds.end - selectionBounds.start))}%`,
              }}
            />
          )}

          <div className={styles.playhead} style={{ left: `${pct(time)}%` }} />
        </div>
      </div>

      <SequenceLane time={time} />
    </div>
  )
}

/** Minor tick spacing that keeps the ruler to about twenty ticks. */
function tickStep(duration: number): number {
  for (const step of [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800]) {
    if (duration / step <= 20) return step
  }
  return 3600
}

/**
 * You can move a piece earlier or later here, or drop it, but you cannot drag
 * its edges — and the difference is the whole design. Reordering permutes
 * segments that keep the sentence ids they always had, so every edge of the
 * result is still nameable: the agent can read it back, revise it, and argue
 * about it. Dragging an edge would mint a cut point at some pixel with no id
 * attached, and that boundary would be invisible to the half of this interface
 * that speaks in ids. Trimming therefore stays in the transcript, where the
 * ids are; arranging happens here, where the shape is.
 */
function SequenceLane({ time }: { time: number }) {
  const clips = useStore((s) => s.clips)
  const activeClipId = useStore((s) => s.activeClipId)

  const clip = clips.find((c) => c.id === activeClipId) ?? null
  const ranges = clip ? clipRanges(clip) : []
  const total = clip ? clipDuration(clip) : 0

  // An empty lane rather than no lane: the layout should not jump the moment
  // a clip is selected, and the empty lane can say what fills it.
  if (!clip || !ranges.length || total <= 0) {
    return (
      <div className={styles.lane}>
        <div className={styles.gutter}>Sequence</div>
        <div className={`${styles.track} ${styles.trackEmpty}`}>
          Select a clip to see it as it plays, gaps closed.
        </div>
      </div>
    )
  }

  const playhead = cutTimeOf(time, ranges)
  const reordered = clipIsReordered(clip)
  const cuts = ranges.length - 1

  const move = (from: number, to: number) => {
    const result = moveSegment(clip.id, from, to, 'human')
    if ('error' in result) logTool('move', result.error, false)
  }
  const drop = (at: number) => {
    const result = removeSegment(clip.id, at, 'human')
    if ('error' in result) logTool('remove', result.error, false)
  }

  return (
    <>
      <div className={styles.lane}>
        <div className={styles.gutter}>
          Sequence
          <span className={styles.gutterMeta}>{formatTimecode(total)}</span>
        </div>
        <div className={`${styles.track} ${styles.seqTrack}`}>
          {ranges.map((r, i) => {
            const width = ((r.end - r.start) / total) * 100
            const labels = edgeIds(clip, r)
            return (
              <div
                key={i}
                className={`${styles.piece} ${
                  clip.lastEditedBy === 'human' ? styles.pieceHuman : styles.pieceAgent
                }`}
                style={{ flexBasis: `${width}%` }}
                // Seeking rather than dragging an edge: a dragged edge would be a
                // cut point with no sentence id, and neither you nor the agent
                // could name it afterwards. Whole pieces move instead.
                onClick={() => seek(r.start)}
                onDoubleClick={() => void playRanges(ranges.slice(i))}
                title={`${labels} · ${formatTimecode(r.end - r.start)} — click to seek, double-click to play from here`}
              >
                <span className={styles.pieceIds}>{labels}</span>
                <span className={styles.pieceDur}>{formatTimecode(r.end - r.start)}</span>
                <span className={styles.pieceSpacer} />
                {/* On screen, not hover-revealed. Hidden, reordering was a
                    feature nobody found and the lane read as decoration. */}
                {ranges.length > 1 && (
                  <span className={styles.pieceTools} onClick={(e) => e.stopPropagation()}>
                    <button
                      className={styles.pieceBtn}
                      onClick={() => move(i, i - 1)}
                      disabled={i === 0}
                      title="Move this piece earlier in the cut"
                      aria-label={`Move piece ${i + 1} earlier`}
                    >
                      ◀
                    </button>
                    <button
                      className={styles.pieceBtn}
                      onClick={() => move(i, i + 1)}
                      disabled={i === ranges.length - 1}
                      title="Move this piece later in the cut"
                      aria-label={`Move piece ${i + 1} later`}
                    >
                      ▶
                    </button>
                    <button
                      className={`${styles.pieceBtn} ${styles.pieceDrop}`}
                      onClick={() => drop(i)}
                      title="Drop this piece from the cut"
                      aria-label={`Drop piece ${i + 1}`}
                    >
                      ×
                    </button>
                  </span>
                )}
              </div>
            )
          })}

          {playhead !== null && (
            <div
              className={styles.playhead}
              style={{ left: `calc(4px + (100% - 8px) * ${playhead / total})` }}
            />
          )}
        </div>
      </div>

      <div className={styles.note}>
        {cuts === 0
          ? 'One piece, no cuts.'
          : `${cuts === 1 ? '1 cut' : `${cuts} cuts`} · playback jumps the gaps · plays ${formatTimecode(total)}`}
        {' · '}
        {reordered ? (
          <strong className={styles.reordered}>
            out of transcript order — plays as shown, not as said
          </strong>
        ) : (
          'pieces in transcript order'
        )}
      </div>
    </>
  )
}

/** The sentence ids at a piece's edges, which is how you say where a cut is. */
function edgeIds(clip: Clip, range: Range): string {
  // Padding can merge two segments into one played range, so a piece's edges
  // are found from the times rather than assumed to be one segment's.
  let first: string | null = null
  let last: string | null = null
  for (const seg of clip.segments) {
    const a = sentenceById(seg.startSentenceId)
    const b = sentenceById(seg.endSentenceId)
    if (!a || !b) continue
    if (b.end < range.start - 0.01 || a.start > range.end + 0.01) continue
    if (!first) first = seg.startSentenceId
    last = seg.endSentenceId
  }
  if (!first || !last) return '—'
  return first === last ? first : `${first}–${last}`
}
