import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTranscript } from './parse.ts'
import { buildSentences, indexOfSentenceId, sentenceId } from './sentences.ts'

const srt = `1
00:00:01,000 --> 00:00:04,200
We set sail on this new sea

2
00:00:04,500 --> 00:00:08,000
because there is new knowledge to be gained.
`

const vtt = `WEBVTT

00:00.000 --> 00:03.500
Why does Rice play Texas?

00:04.000 --> 00:07.250
We choose to go to the moon.
`

test('reads SRT cues as coarse timing', () => {
  const { words, source, coarse } = parseTranscript(srt, 'x.srt')
  assert.equal(source, 'srt')
  assert.equal(coarse, true)
  assert.equal(words.length, 2)
  assert.equal(words[0].start, 1)
  assert.equal(words[1].end, 8)
})

test('reads WebVTT, including mm:ss timestamps without an hours field', () => {
  const { words, source } = parseTranscript(vtt, 'x.vtt')
  assert.equal(source, 'vtt')
  assert.equal(words[1].start, 4)
  assert.equal(words[1].end, 7.25)
})

test('prefers nested word timings over the segments that contain them', () => {
  // The outer segments array parses as "words" whose text is a whole sentence.
  // Taking it would silently downgrade a word-level transcript to cue-level.
  const whisper = JSON.stringify({
    segments: [
      {
        start: 0,
        end: 2,
        text: 'Hello there.',
        words: [
          { word: ' Hello', start: 0, end: 0.6 },
          { word: ' there.', start: 0.6, end: 2 },
        ],
      },
    ],
  })
  const { words, coarse } = parseTranscript(whisper, 'x.json')
  assert.equal(coarse, false)
  assert.equal(words.length, 2)
  assert.equal(words[0].text, 'Hello')
})

test('prefers Deepgram punctuated_word over the bare word', () => {
  const deepgram = JSON.stringify({
    results: {
      channels: [
        {
          alternatives: [
            {
              words: [
                { word: 'this', punctuated_word: 'This', start: 0.1, end: 0.4 },
                { word: 'works', punctuated_word: 'works.', start: 0.4, end: 0.9 },
              ],
            },
          ],
        },
      ],
    },
  })
  const { words } = parseTranscript(deepgram, 'x.json')
  assert.deepEqual(words.map((w) => w.text), ['This', 'works.'])
})

test('falls back to segment timing when there are no word timings', () => {
  const raw = JSON.stringify({
    segments: [
      { start: 0, end: 3, text: 'Segments with no word timings.' },
      { start: 3.2, end: 6, text: 'Still usable, just coarse.' },
    ],
  })
  const { source, coarse, words } = parseTranscript(raw, 'x.json')
  assert.equal(source, 'segments-json')
  assert.equal(coarse, true)
  assert.equal(words.length, 2)
})

test('rejects JSON with no timings rather than inventing them', () => {
  assert.throws(() => parseTranscript('{"nothing":"useful"}', 'x.json'), /word or segment timings/)
})

// ------------------------------------------------------------- sentences

const words = (text: string, gap = 0.05) => {
  let t = 0
  return text.split(' ').map((w) => {
    const start = t
    t += 0.3 + gap
    return { text: w, start, end: start + 0.3 }
  })
}

test('splits on terminal punctuation, including short sentences', () => {
  const s = buildSentences(words('Hello there. General Kenobi.'))
  assert.equal(s.length, 2)
  assert.equal(s[0].text, 'Hello there.')
  assert.equal(s[1].text, 'General Kenobi.')
})

test('does not split on an abbreviation or an initial', () => {
  const s = buildSentences(words('We met Dr. Chen and John F. Kennedy today at noon.'))
  assert.equal(s.length, 1)
})

test('does not split on a rhetorical pause mid-clause', () => {
  // A long silence in the middle of a sentence, with no clause boundary before
  // it. Splitting here is what shreds oratory into fragments.
  const w = words('a sea of peace or a new terrifying theater of war.')
  const pauseAt = 6
  for (let i = pauseAt; i < w.length; i++) {
    w[i].start += 2
    w[i].end += 2
  }
  const s = buildSentences(w)
  assert.equal(s.length, 1)
})

test('ids are stable, ordered, and round-trip to their index', () => {
  const s = buildSentences(words('One two three. Four five six. Seven eight nine.'))
  assert.deepEqual(s.map((x) => x.id), ['s0001', 's0002', 's0003'])
  for (const x of s) assert.equal(indexOfSentenceId(x.id), x.index)
  assert.equal(sentenceId(41), 's0042')
})

test('sentence bounds follow the words they contain', () => {
  const s = buildSentences(words('One two three. Four five six.'))
  assert.equal(s[0].start, 0)
  assert.ok(s[1].start > s[0].end)
  for (const x of s) assert.ok(x.end > x.start)
})
