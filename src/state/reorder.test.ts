import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  setProject,
  createClip,
  moveSegment,
  removeSegment,
  clipIsReordered,
  clipRanges,
  clipSpan,
  clipDuration,
  clipDropped,
  clipSentenceIndices,
  deleteClip,
  getState,
} from './store.ts'
import type { Clip, Sentence } from '../types.ts'

/** Ten one-second sentences, one second apart. */
function fixture(): Sentence[] {
  return Array.from({ length: 10 }, (_, i) => ({
    id: 's' + String(i + 1).padStart(4, '0'),
    index: i,
    text: 'Sentence ' + (i + 1) + '.',
    start: i * 2,
    end: i * 2 + 1,
  }))
}

function fresh(): Clip {
  for (const c of [...getState().clips]) deleteClip(c.id)
  const clip = createClip({
    segments: [
      { startSentenceId: 's0001', endSentenceId: 's0001' },
      { startSentenceId: 's0005', endSentenceId: 's0005' },
      { startSentenceId: 's0009', endSentenceId: 's0009' },
    ],
    by: 'human',
  })
  if ('error' in clip) throw new Error(clip.error)
  return clip
}

test.beforeEach(() => {
  setProject({
    name: 'fixture',
    videoUrl: 'blob:none',
    videoLabel: 'fixture',
    sentences: fixture(),
    duration: 20,
  })
})

test('a new clip is in transcript order however its segments arrive', () => {
  for (const c of [...getState().clips]) deleteClip(c.id)
  const clip = createClip({
    segments: [
      { startSentenceId: 's0009', endSentenceId: 's0009' },
      { startSentenceId: 's0001', endSentenceId: 's0001' },
    ],
    by: 'agent',
  })
  if ('error' in clip) throw new Error(clip.error)
  assert.deepEqual(clip.segments.map((s) => s.startSentenceId), ['s0001', 's0009'])
  assert.equal(clipIsReordered(clip), false)
})

test('moving a piece changes play order and nothing else', () => {
  const clip = fresh()
  const moved = moveSegment(clip.id, 0, 2, 'human')
  if ('error' in moved) throw new Error(moved.error)
  assert.deepEqual(moved.segments.map((s) => s.startSentenceId), ['s0005', 's0009', 's0001'])
  assert.equal(clipIsReordered(moved), true)
  // Same material, same running time — only the order moved.
  assert.deepEqual([...clipSentenceIndices(moved)].sort((a, b) => a - b), [0, 4, 8])
  assert.equal(clipDuration(moved), 3)
})

test('ranges come back in play order, not transcript order', () => {
  const clip = fresh()
  const moved = moveSegment(clip.id, 2, 0, 'human')
  if ('error' in moved) throw new Error(moved.error)
  assert.deepEqual(clipRanges(moved), [
    { start: 16, end: 17 },
    { start: 0, end: 1 },
    { start: 8, end: 9 },
  ])
})

test('span is earliest to latest even when play order is scrambled', () => {
  const clip = fresh()
  const moved = moveSegment(clip.id, 2, 0, 'human')
  if ('error' in moved) throw new Error(moved.error)
  // First piece played is at 16s, but the clip still spans 0-17.
  assert.deepEqual(clipSpan(moved), { start: 0, end: 17 })
})

test('dropped count survives a reorder', () => {
  const clip = fresh()
  const before = clipDropped(clip)
  const moved = moveSegment(clip.id, 0, 2, 'human')
  if ('error' in moved) throw new Error(moved.error)
  // Six sentences sit between the three kept ones, whatever order they play in.
  assert.equal(before, 6)
  assert.equal(clipDropped(moved), 6)
})

test('a reorder is not undone by the next ordinary edit', () => {
  const clip = fresh()
  const moved = moveSegment(clip.id, 0, 2, 'human')
  if ('error' in moved) throw new Error(moved.error)
  const after = removeSegment(moved.id, 0, 'human')
  if ('error' in after) throw new Error(after.error)
  assert.deepEqual(after.segments.map((s) => s.startSentenceId), ['s0009', 's0001'])
  assert.equal(clipIsReordered(after), true)
})

test('the last piece cannot be removed — that would be deleting the clip', () => {
  for (const c of [...getState().clips]) deleteClip(c.id)
  const clip = createClip({
    segments: [{ startSentenceId: 's0003', endSentenceId: 's0004' }],
    by: 'human',
  })
  if ('error' in clip) throw new Error(clip.error)
  const result = removeSegment(clip.id, 0, 'human')
  assert.ok('error' in result && result.error.includes('only piece'))
})

test('moving to a position that does not exist is refused', () => {
  const clip = fresh()
  assert.ok('error' in moveSegment(clip.id, 0, 7, 'human'))
  assert.ok('error' in moveSegment(clip.id, 5, 0, 'human'))
})

test('padding still merges pieces that genuinely run together', () => {
  for (const c of [...getState().clips]) deleteClip(c.id)
  // s0001 ends at 1s and s0002 starts at 2s; half a second of pad each side
  // closes that, and playing them as two pieces would seek backwards.
  const clip = createClip({
    segments: [
      { startSentenceId: 's0001', endSentenceId: 's0001' },
      { startSentenceId: 's0002', endSentenceId: 's0002' },
    ],
    pad: 0.5,
    by: 'agent',
  })
  if ('error' in clip) throw new Error(clip.error)
  assert.equal(clipRanges(clip).length, 1)
})
