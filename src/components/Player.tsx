import { useEffect, useRef, useState } from 'react'
import styles from './Player.module.css'
import { useStore, clipRanges, clipDuration, sentenceById } from '../state/store'
import {
  attachVideo,
  onTimeUpdate,
  onQueueChange,
  toggle,
  seek,
  getVideo,
} from '../state/player'
import { formatTimecode, formatDuration } from '../transcript/sentences'

export function Player() {
  const project = useStore((s) => s.project)
  const clips = useStore((s) => s.clips)
  const activeClipId = useStore((s) => s.activeClipId)
  const selection = useStore((s) => s.selection)
  const audition = useStore((s) => s.audition)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [time, setTime] = useState(0)
  const [paused, setPaused] = useState(true)
  const [piece, setPiece] = useState({ index: 0, total: 0 })

  useEffect(() => {
    attachVideo(videoRef.current)
    return () => attachVideo(null)
  }, [project?.videoUrl])

  useEffect(() => onTimeUpdate(setTime), [])
  useEffect(() => onQueueChange((index, total) => setPiece({ index, total })), [])

  const duration = project?.duration ?? 0
  const pct = (t: number) => (duration > 0 ? (t / duration) * 100 : 0)

  const activeClip = clips.find((c) => c.id === activeClipId) ?? null
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
      <div className={styles.stage}>
        {project ? (
          <video
            ref={videoRef}
            className={styles.video}
            src={project.videoUrl}
            preload="auto"
            playsInline
            onPlay={() => setPaused(false)}
            onPause={() => setPaused(true)}
            onLoadedMetadata={() => setTime(getVideo()?.currentTime ?? 0)}
            onClick={toggle}
          />
        ) : (
          <div className={styles.empty}>No video loaded</div>
        )}

        {activeClip && (
          <div className={styles.rangeBadge}>
            <span className={styles.rangeDot} />
            <span className={styles.rangeName}>{activeClip.title}</span>
            <span>{formatDuration(clipDuration(activeClip))}</span>
            {piece.total > 1 && (
              <span className={styles.piece}>
                piece {piece.index + 1}/{piece.total}
              </span>
            )}
          </div>
        )}
      </div>

      <div className={styles.transport}>
        <button className={styles.play} onClick={toggle} aria-label={paused ? 'Play' : 'Pause'}>
          {paused ? (
            <svg width="12" height="13" viewBox="0 0 12 13" fill="currentColor">
              <path d="M2 1.5v10l9-5z" />
            </svg>
          ) : (
            <svg width="11" height="12" viewBox="0 0 11 12" fill="currentColor">
              <rect x="1" y="1" width="3" height="10" rx="1" />
              <rect x="7" y="1" width="3" height="10" rx="1" />
            </svg>
          )}
        </button>
        <span className={styles.time}>
          <span className={styles.timeNow}>{formatTimecode(time)}</span>
          {' / '}
          {formatTimecode(duration)}
        </span>
        <span className={styles.spacer} />
        <span className={styles.hint}>Space to play · click a sentence to seek</span>
      </div>

      <div className={styles.strip} onClick={scrubTo} role="presentation">
        {/* One block per sentence, so the strip shows where the talking is
            rather than a flat rule that says nothing. */}
        {(project?.sentences ?? []).map((s) => (
          <div
            key={s.id}
            className={styles.speech}
            style={{ left: `${pct(s.start)}%`, width: `${Math.max(0.15, pct(s.end - s.start))}%` }}
          />
        ))}

        {/* One band per kept piece, so the gaps a cut leaves are visible on the
            strip rather than implied by a single span. */}
        {clips.flatMap((clip) =>
          clipRanges(clip).map((r, i) => (
            <div
              key={clip.id + ':' + i}
              className={[
                styles.clipBand,
                clip.id === activeClipId &&
                  (clip.lastEditedBy === 'human'
                    ? styles.clipBandActiveHuman
                    : styles.clipBandActiveAgent),
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
  )
}
