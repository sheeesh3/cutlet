import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ToolDescriptor } from './types.ts'

/**
 * Registration is exercised through a fake `document.modelContext`, which is
 * what a browser with WebMCP in it provides. Defining it before the module
 * loads matters — `getModelContext` reads it at call time, but the store the
 * wrapper logs into must be the same instance the assertions read.
 */
const registered: Record<string, ToolDescriptor> = {}
;(globalThis as unknown as { document: unknown }).document = {
  modelContext: {
    registerTool(tool: ToolDescriptor) {
      registered[tool.name] = tool
    },
  },
}

const { registerTools } = await import('./register.ts')
const { getState, setProject, logTool } = await import('../state/store.ts')

setProject({
  name: 'fixture',
  videoUrl: 'blob:none',
  videoLabel: 'fixture',
  sentences: [
    { id: 's0001', index: 0, text: 'One.', start: 0, end: 1 },
    { id: 's0002', index: 1, text: 'Two.', start: 2, end: 3 },
  ],
  duration: 4,
})
registerTools()

test('every tool is registered on the document', () => {
  assert.ok(Object.keys(registered).length >= 9)
  assert.ok(registered.cut_clip)
  assert.ok(registered.read_transcript)
})

test('a refusal that returns before logging still reaches the activity log', async () => {
  const before = getState().toolEvents.length
  // cut_clip refuses an unknown clip id in a guard, before the line that logs.
  const result = await registered.cut_clip.execute({ clipId: 'nope' })
  assert.equal(result.isError, true)

  const events = getState().toolEvents
  assert.equal(events.length, before + 1, 'the refusal should have been logged')
  assert.equal(events[0].tool, 'cut_clip')
  assert.equal(events[0].ok, false)
  assert.match(events[0].summary, /nope/)
})

test('a tool that logs for itself is not logged twice', async () => {
  const before = getState().toolEvents.length
  await registered.get_editor_state.execute({})
  assert.equal(getState().toolEvents.length, before + 1)
})

test('the wrapper counts events, not text, so a repeat is still recorded', async () => {
  // Two identical refusals in a row are two things that happened, and the log
  // has to show both — de-duplicating on the message would hide the second.
  await registered.cut_clip.execute({ clipId: 'nope' })
  const before = getState().toolEvents.length
  await registered.cut_clip.execute({ clipId: 'nope' })
  assert.equal(getState().toolEvents.length, before + 1)
})

test('a success is left alone by the wrapper', async () => {
  logTool('marker', 'boundary')
  const before = getState().toolEvents.length
  await registered.read_transcript.execute({ detail: 'skim' })
  // read_transcript logs its own summary; the wrapper must not add a second.
  assert.equal(getState().toolEvents.length, before + 1)
  assert.equal(getState().toolEvents[0].ok, true)
})
