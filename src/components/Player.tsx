import { useEffect, useRef, useState } from 'react'
import styles from './Player.module.css'
import { useStore, clipRanges, clipDuration } from '../state/store'
import { attachVideo, onTimeUpdate, onQueueChange, toggle, getVideo, cutTimeOf } from '../state/player'
import { formatTimecode } from '../transcript/sentences'

export function Player() {
  const project = useStore((s) => s.project)
  const clips = useStore((s) => s.clips)
  const activeClipId = useStore((s) => s.activeClipId)

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
  const activeClip = clips.find((c) => c.id === activeClipId) ?? null
  const cutTime = activeClip ? cutTimeOf(time, clipRanges(activeClip)) : null
  const inId = activeClip?.segments[0]?.startSentenceId
  const outId = activeClip?.segments[activeClip.segments.length - 1]?.endSentenceId

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

        {/* Where the playhead is in the cut's own time, when it is inside the
            cut at all. Outside it, the clip is still named — you are looking
            at material it threw away. */}
        {activeClip && (
          <div className={styles.badge}>
            <span className={styles.badgeDot} />
            <span className={styles.badgeName}>{activeClip.title}</span>
            {piece.total > 1 && (
              <span>
                piece {piece.index + 1}/{piece.total}
              </span>
            )}
            <span>
              {cutTime !== null ? `${formatTimecode(cutTime)} / ` : ''}
              {formatTimecode(clipDuration(activeClip))}
            </span>
          </div>
        )}
      </div>

      <div className={styles.transport}>
        <button className={styles.play} onClick={toggle} aria-label={paused ? 'Play' : 'Pause'}>
          {paused ? (
            <svg width="12" height="13" viewBox="0 0 12 13" fill="currentColor" aria-hidden="true">
              <path d="M2 1.5v10l9-5z" />
            </svg>
          ) : (
            <svg width="11" height="12" viewBox="0 0 11 12" fill="currentColor" aria-hidden="true">
              <rect x="1" y="1" width="3" height="10" rx="1" />
              <rect x="7" y="1" width="3" height="10" rx="1" />
            </svg>
          )}
        </button>
        <span className={styles.time}>
          <span className={styles.timeNow}>{formatClock(time)}</span>
          {' / '}
          {formatClock(duration)}
        </span>
        <span className={styles.spacer} />
        {/* The clip's edges, named the way the agent names them. */}
        {activeClip && inId && outId && (
          <span className={styles.inOut}>
            In <code>{inId}</code> · Out <code>{outId}</code>
          </span>
        )}
        <span className={styles.keys} aria-hidden="true">
          <kbd title="Back five seconds">J</kbd>
          <kbd title="Play or pause">K</kbd>
          <kbd title="Forward five seconds">L</kbd>
          <span className={styles.keyGap} />
          <kbd title="Play or pause">Space</kbd>
        </span>
      </div>
    </div>
  )
}

/** mm:ss.t — tenths, because a sentence boundary is finer than a second. */
function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const t = Math.floor((seconds % 1) * 10)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${h > 0 ? h + ':' : ''}${pad(m)}:${pad(s)}.${t}`
}
