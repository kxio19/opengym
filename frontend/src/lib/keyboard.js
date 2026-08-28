// The on-screen keyboard versus position:fixed.
//
// Three bars are pinned to the bottom of the window: the tab bar, the rest/work timer and
// the toast. When the keyboard opens over a weight or reps field, iOS shrinks the *visual*
// viewport but leaves the layout viewport alone, so those bars stay where they were —
// buried under the keyboard. Worse, in a home-screen PWA it frequently fails to re-anchor
// them once the keyboard closes: the bar stays stranded in the middle of the screen with
// the page still drawing underneath it. That is the bug Kaio hit mid-workout.
//
// `interactive-widget=resizes-content` in the viewport meta fixes it outright on Chrome by
// shrinking the layout viewport too — there the gap below is always 0 and this module is a
// no-op. iOS ignores the hint, so here the gap is measured by hand and published as `--kb`
// for the CSS to lean on, and the bars are moved with it. Touching `bottom` is a real
// layout change on those elements, which is also what prods Safari into re-anchoring them
// when the keyboard goes away.
import { useEffect } from 'react'

// Under this, the gap is the URL bar collapsing or a rubber-band overscroll, not a
// keyboard. Anything genuinely a keyboard is far taller, even the numeric pad.
export const KB_MIN = 120

// How many CSS pixels of the layout viewport the keyboard is currently covering.
// offsetTop matters because iOS scrolls the visual viewport within the layout one to keep
// a focused field visible; without subtracting it the gap reads too large.
export function keyboardInset(win) {
  const vv = win && win.visualViewport
  if (!vv) return 0
  const gap = win.innerHeight - vv.height - vv.offsetTop
  return gap > 0 ? Math.round(gap) : 0
}

// Writes the measurement out. Returns what it published, so callers can tell open from shut.
export function applyKeyboardInset(win, doc) {
  const raw = keyboardInset(win)
  const px = raw >= KB_MIN ? raw : 0
  doc.documentElement.style.setProperty('--kb', px + 'px')
  if (doc.body) doc.body.classList.toggle('kb-open', px > 0)
  return px
}

// Keeps `--kb` in step with the keyboard for as long as the returned cleanup is unused.
// Without visualViewport (older browsers, the test runner) it does nothing at all and the
// bars keep the plain `bottom` they have always had.
export function watchKeyboard(win = globalThis, doc = win && win.document) {
  const vv = win && win.visualViewport
  if (!vv || !doc) return () => {}
  let last = applyKeyboardInset(win, doc)
  const sync = () => {
    const px = applyKeyboardInset(win, doc)
    // Going from open to shut is the moment Safari forgets where "bottom" is. Re-issuing
    // the current scroll position forces it to recompute the fixed layer.
    if (last > 0 && px === 0 && typeof win.scrollTo === 'function') win.scrollTo(0, win.scrollY || 0)
    last = px
  }
  vv.addEventListener('resize', sync)
  vv.addEventListener('scroll', sync)
  return () => {
    vv.removeEventListener('resize', sync)
    vv.removeEventListener('scroll', sync)
    doc.documentElement.style.removeProperty('--kb')
    if (doc.body) doc.body.classList.remove('kb-open')
  }
}

// Mounted once, at the shell.
export function useKeyboardInset() {
  useEffect(() => watchKeyboard(), [])
}
