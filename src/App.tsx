import { useEffect } from 'react'
import styles from './App.module.css'
import { Header, StatusBar } from './components/Header'
import { Player } from './components/Player'
import { Timeline } from './components/Timeline'
import { usePlaybackShortcuts } from './state/shortcuts'
import { Transcript } from './components/Transcript'
import { ClipsList, ClipInspector } from './components/Clips'
import { useStore } from './state/store'
import { loadDemoProject } from './state/loadProject'
import { registerTools } from './mcp/register'

/**
 * A cutting room: the viewer and the script side by side on top, the two
 * timelines across the bottom with the clip list and the selected clip either
 * side of them. The timeline strip is the spine — it is the one thing every
 * other pane is drawn against.
 */
export default function App() {
  const loading = useStore((s) => s.loading)
  const error = useStore((s) => s.error)

  usePlaybackShortcuts()

  useEffect(() => {
    void loadDemoProject()
  }, [])

  // Registered once, on the top-level document. Tools declared inside an iframe
  // are not discovered by the agent.
  useEffect(() => registerTools(), [])

  return (
    <div className={styles.app}>
      <Header />

      <div className={styles.top}>
        <section className={styles.viewer}>
          <Player />
        </section>
        <section className={styles.script}>
          {error ? (
            <div className={styles.notice}>
              <strong>Could not load the project.</strong>
              <span>{error}</span>
            </div>
          ) : loading ? (
            <div className={styles.notice}>Loading the demo project…</div>
          ) : (
            <Transcript />
          )}
        </section>
      </div>

      <div className={styles.timeline}>
        <section className={styles.clips}>
          <ClipsList />
        </section>
        <section className={styles.lanes}>
          <Timeline />
        </section>
        <section className={styles.inspector}>
          <ClipInspector />
        </section>
      </div>

      <StatusBar />
    </div>
  )
}
