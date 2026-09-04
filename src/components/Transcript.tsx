import { useEffect, useMemo, useRef, useState } from 'react'
import styles from './Transcript.module.css'
import {
  useStore,
  setSelection,
  createClip,
  getState,
  clipSentenceIndices,
  removeSentence,
  addSentence,
  logTool,
} from '../state/store'
import { onTimeUpdate, seek, playSentenceRange } from '../state/player'
import { formatTimecode } from '../transcript/sentences'
import type { Actor, Sentence } from '../types'

const NO_SENTENCES: Sentence[] = []

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
  const audition = useStore((s) => s.audition)

  const [query, setQuery] = useState('')
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
          for (let i = kept[0]; i <= kept[kept.length - 1]; i++) {
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
    if (e.shiftKey && selection) {
      setSelection({ startSentenceId: selection.startSentenceId, endSentenceId: s.id })
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
      if (e.shiftKey && selection) {
        setSelection({ startSentenceId: selection.startSentenceId, endSentenceId: next.id })
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
    const sel = getState().selection
    if (!sel) return
    createClip({
      segments: [{ startSentenceId: sel.startSentenceId, endSentenceId: sel.endSentenceId }],
      by: 'human',
    })
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

  return (
    <div className={styles.pane}>
      <div className={styles.head}>
        <span className={styles.title}>Transcript</span>
        <span className={styles.count}>
          {matches ? `${visible.length} of ${sentences.length}` : `${sentences.length} sentences`}
        </span>
        <span className={styles.spacer} />
        <input
          className={styles.search}
          placeholder="Find a line"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

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

        {visible.map((s) => {
          const i = s.index
          const selected = selectedRange && i >= selectedRange.a && i <= selectedRange.b
          const auditioning = auditionRange && i >= auditionRange.a && i <= auditionRange.b
          const dropped = droppedFromActive.has(i)
          const editable = !!activeClipId && (inActive.has(i) || dropped)
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
                  className={styles.keepToggle}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleSentenceInActive(s.id, !dropped)
                  }}
                  title={dropped ? 'Put this line back in the clip' : 'Drop this line from the clip'}
                  aria-label={dropped ? 'Restore ' + s.id : 'Drop ' + s.id}
                >
                  {dropped ? '+' : '−'}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {selection && (
        <div className={styles.anchorBar}>
          <span className={styles.anchorLabel}>Anchored on</span>
          <span className={styles.anchorIds}>
            {selection.startSentenceId}
            {selection.endSentenceId !== selection.startSentenceId && `–${selection.endSentenceId}`}
          </span>
          <span className={styles.spacer} />
          <button
            className={styles.btn}
            onClick={() => playSentenceRange(selection.startSentenceId, selection.endSentenceId)}
          >
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
