import { StrictMode, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { MOBILE } from './lib/mobile.js'
import { setLang } from './lib/i18n.js'
import './index.css'

function BootMarker() {
  useLayoutEffect(() => window.__openGymBoot?.mounted(), [])
  return null
}

// Load the instance default before React's first paint so the signed-out screen never flashes
// English while the Spanish locale chunk is loading. A saved profile choice may replace it later.
try {
  await setLang('es')

  createRoot(document.getElementById('root'), {
    onUncaughtError: error => window.__openGymBoot?.fail(error)
  }).render(<StrictMode><App /><BootMarker /></StrictMode>)
} catch (error) {
  window.__openGymBoot?.fail(error)
}

// Not in the mobile build: the native shell already serves everything from disk.
if (!MOBILE && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {})
}
