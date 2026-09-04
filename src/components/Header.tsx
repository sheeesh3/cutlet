import { useEffect, useState } from 'react'
import styles from './Header.module.css'
import { APP_NAME } from '../brand'
import { useStore } from '../state/store'
import { loadLibrary, loadLibraryEntry } from '../state/loadProject'
import type { LibraryEntry } from '../state/loadProject'
import { ToolsSheet } from './ToolsSheet'
import { ActivitySheet } from './ActivitySheet'
import { TOOLS } from '../mcp/register'
import { useTheme, toggleTheme } from '../state/theme'

export function Header() {
  const project = useStore((s) => s.project)
  const connected = useStore((s) => s.mcpConnected)
  const events = useStore((s) => s.toolEvents.length)
  const theme = useTheme()
  const [showTools, setShowTools] = useState(false)
  const [showActivity, setShowActivity] = useState(false)
  const [library, setLibrary] = useState<LibraryEntry[]>([])

  useEffect(() => {
    void loadLibrary().then(setLibrary)
  }, [])

  return (
    <header className={styles.bar}>
      <span className={styles.name}>
        {APP_NAME}
        <span className={styles.dot}>.</span>
      </span>

      {/* A picker only once there is a choice to make — with one entry it would
          be a dropdown that does nothing. */}
      {library.length > 1 ? (
        <span className={styles.pick}>
          <select
            className={styles.library}
            value={library.find((e) => project?.name === e.title)?.id ?? ''}
            onChange={(e) => {
              const entry = library.find((x) => x.id === e.target.value)
              if (entry) void loadLibraryEntry(entry)
            }}
            aria-label="Which recording"
          >
            {library.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.title}
                {entry.speaker ? ` — ${entry.speaker}` : ''}
              </option>
            ))}
          </select>
          <ChevronIcon className={styles.chev} />
        </span>
      ) : (
        project && <span className={styles.project}>{project.videoLabel}</span>
      )}

      <span className={styles.spacer} />

      <button
        className={styles.icon}
        onClick={toggleTheme}
        title={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
        aria-label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
      >
        {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
      </button>

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
    </header>
  )
}

/**
 * The privacy claim, stated precisely, in the one line a status bar allows:
 * the video never leaves; the transcript windows the agent reads do.
 */
export function StatusBar() {
  const project = useStore((s) => s.project)
  return (
    <div className={styles.status}>
      <span className={styles.statusItem}>
        <LockIcon />
        Your video never leaves this tab
        <span className={styles.statusDetail}>
          {' '}
          — only the transcript windows the agent reads are shared, nothing else
        </span>
      </span>
      <span className={styles.spacer} />
      {project?.attribution && <span className={styles.statusItem}>{project.attribution}</span>}
    </div>
  )
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6l4 4 4-4" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13.5 9.6A5.6 5.6 0 0 1 6.4 2.5a5.6 5.6 0 1 0 7.1 7.1z" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" />
    </svg>
  )
}
