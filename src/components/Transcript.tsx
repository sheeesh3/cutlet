import { useEffect, useMemo, useRef, useState } from 'react'
import styles from './Transcript.module.css'
import {
  useStore,
  setSelection,
  markAndStartNew,
  extendSelection,
  selectedSegments,
  selectedRanges,
  selectedDuration,
  createClip,
  clipSentenceIndices,
  clipDuration,
  moveSegment,
  removeSegment,
  removeSentence,
  addSentence,
  logTool,
} from '../state/store'
import { onTimeUpdate, seek, playSentenceRange, playRanges } from '../state/player'
import { formatTimecode, formatDuration } from '../transcript/sentences'
import type { Actor, Sentence } from '../types'

const NO_SENTENCES: Sentence[] = []

/** Name the modifier the way the user's own keyboard does. */
const CMD_KEY =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'

/**
 * Scrolls a row into view, honouring the reduced-motion preference by jumping
 * rather than by not moving at all.
 *
 * `behavior: 'smooth'` is silently ignored both when the user prefers reduced
 * motion and while the tab is hidden, so asking for it unconditionally means
 * the transcript quietly stops following the playhead and stops jumping to the
 * agent's range. Here the scrolling is function, not decoration — only the
 * animation is negotiable.
 */
function revealRow(node: HTMLElement | null | undefined) {
  if (!node) return
  const reduced =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  // Smooth scrolling is driven by animation frames, which a hidden tab does not
  // get. An agent can call preview_clip while the user is looking at something
  // else; without this they come back to the old scroll position.
  const instant = reduced || document.visibilityState === 'hidden'
  node.scrollIntoView({ block: 'center', behavior: instant ? 'auto' : 'smooth' })
}

export function Transcript() {
  const project = useStore((s) => s.project)
  const clips = useStore((s) => s.clips)
  const activeClipId = useStore((s) => s.activeClipId)
  const selection = useStore((s) => s.selection)
  const marks = useStore((s) => s.marks)
  const audition = useStore((s) => s.audition)

  const [query, setQuery] = useState('')
  const [view, setView] = useState<'source' | 'clip'>('source')
  const [time, setTime] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)
  const followRef = useRef(true)

  useEffect(() => onTimeUpdate(setTime), [])

  // A shared empty array rather than a fresh `[]`, so the memos below keep a
  // stable dependency while no project is loaded.
  const sentences = project?.sentences ?? NO_SENTENCES

  const playingIndex = useMemo(() => {
    if (!sentences.length) return -1
    // Linear is fine at transcript scale and stays correct across gaps.
    for (let i = 0; i < sentences.length; i++) {
      if (time >= sentences[i].start && time < sentences[i].end) return i
      if (time < sentences[i].start) return i > 0 && time - sentences[i - 1].end < 1.2 ? i - 1 : -1
    }
    return sentences.length - 1
  }, [sentences, time])

  /**
   * Membership lookups, computed once per render rather than per row.
   *
   * `droppedFromActive` is the interesting one: sentences that sit inside the
   * active cut's span but were cut out of it. Showing them struck through, in
   * place, is what makes an edit reviewable — you can see what went, not just
   * what stayed.
   */
  const { inClip, inActive, droppedFromActive, activeEditedBy } = useMemo(() => {
    const inClip = new Set<number>()
    const inActive = new Set<number>()
    const droppedFromActive = new Set<number>()
    let activeEditedBy: Actor = 'agent'
    if (!sentences.length) return { inClip, inActive, droppedFromActive, activeEditedBy }

    for (const clip of clips) {
      const kept = clipSentenceIndices(clip)
      for (const i of kept) {
        inClip.add(i)
        if (clip.id === activeClipId) inActive.add(i)
      }
      if (clip.id === activeClipId) {
        activeEditedBy = clip.lastEditedBy
        if (kept.length) {
          // min/max, not first/last — a reordered cut plays its pieces out of
          // transcript order, so the first one it plays need not be the earliest.
          for (let i = Math.min(...kept); i <= Math.max(...kept); i++) {
            if (!inActive.has(i)) droppedFromActive.add(i)
          }
        }
      }
    }
    return { inClip, inActive, droppedFromActive, activeEditedBy }
  }, [clips, activeClipId, sentences])

  const auditionRange = useMemo(() => {
    if (!audition) return null
    const a = sentences.findIndex((s) => s.id === audition.startSentenceId)
    const b = sentences.findIndex((s) => s.id === audition.endSentenceId)
    if (a < 0 || b < 0) return null
    return { a: Math.min(a, b), b: Math.max(a, b) }
  }, [audition, sentences])

  const selectedRange = useMemo(() => {
    if (!selection) return null
    const a = sentences.findIndex((s) => s.id === selection.startSentenceId)
    const b = sentences.findIndex((s) => s.id === selection.endSentenceId)
    if (a < 0 || b < 0) return null
    return { a: Math.min(a, b), b: Math.max(a, b) }
  }, [selection, sentences])

  /** Banked ranges, drawn like the live selection but without its edge handles. */
  const markedSet = useMemo(() => {
    const set = new Set<number>()
    for (const m of marks) {
      const a = sentences.findIndex((s) => s.id === m.startSentenceId)
      const b = sentences.findIndex((s) => s.id === m.endSentenceId)
      if (a < 0 || b < 0) continue
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) set.add(i)
    }
    return set
  }, [marks, sentences])

  const activeClip = clips.find((c) => c.id === activeClipId) ?? null
  // Falling back to source rather than showing an empty pane: the clip view has
  // nothing to show the moment its clip is deleted or deselected.
  const clipView = view === 'clip' && !!activeClip

  const marked = useMemo(
    () => ({ segments: selectedSegments(), seconds: selectedDuration() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selection, marks, sentences]
  )

  const normalisedQuery = query.trim().toLowerCase()
  const terms = useMemo(
    () => normalisedQuery.split(/\s+/).filter(Boolean),
    [normalisedQuery]
  )
  const matches = useMemo(() => {
    if (!terms.length) return null
    const set = new Set<number>()
    sentences.forEach((s, i) => {
      const hay = s.text.toLowerCase()
      if (terms.every((t) => hay.includes(t))) set.add(i)
    })
    return set
  }, [terms, sentences])

  const visible = matches ? sentences.filter((_, i) => matches.has(i)) : sentences

  // Follow the playhead, but yield the moment the user scrolls by hand.
  useEffect(() => {
    if (!followRef.current || playingIndex < 0 || matches) return
    revealRow(listRef.current?.querySelector<HTMLElement>(`[data-index="${playingIndex}"]`))
  }, [playingIndex, matches])

  // Keep whatever is being pointed at on screen — an anchor the user set, or a
  // range the agent is auditioning. Watching the list jump to the agent's range
  // is how you see it act.
  const focusStart = audition?.startSentenceId ?? selection?.startSentenceId
  const focusEnd = audition?.endSentenceId ?? selection?.endSentenceId
  useEffect(() => {
    if (!focusStart) return
    void focusEnd
    followRef.current = false
    revealRow(listRef.current?.querySelector<HTMLElement>(`[data-id="${focusStart}"]`))
  }, [focusStart, focusEnd])

  const onRowClick = (s: Sentence, e: React.MouseEvent) => {
    followRef.current = false
    // Cmd/ctrl banks the range in hand and starts another one elsewhere, so a
    // clip can be assembled out of moments that never touched.
    // Both branches read live state inside the store rather than the `selection`
    // this render closed over, so a second click arriving before React has
    // re-rendered still sees what the first one did.
    if (e.metaKey || e.ctrlKey) {
      markAndStartNew(s.id)
      seek(s.start)
      return
    }
    if (e.shiftKey) {
      extendSelection(s.id)
      return
    }
    setSelection({ startSentenceId: s.id, endSentenceId: s.id })
    seek(s.start)
  }

  /**
   * The list is one tab stop and the arrows move within it, rather than every
   * sentence being its own tab stop — a two-hour recording would otherwise put
   * eight hundred of them between the search box and the clips rail.
   */
  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (!visible.length) return
    const anchored = selection ? visible.findIndex((s) => s.id === selection.endSentenceId) : -1
    const cursor = anchored >= 0 ? anchored : Math.max(0, visible.findIndex((s) => s.index === playingIndex))

    const move = (delta: number) => {
      e.preventDefault()
      followRef.current = false
      const next = visible[Math.min(visible.length - 1, Math.max(0, cursor + delta))]
      if (!next) return
      if (e.shiftKey) {
        extendSelection(next.id)
      } else {
        setSelection({ startSentenceId: next.id, endSentenceId: next.id })
        seek(next.start)
      }
      revealRow(listRef.current?.querySelector<HTMLElement>(`[data-id="${next.id}"]`))
    }

    if (e.key === 'ArrowDown') return move(1)
    if (e.key === 'ArrowUp') return move(-1)
    if (e.key === 'Home') return move(-visible.length)
    if (e.key === 'End') return move(visible.length)
    if (e.key === 'Enter' && selection) {
      e.preventDefault()
      playSentenceRange(selection.startSentenceId, selection.endSentenceId)
    }
  }

  const makeClipFromSelection = () => {
    const segments = selectedSegments()
    if (!segments.length) return
    // More than one run means the human assembled it out of separate moments,
    // which is a cut by construction — the gaps between them are the edit.
    const result = createClip({ segments, kind: segments.length > 1 ? 'cut' : 'topic', by: 'human' })
    if ('error' in result) logTool('create_clip', result.error, false)
    else setSelection(null)
  }

  /**
   * With a cut open, clicking the keep/drop control on a sentence edits that cut
   * in place. This is the fine adjustment the agent cannot do for you: it can
   * propose a shape, but only you can hear that one line has to go.
   */
  const toggleSentenceInActive = (sentenceId: string, drop: boolean) => {
    if (!activeClipId) return
    const result = drop
      ? removeSentence(activeClipId, sentenceId, 'human')
      : addSentence(activeClipId, sentenceId, 'human')
    if ('error' in result) logTool('edit', result.error, false)
  }

  const movePiece = (from: number, to: number) => {
    if (!activeClipId) return
    const result = moveSegment(activeClipId, from, to, 'human')
    if ('error' in result) logTool('move', result.error, false)
  }

  const dropPiece = (at: number) => {
    if (!activeClipId) return
    const result = removeSegment(activeClipId, at, 'human')
    if ('error' in result) logTool('remove', result.error, false)
  }

  /**
   * The clip as it plays: kept sentences in play order, with each gap shown as
   * the thing it is — a cut, with what was dropped named and restorable. This is
   * the human's half of read_transcript scope:"clip".
   */
  const clipRows = useMemo(() => {
    if (!activeClip) return []
    type Row =
      | { kind: 'line'; index: number }
      | { kind: 'gap'; dropped: number[] }
      | { kind: 'piece'; at: number; ids: string; seconds: number }
    const rows: Row[] = []
    const total = activeClip.segments.length
    activeClip.segments.forEach((seg, n) => {
      const a = sentences.findIndex((s) => s.id === seg.startSentenceId)
      const b = sentences.findIndex((s) => s.id === seg.endSentenceId)
      if (a < 0 || b < 0) return
      if (n > 0) {
        const previous = activeClip.segments[n - 1]
        const pb = sentences.findIndex((s) => s.id === previous.endSentenceId)
        const dropped: number[] = []
        // Only a forward gap has dropped material in it. After a reorder the
        // next piece can start earlier in the recording, and nothing was cut
        // between them — the join is the edit.
        if (pb >= 0 && a > pb) for (let j = pb + 1; j < a; j++) dropped.push(j)
        rows.push({ kind: 'gap', dropped })
      }
      // A header per piece, but only once there is more than one — a single
      // unbroken run has no arrangement to speak of, and labelling it "piece 1"
      // would invent a structure that is not there.
      if (total > 1) {
        rows.push({
          kind: 'piece',
          at: n,
          ids: a === b ? sentences[a].id : `${sentences[a].id}–${sentences[b].id}`,
          seconds: sentences[b].end - sentences[a].start,
        })
      }
      for (let j = a; j <= b; j++) rows.push({ kind: 'line', index: j })
    })
    return rows
  }, [activeClip, sentences])

  return (
    <div className={styles.pane}>
      <div className={styles.head}>
        {/* The same two transcripts the agent reads through read_transcript:
            "source" is the recording as spoken, "clip" is the selected cut as it
            plays. Giving the agent both and the human only one was an asymmetry
            with nothing behind it. */}
        <div className={styles.views} role="tablist" aria-label="Which transcript">
          <button
            role="tab"
            aria-selected={!clipView}
            className={`${styles.view} ${!clipView ? styles.viewOn : ''}`}
            onClick={() => setView('source')}
          >
            Source
          </button>
          <button
            role="tab"
            aria-selected={clipView}
            className={`${styles.view} ${clipView ? styles.viewOn : ''}`}
            onClick={() => setView('clip')}
            disabled={!activeClip}
            title={
              activeClip
                ? 'The selected clip as it plays, gaps and all'
                : 'Select a clip to read it as it plays'
            }
          >
            Clip
          </button>
        </div>
        <span className={styles.count}>
          {clipView && activeClip
            ? `${clipSentenceIndices(activeClip).length} kept · ${formatDuration(clipDuration(activeClip))}`
            : matches
              ? `${visible.length} of ${sentences.length}`
              : `${sentences.length} sentences`}
        </span>
        <span className={styles.spacer} />
        {!clipView && (
          <input
            className={styles.search}
            placeholder="Find a line"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
      </div>

      {/* The manual path, said out loud. Every control below is on screen, but
          a control you have not been told the meaning of is still a puzzle —
          and "can I edit this without asking the agent" was the question. */}
      {activeClip && (
        <div className={styles.editBar}>
          <span className={styles.editingWhat}>
            Editing <strong>{activeClip.title}</strong>
          </span>
          <span className={styles.spacer} />
          <span className={styles.editHow}>
            {clipView ? (
              <>
                <code>−</code> drops a line · <code>↑↓</code> moves a whole piece
              </>
            ) : (
              <>
                <code>−</code> drops a line · <code>+</code> adds one
              </>
            )}
          </span>
        </div>
      )}

      <div
        className={styles.list}
        ref={listRef}
        tabIndex={0}
        role="listbox"
        aria-label="Transcript sentences"
        aria-activedescendant={selection ? `row-${selection.endSentenceId}` : undefined}
        onKeyDown={onListKeyDown}
        onWheel={() => {
          followRef.current = false
        }}
      >
        {!sentences.length && <div className={styles.empty}>No transcript loaded.</div>}

        {clipView &&
          activeClip &&
          clipRows.map((row, n) =>
            row.kind === 'piece' ? (
              /* Reordering lives here as well as on the timeline, because this
                 is where you are reading the cut when you decide a piece is in
                 the wrong place. */
              <div key={`piece-${row.at}`} className={styles.pieceRow}>
                <span className={styles.pieceNo}>Piece {row.at + 1}</span>
                <span className={styles.pieceIds}>{row.ids}</span>
                <span className={styles.pieceDur}>{formatDuration(row.seconds)}</span>
                <span className={styles.spacer} />
                <button
                  className={styles.pieceBtn}
                  onClick={() => movePiece(row.at, row.at - 1)}
                  disabled={row.at === 0}
                  title="Play this piece earlier in the clip"
                  aria-label={`Move piece ${row.at + 1} earlier`}
                >
                  ↑
                </button>
                <button
                  className={styles.pieceBtn}
                  onClick={() => movePiece(row.at, row.at + 1)}
                  disabled={row.at === (activeClip?.segments.length ?? 1) - 1}
                  title="Play this piece later in the clip"
                  aria-label={`Move piece ${row.at + 1} later`}
                >
                  ↓
                </button>
                <button
                  className={`${styles.pieceBtn} ${styles.pieceBtnDrop}`}
                  onClick={() => dropPiece(row.at)}
                  title="Drop this whole piece from the clip"
                  aria-label={`Drop piece ${row.at + 1}`}
                >
                  Remove
                </button>
              </div>
            ) : row.kind === 'gap' ? (
              <div key={`gap-${n}`} className={styles.gapRow}>
                <span className={styles.gapRule} />
                <span className={styles.gapLabel}>
                  {row.dropped.length
                    ? `${row.dropped.length} ${row.dropped.length === 1 ? 'line' : 'lines'} cut`
                    : 'join'}
                </span>
                {row.dropped.length > 0 && (
                  <button
                    className={styles.gapRestore}
                    onClick={() => toggleSentenceInActive(sentences[row.dropped[0]].id, false)}
                    title={sentences[row.dropped[0]]?.text}
                  >
                    put back
                  </button>
                )}
                <span className={styles.gapRule} />
              </div>
            ) : (
              <div
                key={sentences[row.index].id}
                className={`${styles.row} ${styles.inActiveClipHuman} ${
                  row.index === playingIndex ? styles.playing : ''
                }`}
                data-index={row.index}
                data-id={sentences[row.index].id}
                onClick={() => seek(sentences[row.index].start)}
                onDoubleClick={() =>
                  playSentenceRange(sentences[row.index].id, sentences[row.index].id)
                }
              >
                <span className={styles.tc}>{formatTimecode(sentences[row.index].start)}</span>
                <span className={styles.text}>
                  {row.index === playingIndex && <span className={styles.playingDot} />}
                  {sentences[row.index].text}
                </span>
                <button
                  className={styles.keepToggle}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleSentenceInActive(sentences[row.index].id, true)
                  }}
                  title="Drop this line from the clip"
                  aria-label={`Drop ${sentences[row.index].id}`}
                >
                  −
                </button>
              </div>
            )
          )}

        {!clipView &&
          visible.map((s) => {
          const i = s.index
          const inLive = selectedRange && i >= selectedRange.a && i <= selectedRange.b
          const selected = inLive || markedSet.has(i)
          const auditioning = auditionRange && i >= auditionRange.a && i <= auditionRange.b
          const dropped = droppedFromActive.has(i)
          const inCut = inActive.has(i)
          // Every line is editable once a clip is selected, not just the ones
          // inside its span. Before, a sentence the clip had never reached had
          // no control at all, so there was no way to extend a cut forward —
          // the only visible edits were ones that shrank it.
          const editable = !!activeClipId
          const cls = [
            styles.row,
            inClip.has(i) && styles.inClip,
            inActive.has(i) &&
              (activeEditedBy === 'human'
                ? styles.inActiveClipHuman
                : styles.inActiveClipAgent),
            dropped && styles.dropped,
            auditioning && styles.audition,
            selected && styles.selected,
            !inLive && markedSet.has(i) && styles.marked,
            i === playingIndex && styles.playing,
          ]
            .filter(Boolean)
            .join(' ')

          return (
            <div
              key={s.id}
              id={`row-${s.id}`}
              role="option"
              aria-selected={!!selected}
              data-index={i}
              data-id={s.id}
              className={cls}
              onClick={(e) => onRowClick(s, e)}
              onDoubleClick={() => playSentenceRange(s.id, s.id)}
              title={`${s.id} · ${formatTimecode(s.start)}`}
            >
              <span className={styles.tc}>{formatTimecode(s.start)}</span>
              <span className={styles.text}>
                {i === playingIndex && <span className={styles.playingDot} />}
                {terms.length ? highlight(s.text, terms) : s.text}
              </span>
              {editable && (
                <button
                  className={`${styles.keepToggle} ${inCut ? '' : styles.addToggle}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleSentenceInActive(s.id, inCut)
                  }}
                  title={inCut ? 'Drop this line from the clip' : 'Add this line to the clip'}
                  aria-label={(inCut ? 'Drop ' : 'Add ') + s.id}
                >
                  {inCut ? '−' : '+'}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {selection && (
        <div className={styles.anchorBar}>
          <span className={styles.anchorLabel}>
            {marked.segments.length > 1 ? 'Marked' : 'Anchored on'}
          </span>
          {/* Read off the merged segments, not the live range — cmd-clicking a
              sentence next to an existing mark makes one longer range, and the
              bar has to say the range that would actually be made. */}
          <span className={styles.anchorIds}>
            {marked.segments.length > 1
              ? `${marked.segments.length} ranges · ${formatDuration(marked.seconds)}`
              : marked.segments.length === 1
                ? marked.segments[0].startSentenceId +
                  (marked.segments[0].endSentenceId !== marked.segments[0].startSentenceId
                    ? `–${marked.segments[0].endSentenceId}`
                    : '')
                : selection.startSentenceId}
          </span>
          <span className={styles.spacer} />
          {/* The gesture is not discoverable, so the bar says it out loud the
              moment there is a selection to extend. */}
          <span className={styles.hint}>{CMD_KEY}-click to add another</span>
          <button className={styles.btn} onClick={() => playRanges(selectedRanges())}>
            Play
          </button>
          <button className={styles.btn} onClick={() => setSelection(null)}>
            Clear
          </button>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={makeClipFromSelection}>
            Make a clip
          </button>
        </div>
      )}
    </div>
  )
}

/** Marks every search term inside a sentence without touching the DOM by hand. */
function highlight(text: string, terms: string[]) {
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'ig')
  return text.split(pattern).map((part, i) =>
    terms.includes(part.toLowerCase()) ? (
      <mark key={i} className={styles.hit}>
        {part}
      </mark>
    ) : (
      part
    )
  )
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
