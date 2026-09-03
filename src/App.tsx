import { useEffect } from 'react'
import styles from './App.module.css'
import { Header, Footnote } from './components/Header'
import { Player, usePlaybackShortcuts } from './components/Player'
import { Transcript } from './components/Transcript'
import { ClipsRail } from './components/Clips'
import { useStore } from './state/store'
import { loadDemoProject } from './state/loadProject'
import { registerTools } from './mcp/register'

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
      <main className={styles.main}>
        <section className={styles.left}>
          <Player />
        </section>
        <section className={styles.centre}>
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
        <section className={styles.right}>
          <ClipsRail />
        </section>
      </main>
      <Footnote />
    </div>
  )
}
