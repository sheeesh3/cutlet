import { useEffect } from 'react'
import styles from './ToolsSheet.module.css'
import { TOOLS } from '../mcp/register'
import { useStore } from '../state/store'

/**
 * Most browsers do not expose `document.modelContext` yet, so someone opening
 * this page has no way to see what it offers an agent. Rather than describe the
 * surface in prose somewhere else, the page reads its own registered tools and
 * shows them.
 */
export function ToolsSheet({ onClose }: { onClose: () => void }) {
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
        aria-label="Tools offered to the agent"
      >
        <div className={styles.head}>
          <span className={styles.title}>Tools offered to the agent</span>
          <span className={styles.sub}>{TOOLS.length} registered on this page</span>
          <span className={styles.spacer} />
          <button className={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className={styles.body}>
          <p className={styles.status}>
            {connected ? (
              <>
                <strong>This browser exposes WebMCP.</strong> The tools below are registered
                on the top-level document and an agent here can call them. Everything it does
                shows up in the agent activity panel.
              </>
            ) : (
              <>
                <strong>This browser does not expose WebMCP.</strong> ClipClub looks for{' '}
                <code>document.modelContext</code> and registers these tools when it finds it.
                Nothing here is disabled by its absence — every action an agent can take, you
                can take by hand.
              </>
            )}
          </p>

          {TOOLS.map((tool) => {
            const readOnly = tool.annotations?.readOnlyHint === true
            const props = Object.keys(
              (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}
            )
            return (
              <div key={tool.name} className={styles.tool}>
                <div className={styles.toolHead}>
                  <span className={styles.toolName}>{tool.name}</span>
                  <span
                    className={`${styles.kind} ${readOnly ? styles.kindRead : styles.kindWrite}`}
                  >
                    {readOnly ? 'read' : 'write'}
                  </span>
                </div>
                <div className={styles.toolDesc}>{tool.description}</div>
                {props.length > 0 && <div className={styles.args}>({props.join(', ')})</div>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
