import { getModelContext } from './types.ts'
import type { ToolDescriptor, ToolResult } from './types.ts'
import { TOOLS } from './tools.ts'
import { setMcpConnected, logTool, getState } from '../state/store.ts'

let controller: AbortController | null = null

/**
 * Makes sure a refusal shows up in the activity log.
 *
 * Most tools log their own outcome in words better than anything generic, but
 * the early guards — "cut_clip needs keepSentenceIds", an unknown clip id —
 * return before reaching that line. Those are the most interesting failures to
 * watch: they are the page refusing something, which is the point of having
 * rules. A tool that already logged is left alone, detected by whether the log
 * grew while it ran rather than by comparing text.
 */
function withLogging(tool: ToolDescriptor): ToolDescriptor {
  return {
    ...tool,
    execute: (args) => {
      const before = getState().toolEvents[0]?.id ?? 0
      const finish = (result: ToolResult): ToolResult => {
        const after = getState().toolEvents[0]?.id ?? 0
        if (after === before && result.isError) {
          logTool(tool.name, result.content[0]?.text ?? 'Refused.', false)
        }
        return result
      }
      const result = tool.execute(args)
      return result instanceof Promise ? result.then(finish) : finish(result)
    },
  }
}

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
      const result = mc.registerTool(withLogging(tool), { signal }) as unknown
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        ;(result as Promise<unknown>).catch((err: unknown) => {
          console.warn(`[Cutlet] registerTool("${tool.name}") rejected`, err)
        })
      }
      registered++
    } catch (err) {
      console.warn(`[Cutlet] could not register tool "${tool.name}"`, err)
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
