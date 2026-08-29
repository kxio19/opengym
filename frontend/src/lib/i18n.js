// Tiny dependency-free i18n. English source strings are the keys; locale files in
// src/locales/ map them to translations and are lazy-loaded (Vite code-splits each
// import.meta.glob entry), so the initial bundle stays English-only.
// Exercise instructions come from separately generated packs in src/instr/ (one per
// language, from the upstream dataset) — loaded after the UI locale so they never block paint.
import { useSyncExternalStore } from 'react'

// UI languages. de/pt have no instruction pack upstream — instructions fall back to English.
export const LANGS = {
  en: 'English', de: 'Deutsch', es: 'Español', fr: 'Français', it: 'Italiano',
  pt: 'Português', pl: 'Polski', tr: 'Türkçe', ru: 'Русский', zh: '中文',
  ko: '한국어', hi: 'हिन्दी'
}
export const INSTR_LANGS = ['en', 'es', 'fr', 'it', 'tr', 'ru', 'zh', 'hi', 'pl', 'ko']
const DATE_LOCALES = {
  en: 'en-GB', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', it: 'it-IT', pt: 'pt-PT',
  pl: 'pl-PL', tr: 'tr-TR', ru: 'ru-RU', zh: 'zh-CN', ko: 'ko-KR', hi: 'hi-IN'
}

const localePacks = import.meta.glob('../locales/*.js')
const instrPacks = import.meta.glob('../instr/*.js')

let lang = 'es'
let dict = {}
let instr = null            // { exId: [steps] } for the current language, null = English
let langRequest = 0         // discards locale/instruction results from stale language switches
let version = 0
const subs = new Set()
const notify = () => { version++; subs.forEach(f => f()) }

export const getLang = () => lang
export const dateLocale = () => DATE_LOCALES[lang] || 'es-ES'

// Translate a source string; {0},{1}… are replaced with args (also on the English fallback).
export function t(s, ...args) {
  let v = dict[s] || s
  for (let i = 0; i < args.length; i++) v = v.replaceAll('{' + i + '}', args[i])
  return v
}
// Instructions for an exercise in the current language (English steps as fallback).
export const instrFor = ex => (instr && instr[ex.id]) || ex.st || []

async function loadInstr(l, request) {
  try {
    const nextInstr = (await instrPacks['../instr/' + l + '.js']()).default
    if (request !== langRequest || l !== lang) return
    instr = nextInstr
    notify()
  } catch { /* English exercise text remains the fallback. */ }
}

export async function setLang(l) {
  if (!LANGS[l]) l = 'es'
  if (l === lang && version > 0) return
  const request = ++langRequest
  lang = l
  instr = null
  let nextDict
  try {
    nextDict = l === 'en' ? {} : (await localePacks['../locales/' + l + '.js']()).default
  } catch (e) {
    if (request !== langRequest || l !== lang) return
    dict = {}
    notify()
    return
  }
  if (request !== langRequest || l !== lang) return
  dict = nextDict
  notify()
  if (l !== 'en' && INSTR_LANGS.includes(l)) void loadInstr(l, request)
}

// Re-renders the subscribing component (and its children) whenever the language changes.
export function useLang() {
  return useSyncExternalStore(fn => { subs.add(fn); return () => subs.delete(fn) }, () => version)
}
