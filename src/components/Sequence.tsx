import { useEffect, useState } from 'react'
import styles from './Sequence.module.css'
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
import { onTimeUpdate, seek, playRanges } from '../state/player'
import { formatDuration } from '../transcript/sentences'
import type { Clip, Range } from '../types'

/**
 * The second timeline.
 *
 * The strip in the player is the *source*: everything drawn against the whole
 * recording, so a cut appears as islands with the dropped material still taking
 * up room between them. This is the *sequence*: the same cut with the gaps
 * closed, laid out in the time it actually plays for. It is the visual half of
 * `read_transcript scope:"clip"` — one shows the agent how the edit reads, this
 * shows the human how it runs.
 *
 * You can move a piece earlier or later here, or drop it, but you cannot drag
 * its edges — and the difference is the whole design. Reordering permutes
 * segments that keep the sentence ids they always had, so every edge of the
 * result is still nameable: the agent can read it back, revise it, and argue
 * about it. Dragging an edge would mint a cut point at some pixel with no id
 * attached, and that boundary would be invisible to the half of this interface
 * that speaks in ids. Trimming therefore stays in the transcript, where the ids
 * are; arranging happens here, where the shape is.
 */
export function Sequence() {
  const clips = useStore((s) => s.clips)
  const activeClipId = useStore((s) => s.activeClipId)
  const [time, setTime] = useState(0)

  useEffect(() => onTimeUpdate(setTime), [])

  const clip = clips.find((c) => c.id === activeClipId) ?? null
  if (!clip) return null

  const ranges = clipRanges(clip)
  const total = clipDuration(clip)
  if (!ranges.length || total <= 0) return null

  const playhead = cutTimeOf(time, ranges)
  const reordered = clipIsReordered(clip)

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.label}>Sequence</span>
        <span className={styles.name}>{clip.title}</span>
        <span className={styles.spacer} />
        <span className={styles.meta}>
          {ranges.length === 1 ? '1 piece' : `${ranges.length} pieces`} ·{' '}
          {formatDuration(total)}
        </span>
      </div>

      <div className={styles.track}>
        {ranges.map((r, i) => {
          const width = ((r.end - r.start) / total) * 100
          const labels = edgeIds(clip, r)
          const move = (to: number) => {
            const result = moveSegment(clip.id, i, to, 'human')
            if ('error' in result) logTool('move', result.error, false)
          }
          return (
            <div
              key={i}
              className={[
                styles.piece,
                clip.lastEditedBy === 'human' ? styles.human : styles.agent,
              ].join(' ')}
              style={{ flexBasis: `${width}%` }}
              // Seeking rather than dragging an edge: a dragged edge would be a
              // cut point with no sentence id, and neither you nor the agent
              // could name it afterwards. Whole pieces move instead.
              onClick={() => seek(r.start)}
              onDoubleClick={() => void playRanges(ranges.slice(i))}
              title={`${labels} · ${formatDuration(r.end - r.start)} — click to seek, double-click to play from here`}
            >
              <span className={styles.pieceIds}>{labels}</span>
              <span className={styles.pieceDur}>{formatDuration(r.end - r.start)}</span>

              {ranges.length > 1 && (
                <span className={styles.pieceTools} onClick={(e) => e.stopPropagation()}>
                  <button
                    className={styles.pieceBtn}
                    onClick={() => move(i - 1)}
                    disabled={i === 0}
                    title="Move this piece earlier in the cut"
                    aria-label={`Move piece ${i + 1} earlier`}
                  >
                    ◀
                  </button>
                  <button
                    className={styles.pieceBtn}
                    onClick={() => move(i + 1)}
                    disabled={i === ranges.length - 1}
                    title="Move this piece later in the cut"
                    aria-label={`Move piece ${i + 1} later`}
                  >
                    ▶
                  </button>
                  <button
                    className={`${styles.pieceBtn} ${styles.pieceDrop}`}
                    onClick={() => {
                      const result = removeSegment(clip.id, i, 'human')
                      if ('error' in result) logTool('remove', result.error, false)
                    }}
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
          <div className={styles.playhead} style={{ left: `${(playhead / total) * 100}%` }} />
        )}
      </div>

      {ranges.length > 1 && (
        <p className={styles.note}>
          {ranges.length - 1 === 1 ? 'One cut' : `${ranges.length - 1} cuts`}. Playback jumps the
          gaps. Hover a piece to move it earlier or later, or drop it.
          {reordered && (
            <>
              {' '}
              <strong className={styles.reordered}>Out of transcript order</strong> — this cut
              plays its pieces in the order shown, not the order they were said.
            </>
          )}
        </p>
      )}
    </div>
  )
}

/**
 * Where the playhead sits in the cut's own time, or null when the source
 * playhead is somewhere this cut threw away — in which case showing nothing is
 * more honest than pinning it to an edge.
 */
function cutTimeOf(t: number, ranges: Range[]): number | null {
  let elapsed = 0
  for (const r of ranges) {
    if (t >= r.start && t <= r.end) return elapsed + (t - r.start)
    elapsed += r.end - r.start
  }
  return null
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
