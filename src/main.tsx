import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted, so the page still makes no request to anyone but itself.
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './styles/global.css'
import { applyStoredTheme } from './state/theme'
import App from './App'

applyStoredTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
