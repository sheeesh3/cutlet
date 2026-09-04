import { useEffect, useState } from 'react'
import styles from './Sequence.module.css'
import { useStore, clipRanges, clipDuration, sentenceById } from '../state/store'
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
 * Read-only on purpose. Every boundary in ClipClub is a sentence id, because an
 * id means the same thing to both parties and a dragged pixel does not. Dragging
 * an edge here would mint a cut point with no id, and the agent would lose the
 * vocabulary it needs to revise it. So the blocks are for seeing and seeking;
 * the edit still happens in the transcript, where the ids are.
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
          return (
            <div
              key={i}
              className={[
                styles.piece,
                clip.lastEditedBy === 'human' ? styles.human : styles.agent,
              ].join(' ')}
              style={{ flexBasis: `${width}%` }}
              // Seeking rather than dragging: the block says where a piece is,
              // and clicking it takes you there in the source.
              onClick={() => seek(r.start)}
              onDoubleClick={() => void playRanges(ranges.slice(i))}
              title={`${labels} · ${formatDuration(r.end - r.start)} — click to seek, double-click to play from here`}
            >
              <span className={styles.pieceIds}>{labels}</span>
              <span className={styles.pieceDur}>{formatDuration(r.end - r.start)}</span>
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
          gaps; the dropped lines are struck through in the transcript.
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
