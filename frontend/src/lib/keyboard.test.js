import { describe, it, expect } from 'vitest'
import { keyboardInset, applyKeyboardInset, watchKeyboard, KB_MIN } from './keyboard.js'

// A phone-shaped fake: the layout viewport stays 844 tall (that is what iOS does), and the
// keyboard only ever eats into the visual one.
function fakeWindow({ height = 844, offsetTop = 0, innerHeight = 844, visual = true } = {}) {
  const listeners = { resize: new Set(), scroll: new Set() }
  const scrolled = []
  const win = {
    innerHeight,
    scrollY: 0,
    scrollTo: (x, y) => scrolled.push(y),
    visualViewport: visual ? {
      height, offsetTop,
      addEventListener: (t, fn) => listeners[t].add(fn),
      removeEventListener: (t, fn) => listeners[t].delete(fn),
    } : undefined,
  }
  return {
    win, scrolled,
    fire: t => listeners[t].forEach(fn => fn()),
    counts: () => ({ resize: listeners.resize.size, scroll: listeners.scroll.size }),
    // the keyboard coming up: the visual viewport loses exactly its height
    keyboard: px => { win.visualViewport.height = height - px },
  }
}

function fakeDoc() {
  const props = new Map()
  const classes = new Set()
  return {
    documentElement: {
      style: {
        setProperty: (k, v) => props.set(k, v),
        removeProperty: k => props.delete(k),
      },
    },
    body: {
      classList: {
        toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
        remove: c => classes.delete(c),
        contains: c => classes.has(c),
      },
    },
    kb: () => props.get('--kb'),
    hasProp: () => props.has('--kb'),
    open: () => classes.has('kb-open'),
  }
}

describe('keyboardInset', () => {
  it('is zero without visualViewport, so old browsers keep today’s behaviour', () => {
    expect(keyboardInset(fakeWindow({ visual: false }).win)).toBe(0)
    expect(keyboardInset(undefined)).toBe(0)
  })

  it('measures what the keyboard covers of the layout viewport', () => {
    const { win, keyboard } = fakeWindow()
    expect(keyboardInset(win)).toBe(0)
    keyboard(336)
    expect(keyboardInset(win)).toBe(336)
  })

  it('discounts the visual viewport being scrolled to keep a field in view', () => {
    // iOS slides the visual viewport up by 40px; the gap at the bottom is that much smaller
    const { win, keyboard } = fakeWindow({ offsetTop: 40 })
    keyboard(336)
    expect(keyboardInset(win)).toBe(296)
  })

  it('never goes negative when a rubber-band overscroll inverts the numbers', () => {
    const { win } = fakeWindow({ height: 900 })   // visual taller than innerHeight
    expect(keyboardInset(win)).toBe(0)
  })
})

describe('applyKeyboardInset', () => {
  it('ignores a gap too small to be a keyboard — that is the URL bar collapsing', () => {
    const { win, keyboard } = fakeWindow()
    const doc = fakeDoc()
    keyboard(KB_MIN - 1)
    expect(applyKeyboardInset(win, doc)).toBe(0)
    expect(doc.kb()).toBe('0px')
    expect(doc.open()).toBe(false)
  })

  it('publishes the inset and flags the body once it is keyboard-sized', () => {
    const { win, keyboard } = fakeWindow()
    const doc = fakeDoc()
    keyboard(336)
    expect(applyKeyboardInset(win, doc)).toBe(336)
    expect(doc.kb()).toBe('336px')
    expect(doc.open()).toBe(true)
  })
})

describe('watchKeyboard', () => {
  it('does nothing at all without visualViewport', () => {
    const doc = fakeDoc()
    const stop = watchKeyboard(fakeWindow({ visual: false }).win, doc)
    expect(doc.hasProp()).toBe(false)
    expect(() => stop()).not.toThrow()
  })

  it('follows the keyboard up and back down', () => {
    const { win, fire, keyboard } = fakeWindow()
    const doc = fakeDoc()
    const stop = watchKeyboard(win, doc)
    expect(doc.kb()).toBe('0px')

    keyboard(336); fire('resize')
    expect(doc.kb()).toBe('336px')
    expect(doc.open()).toBe(true)

    keyboard(0); fire('resize')
    expect(doc.kb()).toBe('0px')
    expect(doc.open()).toBe(false)
    stop()
  })

  it('nudges the scroll position when the keyboard closes, so Safari re-anchors the bars', () => {
    const { win, fire, keyboard, scrolled } = fakeWindow()
    const doc = fakeDoc()
    const stop = watchKeyboard(win, doc)

    keyboard(336); fire('resize')
    expect(scrolled).toEqual([])          // going up needs no nudge

    win.scrollY = 420
    keyboard(0); fire('resize')
    expect(scrolled).toEqual([420])       // coming down does, at the position we are already at

    fire('resize')
    expect(scrolled).toEqual([420])       // and only once, not on every idle event
    stop()
  })

  it('unsubscribes and clears what it set', () => {
    const { win, counts, keyboard, fire } = fakeWindow()
    const doc = fakeDoc()
    const stop = watchKeyboard(win, doc)
    expect(counts()).toEqual({ resize: 1, scroll: 1 })

    keyboard(336); fire('resize')
    stop()
    expect(counts()).toEqual({ resize: 0, scroll: 0 })
    expect(doc.hasProp()).toBe(false)
    expect(doc.open()).toBe(false)
  })
})
