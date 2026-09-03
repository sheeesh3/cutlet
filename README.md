# ClipClub

**Select the moment. Let the agent build the story around it. Watch it together,
then cut by pointing at words.**

A rough-cut video editor that an agent can drive, built on
[WebMCP](https://github.com/webmachinelearning/webmcp). The page registers seven
tools with the browser's agent; the agent reads and structures the transcript,
you judge pacing in the footage, and you both edit the same visible cut.

It is not an "AI clip finder". The interesting part is the handoff.

---

## The interaction: anchor and expand

1. **You anchor.** Click the sentence that has to survive.
2. **The agent expands.** It reads a window of the transcript around your anchor
   and proposes a clip as a contiguous range of *sentence ids* — `s0009–s0013` —
   never a floating timestamp.
3. **You watch it.** The player runs exactly that range and stops at the end.
4. **You move an edge.** One click on the clip's in/out control.
5. **The agent works from what is actually there.** Its next write carries the
   revision it last saw. Yours bumped it, so the write is refused, with the real
   revision in the error. It reads the state and revises from your edit instead
   of overwriting it.

That last step is the whole point. A clip is shared state, and the human's edit
is the brief.

```
create_clip  s0009–s0013                       → revision 1
update_clip  s0009–s0011  expectedRevision 1   → revision 2
             ↓ human drags the out point in the UI → revision 3
update_clip  s0009–s0011  expectedRevision 2   → REFUSED
             "you expected revision 2, it is now 3. Someone edited it in the UI.
              Call get_editor_state and decide again from the real range."
get_editor_state                               → sees s0009–s0012
update_clip  s0009–s0013  expectedRevision 3   → revision 4
```

## The seven tools

Registered on the **top-level document** — tools declared inside an iframe are
not discovered.

| Tool | | What it is for |
|---|---|---|
| `get_editor_state` | read | The whole picture: video, selection, every clip with its range and revision, playhead. |
| `read_transcript` | read | A bounded window of sentences. Not the whole transcript. |
| `search_transcript` | read | Find a moment in a long recording, with context around each hit. |
| `get_guidelines` | read | The editorial rules this editor works by. |
| `create_clip` | write | A clip from a contiguous range of sentence ids. |
| `update_clip` | write | Move an edge or retitle — takes `expectedRevision`. |
| `preview_clip` | write | Play a range, or park the playhead on it. |

Read tools carry `annotations.readOnlyHint`.

**Why sentence ids and not timestamps.** An id is stable and means the same thing
to both parties; a timestamp is a number the agent would have to compute and
would get subtly wrong at boundaries. Ids also make a bad cut legible — you can
see that `s0014` was left out.

## Scope, honestly

- **Contiguous ranges only.** There is no way to drop a sentence out of the
  middle of a clip. If the middle is weak, the range is wrong.
- **Preview is the source video**, played between two points. Nothing is
  rendered to preview.
- **Export re-encodes** rather than stream-copying. `-c copy` can only cut on a
  keyframe, which would silently slide the in-point away from the sentence
  boundary the whole app is built on.

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
another port).

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
unavailable** otherwise — every control still works by hand either way.

Then ask for something like:

> Find where he asks why we climb the highest mountain, and build me a clip that
> ends on "we intend to win".

Watch the **Agent activity** panel: every tool call it makes is logged there.

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

Vite · React · TypeScript · CSS Modules · `@ffmpeg/ffmpeg`. Zero backend.
