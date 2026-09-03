import { useEffect, useRef, useState } from 'react'
import styles from './Player.module.css'
import { useStore, clipBounds, sentenceById, getState, setSelection } from '../state/store'
import { attachVideo, onTimeUpdate, toggle, seek, getVideo } from '../state/player'
import { formatTimecode } from '../transcript/sentences'

export function Player() {
  const project = useStore((s) => s.project)
  const clips = useStore((s) => s.clips)
  const activeClipId = useStore((s) => s.activeClipId)
  const selection = useStore((s) => s.selection)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [time, setTime] = useState(0)
  const [paused, setPaused] = useState(true)

  useEffect(() => {
    attachVideo(videoRef.current)
    return () => attachVideo(null)
  }, [project?.videoUrl])

  useEffect(() => onTimeUpdate(setTime), [])

  const duration = project?.duration ?? 0
  const pct = (t: number) => (duration > 0 ? (t / duration) * 100 : 0)

  const activeClip = clips.find((c) => c.id === activeClipId) ?? null
  const selectionBounds = (() => {
    if (!selection) return null
    const a = sentenceById(selection.startSentenceId)
    const b = sentenceById(selection.endSentenceId)
    if (!a || !b) return null
    return { start: a.start, end: b.end }
  })()

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
            <span>
              {activeClip.startSentenceId}–{activeClip.endSentenceId}
            </span>
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
        <div className={styles.speech} style={{ left: '0%', right: '0%' }} />

        {clips.map((clip) => {
          const b = clipBounds(clip)
          return (
            <div
              key={clip.id}
              className={`${styles.clipBand} ${clip.id === activeClipId ? styles.clipBandActive : ''}`}
              style={{ left: `${pct(b.start)}%`, width: `${Math.max(0.4, pct(b.end - b.start))}%` }}
              title={`${clip.id} · ${clip.title}`}
            />
          )
        })}

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

/** Space toggles playback unless the user is typing. */
export function usePlaybackShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (target?.isContentEditable) return
      if (e.code === 'Space') {
        e.preventDefault()
        toggle()
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const v = getVideo()
        if (!v) return
        e.preventDefault()
        const step = e.shiftKey ? 10 : 3
        seek(v.currentTime + (e.key === 'ArrowRight' ? step : -step))
      }
      if (e.key === 'Escape' && getState().selection) setSelection(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
