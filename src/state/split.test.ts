import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  setProject,
  splitSentence,
  createClip,
  clipText,
  clipDuration,
  deleteClip,
  sentenceById,
  getState,
} from './store.ts'
import { buildSentences } from '../transcript/sentences.ts'
import type { Word } from '../types.ts'

/**
 * A transcript with the failure this feature exists for: one run of words that
 * the recogniser never punctuated, so it arrives as a single long sentence.
 */
function words(): Word[] {
  const text =
    'we choose to go to the moon in this decade and do the other things ' +
    'not because they are easy but because they are hard.'
  return text.split(' ').map((w, i) => ({ text: w, start: i, end: i + 0.9 }))
}

function load() {
  const w = words()
  const sentences = buildSentences(w, { maxWords: 999 })
  setProject({
    name: 'fixture',
    videoUrl: 'blob:none',
    videoLabel: 'fixture',
    sentences,
    words: w,
    duration: w.length + 1,
  })
  for (const c of [...getState().clips]) deleteClip(c.id)
  return sentences
}

test('an unpunctuated run really does arrive as one sentence', () => {
  const list = load()
  assert.equal(list.length, 1)
  assert.equal(list[0].id, 's0001')
})

test('splitting makes the boundary the recogniser missed', () => {
  load()
  const result = splitSentence('s0001', 15, 'human')
  if ('error' in result) throw new Error(result.error)
  assert.equal(result.first.id, 's0001')
  assert.equal(result.first.text, 'we choose to go to the moon in this decade and do the other things')
  assert.equal(result.second.text, 'not because they are easy but because they are hard.')
  // The new half is addressable, which is the entire point.
  assert.equal(sentenceById(result.second.id)?.text, result.second.text)
})

test('the new id is not one already in use', () => {
  load()
  const result = splitSentence('s0001', 5, 'human')
  if ('error' in result) throw new Error(result.error)
  assert.notEqual(result.second.id, 's0001')
  assert.equal(getState().project?.sentences.length, 2)
})

test('ids keep meaning the same sentence after a split', () => {
  const list = load()
  const before = sentenceById('s0001')?.start
  splitSentence('s0001', 5, 'human')
  // s0001 still starts where it did; it is shorter, not somewhere else. An id
  // that quietly slid onto its neighbour is the failure this guards.
  assert.equal(sentenceById('s0001')?.start, before)
  assert.equal(sentenceById('s0001')?.text.startsWith('we choose'), true)
  void list
})

test('a clip holding the split sentence still holds every word of it', () => {
  load()
  const clip = createClip({
    segments: [{ startSentenceId: 's0001', endSentenceId: 's0001' }],
    by: 'human',
  })
  if ('error' in clip) throw new Error(clip.error)
  const textBefore = clipText(clip)
  const secondsBefore = clipDuration(clip)

  splitSentence('s0001', 15, 'human')

  const after = getState().clips[0]
  assert.equal(clipText(after), textBefore)
  assert.equal(Math.round(clipDuration(after)), Math.round(secondsBefore))
  // It reaches across both halves now.
  assert.equal(after.segments[0].startSentenceId, 's0001')
  assert.notEqual(after.segments[0].endSentenceId, 's0001')
})

test('splitting at the ends is refused — that is not a split', () => {
  load()
  assert.ok('error' in splitSentence('s0001', 0, 'human'))
  assert.ok('error' in splitSentence('s0001', 25, 'human'))
  assert.ok('error' in splitSentence('s0001', 1.5, 'human'))
})

test('an unknown sentence is refused by name', () => {
  load()
  const result = splitSentence('s9999', 3, 'human')
  assert.ok('error' in result && result.error.includes('s9999'))
})

test('a transcript with no words behind it says so rather than guessing', () => {
  const w = words()
  const sentences = buildSentences(w, { maxWords: 999 })
  setProject({
    name: 'no words',
    videoUrl: 'blob:none',
    videoLabel: 'no words',
    sentences: sentences.map((s) => ({ ...s, wordStart: undefined, wordEnd: undefined })),
    duration: 30,
  })
  const result = splitSentence('s0001', 4, 'human')
  assert.ok('error' in result && result.error.includes('word timings'))
})

test('a sentence can be split twice, and the halves stay addressable', () => {
  load()
  const first = splitSentence('s0001', 15, 'human')
  if ('error' in first) throw new Error(first.error)
  // 7, not 6: the count is how many words stay in the first half, so the
  // seventh word is the last one it keeps.
  const second = splitSentence('s0001', 7, 'human')
  if ('error' in second) throw new Error(second.error)

  const list = getState().project!.sentences
  assert.equal(list.length, 3)
  assert.deepEqual(
    list.map((s) => s.text),
    [
      'we choose to go to the moon',
      'in this decade and do the other things',
      'not because they are easy but because they are hard.',
    ]
  )
  // Every id resolves to its own sentence — no two share a position.
  const ids = list.map((s) => s.id)
  assert.equal(new Set(ids).size, 3)
  for (const s of list) assert.equal(sentenceById(s.id)?.text, s.text)
})
