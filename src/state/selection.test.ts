import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  setProject,
  setSelection,
  extendSelection,
  markAndStartNew,
  selectedSegments,
  selectedRanges,
  selectedDuration,
  getState,
} from './store.ts'
import type { Sentence } from '../types.ts'

/**
 * Ten one-second sentences with a one-second hole between each, so a gap in a
 * selection is visible in the arithmetic rather than only in the ids.
 */
function fixture(): Sentence[] {
  return Array.from({ length: 10 }, (_, i) => ({
    id: 's' + String(i + 1).padStart(4, '0'),
    index: i,
    text: 'Sentence ' + (i + 1) + '.',
    start: i * 2,
    end: i * 2 + 1,
  }))
}

test.beforeEach(() => {
  setProject({
    name: 'fixture',
    videoUrl: 'blob:none',
    videoLabel: 'fixture',
    sentences: fixture(),
    duration: 20,
  })
  setSelection(null)
})

test('a plain selection is one segment', () => {
  setSelection({ startSentenceId: 's0002', endSentenceId: 's0004' })
  assert.deepEqual(selectedSegments(), [{ startSentenceId: 's0002', endSentenceId: 's0004' }])
})

test('cmd-click banks the live range and starts another', () => {
  setSelection({ startSentenceId: 's0002', endSentenceId: 's0003' })
  markAndStartNew('s0008')
  assert.deepEqual(selectedSegments(), [
    { startSentenceId: 's0002', endSentenceId: 's0003' },
    { startSentenceId: 's0008', endSentenceId: 's0008' },
  ])
})

test('banked ranges that end up adjacent merge into one', () => {
  setSelection({ startSentenceId: 's0002', endSentenceId: 's0003' })
  markAndStartNew('s0004')
  // s0003 and s0004 touch, so this is one run — the UI has to say s0002-s0004
  // rather than claim two ranges the export would never produce.
  assert.deepEqual(selectedSegments(), [{ startSentenceId: 's0002', endSentenceId: 's0004' }])
})

test('marks survive a shift-click arriving before any re-render', () => {
  // The bug this guards: reading `marks` from a React render closure means a
  // second click in the same tick hands back a stale list and empties the bank.
  setSelection({ startSentenceId: 's0002', endSentenceId: 's0002' })
  extendSelection('s0003')
  markAndStartNew('s0007')
  extendSelection('s0008')
  assert.deepEqual(selectedSegments(), [
    { startSentenceId: 's0002', endSentenceId: 's0003' },
    { startSentenceId: 's0007', endSentenceId: 's0008' },
  ])
})

test('extending with nothing selected starts a selection rather than throwing', () => {
  extendSelection('s0005')
  assert.deepEqual(selectedSegments(), [{ startSentenceId: 's0005', endSentenceId: 's0005' }])
})

test('a plain click clears the bank — it means start again', () => {
  setSelection({ startSentenceId: 's0002', endSentenceId: 's0002' })
  markAndStartNew('s0008')
  setSelection({ startSentenceId: 's0005', endSentenceId: 's0005' })
  assert.equal(getState().marks.length, 0)
  assert.deepEqual(selectedSegments(), [{ startSentenceId: 's0005', endSentenceId: 's0005' }])
})

test('duration counts the pieces, not the span they sit in', () => {
  setSelection({ startSentenceId: 's0001', endSentenceId: 's0001' })
  markAndStartNew('s0009')
  assert.deepEqual(selectedRanges(), [
    { start: 0, end: 1 },
    { start: 16, end: 17 },
  ])
  // The span is 17 seconds; only two of them are kept.
  assert.equal(selectedDuration(), 2)
})

test('marking out of order still reads in transcript order', () => {
  setSelection({ startSentenceId: 's0008', endSentenceId: 's0008' })
  markAndStartNew('s0002')
  assert.deepEqual(selectedSegments(), [
    { startSentenceId: 's0002', endSentenceId: 's0002' },
    { startSentenceId: 's0008', endSentenceId: 's0008' },
  ])
})

test('nothing selected is no segments, not a segment of nothing', () => {
  assert.deepEqual(selectedSegments(), [])
  assert.equal(selectedDuration(), 0)
})
