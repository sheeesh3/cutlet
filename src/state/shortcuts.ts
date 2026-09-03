import { useEffect } from 'react'
import { getState, setSelection } from './store'
import { getVideo, seek, toggle } from './player'

/**
 * Keyboard transport. Space plays and pauses, arrows scrub, Escape drops the
 * anchor — unless the user is typing, in which case the keystroke is theirs.
 */
export function usePlaybackShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (target?.isContentEditable) return

      if (e.code === 'Space') {
        e.preventDefault()
        toggle()
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const v = getVideo()
        if (!v) return
        e.preventDefault()
        const step = e.shiftKey ? 10 : 3
        seek(v.currentTime + (e.key === 'ArrowRight' ? step : -step))
      }
      if (e.key === 'Escape' && getState().selection) setSelection(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
