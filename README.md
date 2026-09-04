# ClipClub

**Find the moments. Cut them down together. Then fix the cut by pointing at
words.**

A rough-cut video editor an agent drives, built on
[WebMCP](https://github.com/webmachinelearning/webmcp). You say what you want;
the agent reads the transcript, decides which moments are worth a clip, and cuts
them down. Its clips appear in the page, where you play them, argue with them,
and fix them line by line.

The agent does the judging. The page does the editing, the playing and the
exporting, and keeps both of you honest about who changed what.

---

## The flow

**Find** → "find the best clips in this". The agent skims the whole transcript in
one call, picks the stretches that stand on their own, reads those in full, and
creates a clip for each with a title and a reason.

**Cut** → "cut the moon one to forty seconds". The agent names the sentences that
survive; everything between them is dropped. That is the edit: a clip becomes
several pieces with gaps, and playback jumps the gaps.

**Fix** → every dropped sentence stays visible in the transcript, struck
through, with a control to put it back. Every kept one has a control to drop it.
A gap slider adds breathing room at each cut.

**Export** → each piece is encoded separately then joined, plus an `.srt` rebased
across the whole cut.

## Anchor and expand

1. **You anchor.** Click the sentence that has to survive.
2. **The agent expands.** It reads a window around your anchor and proposes a
   clip as a range of *sentence ids* — `s0009–s0013` — never floating timestamps.
3. **You watch it.** The player runs exactly those pieces and stops at the end.
4. **You move an edge**, or drop a line.
5. **The agent works from what is actually there.** Its next write carries the
   revision it last saw. Yours bumped it, so the write is refused, with the real
   revision in the error. It reads the state and revises from your edit.

```
cut_clip     c2  keep s0008,s0010,s0011,s0013  → revision 2, 3 pieces, 37s
             ↓ human drops s0011 in the transcript → revision 5
cut_clip     c2  expectedRevision 4             → REFUSED
             "it is now 5. Someone edited it in the UI."
get_editor_state                                → sees the real cut
```

**The anchor is yours.** When the agent auditions a range it has not committed
to, that range is drawn separately — dashed, in the agent's blue — beside your
anchor rather than on top of it.

## Asking is the interface

There is no "find clips" button, because there cannot be one. WebMCP is
one-directional: an agent calls into a page, and a page has no way to call out to
an agent — no `requestAgent`, no sampling, no elicitation. ChatGPT's
implementation says why, and it is a decision rather than a gap: *"the design
prioritizes user agency — the agent responds to user requests rather than
websites initiating actions."*

So the trigger is you asking, and the page's job before any clip exists is to
tell you what to ask for. That is what the empty rail does.

### The fallback, for browsers with no agent

Open the deployed page in ordinary Chrome and there is nothing to ask, so a
**Rough pass** button appears in place of the prompts. It runs a lexical pass:

- **Finding topics** splits where the vocabulary turns over, in the manner of
  TextTiling — compare the words either side of each sentence boundary, cut where
  the overlap dips. A long pause corroborates a weak seam; it never decides one
  alone, because oratory pauses mid-thought.
- **Cutting** scores sentences on how distinctive their vocabulary is within the
  topic, then grows a selection from the strongest, favouring sentences adjacent
  to something already kept and marking down any that open on "but", "so" or
  "they" when the thing they refer to is being dropped.

It knows which words are unusual and where the speaker paused. It does not know
what any of it means, and it is not what this project is for — it exists so the
page is not inert for someone without a compatible browser. Its clips are badged
`auto`, drawn the quietest of the three, and the button disappears entirely once
an agent is present. `get_guidelines` tells the agent to replace those clips
rather than tidy them.

## The nine tools

Registered on the **top-level document** — tools declared inside an iframe are
not discovered.

| Tool | | What it is for |
|---|---|---|
| `get_editor_state` | read | Video, anchor, audition, every clip with its segments and revision. |
| `read_transcript` | read | Sentences in full, or `detail: "skim"` for the whole recording at once. |
| `search_transcript` | read | Find a moment in a long recording, with context around each hit. |
| `get_guidelines` | read | The editorial rules: topics vs cuts, what makes a cut land. |
| `create_clip` | write | One range for a topic, or a segment list for a cut. |
| `update_clip` | write | Replace segments, retitle, set the gap padding. Takes `expectedRevision`. |
| `cut_clip` | write | Keep the sentences you name, drop the rest. No automatic mode. |
| `edit_clip_sentence` | write | Drop or restore one sentence. Splits a segment if it is interior. |
| `preview_clip` | write | Play a clip including its gaps, or audition a range. |

Read tools carry `annotations.readOnlyHint`.

**Why sentence ids and not timestamps.** An id is stable and means the same thing
to both parties; a timestamp is a number the agent would have to compute and
would get subtly wrong at boundaries. Ids also make a bad cut legible — you can
see that `s0014` was left out.

## Keyboard

The transcript is a listbox with one tab stop. Arrows move the anchor a sentence
at a time, shift-arrow extends it, Home and End jump to the ends, Enter plays
what is anchored. Space plays and pauses, left and right scrub (hold shift for
ten seconds), Escape drops the anchor.

## Scope, honestly

- **Preview is the source video**, played piece by piece. Nothing is rendered to
  preview.
- **Export re-encodes each piece**, then joins them by stream copy. `-c copy` on
  the trim would only cut on a keyframe, sliding the in-point away from the
  sentence boundary the whole app is built on; re-encoding the join instead would
  cost a second generation for nothing.
- **No agent-side delete.** If the agent makes a bad clip, you remove it.
- **No transcription in the browser.** Bring a transcript; no API keys ship in
  the client.

## Privacy, stated precisely

Your video never leaves the tab. It is decoded by the browser and exported by
`ffmpeg.wasm` in-page; there is no backend and nothing is uploaded.

The transcript windows that tools return **are** shared with the agent — that is
what the agent reads to do its job. Nothing else is.

## Running it

```bash
npm install
npm run dev
```

Opens on **http://localhost:4920** (pinned; it fails rather than drifting to
another port). `npm run check` runs lint, build and tests.

`npm run build` produces a static `dist/`. There is no server side.

### The ffmpeg core

`scripts/sync-ffmpeg.mjs` copies the single-thread `@ffmpeg/core` out of
`node_modules` into `public/ffmpeg/` before dev and build. It is not committed —
the wasm is 31MB.

Two details that cost real time to find:

- It must be the **ESM** build. Bundlers spawn ffmpeg.wasm's worker as a module
  worker, where `importScripts` does not exist, so the loader falls back to a
  dynamic `import()` — which a UMD bundle cannot satisfy.
- The core must be handed over as **blob URLs** via `toBlobURL`. A bare path gets
  rewritten by the dev server (`ffmpeg-core.js?import`) and 404s.

Single-thread means no `SharedArrayBuffer`, which means **no COOP/COEP headers**,
which is why this deploys to plain static hosting.

## Trying it with an agent

Open the page in a browser that exposes `document.modelContext`. The header pill
reads **Agent tools live** when registration succeeded, and **Agent tools
unavailable** otherwise — click it either way to see the tools the page offers.

Then just ask:

> Find the best clips in this.

It skims the transcript, reads the promising stretches in full, and creates a
clip for each with a title and a reason. Then:

> Cut the moon one to about forty seconds, keep the "why does Rice play Texas"
> line, and end on "we intend to win".

Watch the **Agent activity** panel: every tool call is logged there.

## The demo project

President John F. Kennedy at Rice University, 12 September 1962 — the "We choose
to go to the Moon" speech. A 6m21s excerpt.

Source: [Internet Archive](https://archive.org/details/president-john-f.-kennedy-09-12-1962),
credited to Rice University, **CC Public Domain Mark 1.0**. Transcript generated
locally with Whisper (medium.en, word timestamps).

**Open your own video** takes any video plus a transcript — word-level JSON
(Whisper/Deepgram shape), SRT, or VTT. Word-level timings give the best sentence
boundaries; subtitle cues work but are coarser.

## Stack

Vite · React · TypeScript · CSS Modules · `@ffmpeg/ffmpeg`. Zero backend, no UI
library, no state library, no test framework — Node runs the TypeScript tests
directly.
