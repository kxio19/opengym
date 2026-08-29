// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Check, Switch } from '../components/ui.jsx'

const srcDir = fileURLToPath(new URL('../', import.meta.url))

function jsxFiles(dir = srcDir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = `${dir}/${entry.name}`
    return entry.isDirectory() ? jsxFiles(path) : entry.name.endsWith('.jsx') ? [path] : []
  })
}

// Return complete JSX opening tags. A lazy regex stops at the `>` in an onClick arrow,
// so keep track of braces and quotes while looking for the real end of the tag.
function openingTags(source, element) {
  const tags = []
  const start = new RegExp(`<${element}(?=\\s|/?>)`, 'g')
  for (const match of source.matchAll(start)) {
    let braces = 0
    let quote = null
    let escaped = false
    for (let i = match.index + match[0].length; i < source.length; i++) {
      const char = source[i]
      if (quote) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === quote) quote = null
      } else if (char === '"' || char === "'" || char === '`') quote = char
      else if (char === '{') braces++
      else if (char === '}') braces--
      else if (char === '>' && braces === 0) {
        tags.push(source.slice(match.index, i + 1))
        break
      }
    }
  }
  return tags
}

function attributeValue(tag, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*`).exec(tag)
  if (!match) return null
  const start = match.index + match[0].length
  const opener = tag[start]
  if (opener === '"' || opener === "'") {
    const end = tag.indexOf(opener, start + 1)
    return tag.slice(start, end + 1)
  }
  if (opener !== '{') return tag.slice(start).match(/^[^\s>]+/)?.[0] ?? ''

  let depth = 0
  let quote = null
  let escaped = false
  for (let i = start; i < tag.length; i++) {
    const char = tag[i]
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = null
    } else if (char === '"' || char === "'" || char === '`') quote = char
    else if (char === '{') depth++
    else if (char === '}' && --depth === 0) return tag.slice(start, i + 1)
  }
  return tag.slice(start)
}

const oneLine = tag => tag.replace(/\s+/g, ' ').trim()

describe('accessibility regressions', () => {
  it('keeps clickable item rows keyboard reachable', () => {
    // 29 aug 2026 QA: clickable <div className="item"> rows had no keyboard semantics.
    const offenders = jsxFiles().flatMap(path => {
      const source = readFileSync(path, 'utf8')
      return openingTags(source, 'div')
        .filter(tag => /\bonClick\s*=/.test(tag))
        .filter(tag => /(^|[^A-Za-z0-9_-])item(?=$|[^A-Za-z0-9_-])/.test(attributeValue(tag, 'className') ?? ''))
        .map(tag => `${path.slice(srcDir.length + 1)}: ${oneLine(tag)}`)
    })
    expect(offenders, 'use a button.item, or wrap a button.item-tap inside div.item').toEqual([])
  })

  it('forwards accessible names through Switch and Check', () => {
    // 29 aug 2026 QA: all settings switches/checkboxes were unnamed because ...rest was dropped.
    // Server rendering exercises the public component API and actual JSX spread more honestly
    // than checking for a particular source spelling, while still keeping this suite DOM-free.
    const switchHtml = renderToStaticMarkup(createElement(Switch, {
      checked: false, onChange: () => {}, 'aria-label': 'Private profile',
    }))
    const checkHtml = renderToStaticMarkup(createElement(Check, {
      checked: false, onChange: () => {}, 'aria-label': 'Set complete',
    }))
    expect(switchHtml).toContain('aria-label="Private profile"')
    expect(checkHtml).toContain('aria-label="Set complete"')
  })

  it('gives every workout set field an accessible name', () => {
    // 29 aug 2026 QA: workout NumberField and Check controls exposed no accessible name.
    const source = readFileSync(`${srcDir}/views/Workout.jsx`, 'utf8')
    const fields = ['NumberField', 'Check'].flatMap(element => openingTags(source, element))
    expect(fields.length).toBeGreaterThan(0)
    expect(fields.filter(tag => !/\baria-label\s*=/.test(tag)).map(oneLine)).toEqual([])
  })
})
