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

**Or assemble it yourself** → click a sentence, ⌘-click another anywhere else,
and **Make a clip**. Ranges that never touched become one cut; ranges that end up
adjacent merge into one. It is the same collection-of-ranges shape the agent
produces, built by hand — and `get_editor_state` reports it, so the agent can
work from what you marked.

**Export** → each piece is encoded separately then joined, plus an `.srt` rebased
across the whole cut.

## Two transcripts, two timelines

A cut is a list of segments. That tells you what survived; it does not tell you
how the joins sound, and a cut lives or dies on its joins. So both parties get
the edit twice — once as the recording, once as the thing that plays.

|  | The source | The sequence |
|---|---|---|
| **The agent reads** | `read_transcript` — every sentence as spoken | `read_transcript scope: "clip"` — kept sentences only, each gap marked with what was dropped and how long it ran |
| **You see** | the strip under the player: speech, clips, playhead, all against the full recording | the sequence timeline: pieces end to end with the gaps closed, in the time it actually plays for |

The second one is what catches the classic failure. Cut a moment about space and
keep the line after it, and the agent reads back:

```
— GAP — 2 sentences dropped (12s)
s0007 [1:24] Its conquest deserves the best of all mankind…
```

*Its* conquest. The antecedent left with the gap. From a segment list that looks
fine; read back as it plays, it is obviously broken.

**The sequence timeline is read-only, on purpose.** Every boundary here is a
sentence id, because an id means the same thing to both parties and a dragged
pixel does not. Dragging an edge would mint a cut point with no id, and the agent
would lose the vocabulary it needs to revise it. Click a piece to seek,
double-click to play from there; the edit itself happens in the transcript, where
the ids are.

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

## The interface of actions

The page and the conversation are one interface, split by what each is good at.

| You do it — a click, immediate | You ask for it — judgement |
|---|---|
| Open a video and transcript | **Find clips** — how many, where, and why each works |
| Play, pause, scrub, seek | **Cut a clip to length** — which lines survive |
| Click a sentence to anchor it | Retitle it, or rewrite the reason |
| **⌘-click to mark another range** | Revise it after you have edited it |
| **Make a clip** from what you marked | Check its own joins and fix them |
| **Click a clip to select it** | |
| Drop or restore a line, `−` / `+` | |
| Nudge the in and out edges | |
| Set the gap, delete, export | |

The left column is mechanical and instantly reversible. The right column is
judgement, and there is no button for it — the agent has to be asked.

**Selecting is how the two halves meet.** Click a clip and it becomes what "this"
refers to; `get_editor_state` reports it as `SELECTED` and says outright that it
is what the user means by "this clip" or "it". So the flow reads:

```
say    "find the best clips in this"     → four clips appear, with reasons
click  the one you like                  → it plays, and it is now "this"
say    "cut this to forty seconds"       → it becomes three pieces, 37s
click  the − beside a line it kept       → that line goes; revision bumps
say    "tighten this"                    → it works from your edit, not its own
```

The selected card shows the phrases that act on it, so you never have to invent
the wording.

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
| `read_transcript` | read | The recording, in full or `detail: "skim"`; or `scope: "clip"` for a cut as it plays, gaps marked. |
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
at a time, shift-arrow extends it, ⌘-click banks a range and starts another,
Home and End jump to the ends, Enter plays what is anchored. Space plays and
pauses, left and right scrub (hold shift for ten seconds), Escape drops the
anchor.

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

### The two binaries that are not in the repository

`npm run setup` runs before dev and build and puts both in `public/`:

- **`scripts/sync-ffmpeg.mjs`** copies the single-thread `@ffmpeg/core` out of
  `node_modules` into `public/ffmpeg/`. The wasm is 31MB.
- **`scripts/fetch-demo.mjs`** downloads the demo video into `public/demo/`.
  It is 18MB, and it comes from a release asset rather than git history — set
  `DEMO_VIDEO_URL` to point a fork at its own copy.

Neither is committed, for the same reason: a checked-in binary that large is a
repository nobody wants to clone. The demo *transcript* is committed — it is
52KB, and it is the part worth reading a diff of.

If the fetch fails the app still runs; it opens on "bring your own video", says
so plainly, and tells you the one command that fixes it.

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
