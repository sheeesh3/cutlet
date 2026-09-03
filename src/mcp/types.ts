/**
 * Minimal structural types for the WebMCP surface. We deliberately do not
 * depend on a global type package — the API is young, and a page that hard
 * depends on its typings is a page that fails to build when they move.
 */
export interface ToolResultContent {
  type: 'text'
  text: string
}

export interface ToolResult {
  content: ToolResultContent[]
  structuredContent?: unknown
  isError?: boolean
}

export interface ToolDescriptor {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: Record<string, unknown>
  execute: (args: Record<string, unknown>) => Promise<ToolResult> | ToolResult
}

export interface ModelContext {
  registerTool: (
    tool: ToolDescriptor,
    options?: { signal?: AbortSignal }
  ) => Promise<unknown> | unknown
}

declare global {
  interface Document {
    modelContext?: ModelContext
  }
}

export function getModelContext(): ModelContext | null {
  if (typeof document === 'undefined') return null
  const mc = document.modelContext
  if (mc && typeof mc.registerTool === 'function') return mc
  // Some builds expose it on navigator while the shape settles. Accept either;
  // the page must never assume one of them exists.
  const nav = (navigator as unknown as { modelContext?: ModelContext }).modelContext
  if (nav && typeof nav.registerTool === 'function') return nav
  return null
}

export function ok(text: string, structuredContent?: unknown): ToolResult {
  return { content: [{ type: 'text', text }], structuredContent }
}

export function fail(text: string, structuredContent?: unknown): ToolResult {
  return { content: [{ type: 'text', text }], structuredContent, isError: true }
}
