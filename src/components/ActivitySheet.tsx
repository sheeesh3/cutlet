import { useEffect } from 'react'
import styles from './ToolsSheet.module.css'
import own from './ActivitySheet.module.css'
import { useStore } from '../state/store'

/**
 * Every tool call the agent has made, on demand.
 *
 * This used to be a panel pinned under the clips rail, which cost a permanent
 * third of that column to something you only look at when you want to know what
 * just happened. Behind a button it can be full height and readable instead of
 * always visible and cramped.
 */
export function ActivitySheet({ onClose }: { onClose: () => void }) {
  const events = useStore((s) => s.toolEvents)
  const connected = useStore((s) => s.mcpConnected)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className={styles.backdrop} onClick={onClose} role="presentation">
      <div
        className={styles.sheet}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Agent activity"
      >
        <div className={styles.head}>
          <span className={styles.title}>Agent activity</span>
          <span className={styles.sub}>
            {events.length ? `${events.length} tool call${events.length === 1 ? '' : 's'}` : 'nothing yet'}
          </span>
          <span className={styles.spacer} />
          <button className={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className={styles.body}>
          {!events.length && (
            <p className={styles.status}>
              {connected ? (
                <>
                  <strong>No tool calls yet.</strong> Ask the agent for something — “find the
                  best clips in this” — and every call it makes lands here, in order, with what
                  it did and whether it worked.
                </>
              ) : (
                <>
                  <strong>There is no agent in this browser.</strong> This is where its tool
                  calls would appear. Your own edits are not logged here — only the agent’s.
                </>
              )}
            </p>
          )}

          {events.map((e) => (
            <div key={e.id} className={own.event}>
              <div className={own.eventHead}>
                <span className={`${own.tool} ${e.ok ? '' : own.toolError}`}>{e.tool}</span>
                {!e.ok && <span className={own.failed}>failed</span>}
                <span className={styles.spacer} />
                <span className={own.at}>{clockTime(e.at)}</span>
              </div>
              <p className={own.summary}>{e.summary}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Wall-clock, because the useful question is "was that before or after I did X". */
function clockTime(at: number): string {
  const d = new Date(at)
  return (
    String(d.getHours()).padStart(2, '0') +
    ':' +
    String(d.getMinutes()).padStart(2, '0') +
    ':' +
    String(d.getSeconds()).padStart(2, '0')
  )
}
