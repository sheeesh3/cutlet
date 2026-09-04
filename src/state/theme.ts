import { useSyncExternalStore } from 'react'

export type Theme = 'dark' | 'light'

/**
 * Two themes, one switch. The warm dark one is the default because the video
 * should be the brightest thing on screen; light is a choice, remembered per
 * browser, never inferred from the OS — a light OS with a dark editor is the
 * normal state of affairs for anyone who cuts video.
 */
const KEY = 'cutlet.theme'

let theme: Theme = 'dark'
const listeners = new Set<() => void>()

function read(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function apply(next: Theme) {
  document.documentElement.dataset.theme = next
}

/** Runs before the first render, so the page never flashes the other theme. */
export function applyStoredTheme() {
  theme = read()
  apply(theme)
}

export function setTheme(next: Theme) {
  theme = next
  apply(next)
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // Private mode or storage disabled: the choice lasts for the page, which
    // is still better than ignoring the click.
  }
  for (const l of listeners) l()
}

export function toggleTheme() {
  setTheme(theme === 'dark' ? 'light' : 'dark')
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, () => theme, () => 'dark')
}
