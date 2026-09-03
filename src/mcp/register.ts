import { getModelContext } from './types'
import { TOOLS } from './tools'
import { setMcpConnected, logTool } from '../state/store'

let controller: AbortController | null = null

/**
 * Registers every tool on the top-level page. Tools registered inside an iframe
 * are not discovered by the agent, so this must only ever be called from the
 * main document.
 *
 * Returns a teardown function. Safe to call when WebMCP is absent — the page is
 * fully usable by hand, and simply reports itself as not connected.
 */
export function registerTools(): () => void {
  const mc = getModelContext()
  if (!mc) {
    setMcpConnected(false)
    return () => {}
  }

  controller?.abort()
  controller = new AbortController()
  const { signal } = controller

  let registered = 0
  for (const tool of TOOLS) {
    try {
      // Some implementations return a promise; we do not need to await it, but
      // we must not let a rejection escape as an unhandled error.
      const result = mc.registerTool(tool, { signal }) as unknown
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        ;(result as Promise<unknown>).catch((err: unknown) => {
          console.warn(`[ClipClub] registerTool("${tool.name}") rejected`, err)
        })
      }
      registered++
    } catch (err) {
      console.warn(`[ClipClub] could not register tool "${tool.name}"`, err)
    }
  }

  const connected = registered > 0
  setMcpConnected(connected)
  if (connected) {
    logTool('webmcp', `Registered ${registered} tools on this page.`)
  }

  return () => {
    controller?.abort()
    controller = null
    setMcpConnected(false)
  }
}

export { TOOLS }
