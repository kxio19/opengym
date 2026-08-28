import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useUI } from '../store/useUI.js'

// One bottom sheet (or centered dialog) with swipe-to-dismiss.
function Sheet({ sheet }) {
  const { closeSheet } = useUI()
  const ref = useRef(null)
  const drag = useRef({ startY: null, delta: 0 })

  const onTouchStart = e => {
    const el = ref.current
    // a gesture that begins on a slider (or opted-out control) belongs to that control,
    // not to the sheet's swipe-to-dismiss — so it keeps working while you drag
    if (e.target.closest && e.target.closest('input[type=range], [data-nodrag]')) {
      drag.current = { startY: null, delta: 0 }
      return
    }
    drag.current = { startY: el.scrollTop <= 0 ? e.touches[0].clientY : null, delta: 0 }
  }
  const onTouchMove = e => {
    const el = ref.current, d = drag.current
    if (d.startY === null) return
    d.delta = e.touches[0].clientY - d.startY
    if (d.delta > 0 && el.scrollTop <= 0) {
      e.preventDefault()
      el.style.transition = 'none'
      el.style.transform = `translateY(${d.delta}px)`
    } else d.delta = 0
  }
  const onTouchEnd = () => {
    const el = ref.current, d = drag.current
    if (d.startY === null) return
    el.style.transition = 'transform .2s'
    if (d.delta > 90 && !sheet.locked) { el.style.transform = 'translateY(110%)'; setTimeout(() => closeSheet(sheet.id), 180) }
    else el.style.transform = ''
    d.startY = null
  }

  // non-passive touchmove so preventDefault works (bottom sheets only; centered dialogs have no ref)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => el.removeEventListener('touchmove', onTouchMove)
  }, [])

  const close = () => closeSheet(sheet.id)
  if (sheet.kind === 'center') {
    return (
      <div>
        <div className="mback" onClick={() => { if (!sheet.locked) close() }} />
        <div className="center">{sheet.render(close)}</div>
      </div>
    )
  }
  return (
    <div>
      <div className="mback" onClick={() => { if (!sheet.locked) close() }} />
      <div className="sheet" ref={ref} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="grab" />
        {sheet.render(close)}
      </div>
    </div>
  )
}

export default function Modals() {
  const sheets = useUI(s => s.sheets)
  const open = sheets.length > 0
  const loc = useLocation()
  // Where the page was parked when the first sheet went up. A ref rather than the effect's
  // closure, because a route change has to be able to cancel it while the sheet is still up.
  const parked = useRef(0)

  // A sheet can navigate — picking an exercise, opening a routine, jumping to a post. The
  // route change fires App's scrollTo(0, 0), but that is a no-op while the body is locked,
  // so without dropping the parked offset here, closing the sheet would haul the screen you
  // just arrived at down to where the previous one happened to be scrolled.
  useEffect(() => { parked.current = 0 }, [loc.pathname])

  // lock the page behind any open sheet (iOS-safe)
  useEffect(() => {
    if (!open) return
    parked.current = window.scrollY || 0
    const b = document.body.style
    b.position = 'fixed'; b.top = -parked.current + 'px'; b.left = '0'; b.right = '0'; b.width = '100%'
    return () => {
      b.position = b.top = b.left = b.right = b.width = ''
      // Reading scrollHeight here is deliberate: the document only becomes scrollable again
      // once those styles are off, and this read forces the layout that makes the number —
      // and the scrollTo below it — correct in the same tick. Deferring to a frame instead
      // would be silently skipped whenever the sheet is dismissed on a backgrounded tab,
      // where rAF simply does not run. Clamping matters because the page underneath may
      // have shrunk while the sheet was up.
      const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
      window.scrollTo(0, Math.min(parked.current, max))
    }
  }, [open])

  if (!sheets.length) return null
  return (
    <div id="modal-root" className="open">
      {sheets.map(s => <Sheet key={s.id} sheet={s} />)}
    </div>
  )
}
