import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { MOBILE } from './lib/mobile.js'
import { setLang } from './lib/i18n.js'
import './index.css'

// Load the instance default before React's first paint so the signed-out screen never flashes
// English while the Spanish locale chunk is loading. A saved profile choice may replace it later.
await setLang('es')

createRoot(document.getElementById('root')).render(
  <StrictMode><App /></StrictMode>
)

// Not in the mobile build: the native shell already serves everything from disk.
if (!MOBILE && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {})
}
