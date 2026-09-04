import { useRef, useState } from 'react'
import styles from './Header.module.css'
import { APP_NAME } from '../brand'
import { useStore } from '../state/store'
import { loadLocalProject } from '../state/loadProject'
import { ToolsSheet } from './ToolsSheet'
import { ActivitySheet } from './ActivitySheet'
import { TOOLS } from '../mcp/register'

export function Header() {
  const project = useStore((s) => s.project)
  const connected = useStore((s) => s.mcpConnected)
  const events = useStore((s) => s.toolEvents.length)
  const [showTools, setShowTools] = useState(false)
  const [showActivity, setShowActivity] = useState(false)

  const videoInput = useRef<HTMLInputElement | null>(null)
  const transcriptInput = useRef<HTMLInputElement | null>(null)
  const [pendingVideo, setPendingVideo] = useState<File | null>(null)

  const onVideo = (file: File | undefined) => {
    if (!file) return
    setPendingVideo(file)
    transcriptInput.current?.click()
  }

  const onTranscript = (file: File | undefined) => {
    if (!file || !pendingVideo) return
    void loadLocalProject(pendingVideo, file)
    setPendingVideo(null)
  }

  return (
    <header className={styles.bar}>
      <div className={styles.brand}>
        <span className={styles.name}>
          {APP_NAME}
          <span className={styles.dot}>.</span>
        </span>
      </div>

      {project && <span className={styles.project}>{project.videoLabel}</span>}

      <span className={styles.spacer} />

      <button
        className={styles.activity}
        onClick={() => setShowActivity(true)}
        title="Every tool call the agent has made"
      >
        Activity
        {/* The count is the point of putting this in the header: you can see the
            agent has done something without opening anything. */}
        {events > 0 && <span className={styles.activityCount}>{events}</span>}
      </button>

      <button
        className={`${styles.pill} ${connected ? styles.pillLive : ''}`}
        onClick={() => setShowTools(true)}
        title={`See the ${TOOLS.length} tools this page offers an agent`}
      >
        <span className={`${styles.statusDot} ${connected ? styles.statusDotLive : ''}`} />
        {connected ? 'Agent tools live' : 'Agent tools unavailable'}
      </button>

      {showTools && <ToolsSheet onClose={() => setShowTools(false)} />}
      {showActivity && <ActivitySheet onClose={() => setShowActivity(false)} />}

      <button className={styles.btn} onClick={() => videoInput.current?.click()}>
        Open your own video
      </button>

      <input
        ref={videoInput}
        type="file"
        accept="video/*"
        className={styles.hidden}
        onChange={(e) => onVideo(e.target.files?.[0])}
      />
      <input
        ref={transcriptInput}
        type="file"
        accept=".json,.srt,.vtt,text/plain,application/json"
        className={styles.hidden}
        onChange={(e) => onTranscript(e.target.files?.[0])}
      />
    </header>
  )
}

export function Footnote() {
  const project = useStore((s) => s.project)
  return (
    <div className={styles.footnote}>
      <strong>Your video never leaves this tab.</strong>
      <span>
        It is decoded and exported in the browser. The transcript windows you or the agent
        read are shared with the agent — nothing else is.
      </span>
      <span className={styles.spacer} />
      {project?.attribution && <span>{project.attribution}</span>}
    </div>
  )
}
