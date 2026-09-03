import { useEffect, useMemo, useRef, useState } from 'react'
import styles from './Transcript.module.css'
import { useStore, setSelection, createClip, getState } from '../state/store'
import { onTimeUpdate, seek, playSentenceRange } from '../state/player'
import { formatTimecode } from '../transcript/sentences'
import type { Sentence } from '../types'

const NO_SENTENCES: Sentence[] = []

export function Transcript() {
  const project = useStore((s) => s.project)
  const clips = useStore((s) => s.clips)
  const activeClipId = useStore((s) => s.activeClipId)
  const selection = useStore((s) => s.selection)

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

  /** Membership lookups, computed once per render rather than per row. */
  const { inClip, inActive, activeEditedBy } = useMemo(() => {
    const inClip = new Set<number>()
    const inActive = new Set<number>()
    let activeEditedBy: 'agent' | 'human' = 'agent'
    for (const clip of clips) {
      const a = sentences.findIndex((s) => s.id === clip.startSentenceId)
      const b = sentences.findIndex((s) => s.id === clip.endSentenceId)
      if (a < 0 || b < 0) continue
      for (let i = a; i <= b; i++) {
        inClip.add(i)
        if (clip.id === activeClipId) inActive.add(i)
      }
      if (clip.id === activeClipId) activeEditedBy = clip.lastEditedBy
    }
    return { inClip, inActive, activeEditedBy }
  }, [clips, activeClipId, sentences])

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
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${playingIndex}"]`)
    node?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [playingIndex, matches])

  // Keep the agent's chosen range on screen — this is how you see it act.
  const selectionStart = selection?.startSentenceId
  const selectionEnd = selection?.endSentenceId
  useEffect(() => {
    if (!selectionStart) return
    void selectionEnd
    const node = listRef.current?.querySelector<HTMLElement>(`[data-id="${selectionStart}"]`)
    node?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [selectionStart, selectionEnd])

  const onRowClick = (s: Sentence, e: React.MouseEvent) => {
    followRef.current = false
    if (e.shiftKey && selection) {
      setSelection({ startSentenceId: selection.startSentenceId, endSentenceId: s.id })
      return
    }
    setSelection({ startSentenceId: s.id, endSentenceId: s.id })
    seek(s.start)
  }

  const makeClipFromSelection = () => {
    const sel = getState().selection
    if (!sel) return
    createClip({
      startSentenceId: sel.startSentenceId,
      endSentenceId: sel.endSentenceId,
      by: 'human',
    })
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
        onWheel={() => {
          followRef.current = false
        }}
      >
        {!sentences.length && <div className={styles.empty}>No transcript loaded.</div>}

        {visible.map((s) => {
          const i = s.index
          const selected = selectedRange && i >= selectedRange.a && i <= selectedRange.b
          const cls = [
            styles.row,
            inClip.has(i) && styles.inClip,
            inActive.has(i) &&
              (activeEditedBy === 'human'
                ? styles.inActiveClipHuman
                : styles.inActiveClipAgent),
            selected && styles.selected,
            i === playingIndex && styles.playing,
          ]
            .filter(Boolean)
            .join(' ')

          return (
            <div
              key={s.id}
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
