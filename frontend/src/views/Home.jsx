import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutine, effectiveRoutineId, planStreak, lastBW, setsDoneActive } from '../lib/history.js'
import { fmtNum, fmtDate, todayISO, isoOf, DAYS } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { bwSheet, goalSheet, dayOverrideSheet, calendarSheet, startFlow, loadStarterPlan, bwDeltaColor } from '../sheets.jsx'
import PostCard from '../components/PostCard.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { glyphOf } from '../lib/glyphs.js'
import { coachAvailable, hasConsent } from '../lib/coach.js'
import { useCoachStatus } from '../lib/coach-api.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { socialFeed, toggleKudos } from '../lib/social-api.js'
import { useUI } from '../store/useUI.js'

const FEED_PAGE = 15

// The feed IS Home once you're past the week card — an infinite list of the group's posts,
// paginated by the feed endpoint's completedAt cursor. GET /api/social/feed always returns
// `next` as the oldest post *of the page just returned*, not "the true end of everything", so
// the only reliable stop signal is a page shorter than what was asked for (including empty).
function Feed() {
  const toast = useUI(s => s.toast)
  const [posts, setPosts] = useState(null)
  const [cursor, setCursor] = useState('')
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const sentinel = useRef(null)

  const loadMore = async (before = '') => {
    if (loading) return
    setLoading(true)
    try {
      const { posts: page } = await socialFeed(FEED_PAGE, before)
      setPosts(prev => before ? [...(prev || []), ...page] : page)
      setCursor(page.at(-1)?.completedAt || '')
      setHasMore(page.length === FEED_PAGE)
    } catch (e) { toast(e.message) } finally { setLoading(false) }
  }

  useEffect(() => { loadMore() }, [])

  useEffect(() => {
    if (!hasMore || !sentinel.current) return
    const io = new IntersectionObserver(entries => { if (entries[0].isIntersecting) loadMore(cursor) }, { rootMargin: '600px' })
    io.observe(sentinel.current)
    return () => io.disconnect()
  }, [cursor, hasMore, loading])

  const kudos = async post => {
    setPosts(prev => prev.map(p => p.id === post.id ? { ...p, kudosByMe: !p.kudosByMe, kudos: (p.kudos || 0) + (p.kudosByMe ? -1 : 1) } : p))
    try { await toggleKudos(post.id, !post.kudosByMe) } catch (e) { toast(e.message) }
  }

  if (posts === null) return null   // first page still loading — nothing to flash before it lands
  if (!posts.length) return <div className="empty"><div className="ico"><Icon name="personCircle" /></div>{t('No shared workouts yet — finish a workout to be the first.')}</div>
  return <>
    {posts.map(post => <PostCard key={post.id} post={post} onKudos={kudos} />)}
    <div ref={sentinel} style={{ height: 1 }} />
    {loading && <div className="dim small" style={{ textAlign: 'center', padding: '10px 0' }}>{t('Loading…')}</div>}
  </>
}

// A job in flight or a proposal waiting is the only reason the Coach interrupts Home. When it
// has nothing to say it renders nothing at all — and it only polls while Home is on screen.
function CoachCard({ nav }) {
  const S = useStore(s => s.S)
  const { job, pending } = useCoachStatus(hasConsent(S))
  if (!hasConsent(S) || (!job && !pending)) return null
  const ready = !!pending
  return <div className="card" style={ready ? { borderColor: 'var(--acc)' } : null}>
    <div className="today-row" onClick={() => nav(ready ? '/coach/proposal' : '/coach')}>
      <div className="row" style={{ gap: 9, minWidth: 0 }}>
        <span className="lrow-i" style={{ background: ready ? 'var(--acc)' : 'var(--orange)' }}><Icon name="sparkles" /></span>
        <div style={{ minWidth: 0 }}>
          <div className="lbl2">{t('Coach')}</div>
          <div className="ttl">{ready
            ? (pending.kind === 'create'
              ? t('Your plan is ready')
              : t(pending.changes?.length === 1 ? '{0} suggestion for you' : '{0} suggestions for you', pending.changes?.length || 0))
            : t('Reading your training…')}</div>
        </div>
      </div>
      {ready ? <span className="tag acc">{t('Review')}</span> : <Icon name="chevronRight" className="chev" />}
    </div>
  </div>
}

// Home = what to do now + a quick glance + the group's feed. Deep charts & history live in Stats.
export default function Home() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const [weekOffset, setWeekOffset] = useState(0)
  const coachOn = coachAvailable(config, user, { demo: DEMO, mobile: MOBILE })

  const today = new Date()
  const routine = effectiveRoutine(S, todayISO())
  const todayOvr = S.dayPlan[todayISO()] !== undefined
  const bw = lastBW(S)
  const prevBW = S.bodyweight.length > 1 ? S.bodyweight[S.bodyweight.length - 2] : null
  const delta = bw && prevBW ? bw.w - prevBW.w : null
  const streak = planStreak(S)

  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + weekOffset * 7)
  const doneDays = new Set(S.workouts.map(w => w.d))
  const strip = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i)
    const iso = isoOf(d)
    const eff = effectiveRoutineId(S, iso), ovr = S.dayPlan[iso] !== undefined, done = doneDays.has(iso)
    const dot = done ? ' done' : ovr && eff ? ' ovr' : eff ? ' plan' : ''
    strip.push(<div key={i} className={'wday' + (iso === todayISO() ? ' today' : '')} onClick={() => dayOverrideSheet(iso)}>
      <div className="lbl">{t(DAYS[d.getDay()])}</div><div className="num">{d.getDate()}</div><div className={'dot' + dot} /></div>)
  }
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
  const wkLabel = weekOffset === 0 ? t('This week') : `${monday.getDate()} ${monday.toLocaleDateString(dateLocale(), { month: 'short' })} – ${sunday.getDate()} ${sunday.toLocaleDateString(dateLocale(), { month: 'short' })}`

  // today's session shown right under the week strip
  const onToday = () => { if (S.active) nav('/workout'); else if (routine) startFlow(routine.id); else dayOverrideSheet(todayISO()) }

  return <div className="narrow">
    <div className="hdr">
      <div><h1>{user ? t('Hi {0}', user.name) : 'openGym'}</h1><div className="sub">{today.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
      <div className="row" style={{ gap: 6 }}>
        {!!streak && <button className="iconbtn streak-btn" onClick={() => calendarSheet()} aria-label={t('{0}-day streak', streak)}>
          <Icon name="flame" style={{ color: 'var(--orange)' }} /><span>{streak}</span>
        </button>}
        <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="gear" /></button>
      </div>
    </div>

    <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setWeekOffset(w => w - 1)} aria-label={t('Previous week')}><Icon name="chevronLeft" /></button>
        <div className="small muted" style={{ fontWeight: 500 }}>{wkLabel}</div>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setWeekOffset(w => w + 1)} aria-label={t('Next week')}><Icon name="chevronRight" /></button>
      </div>
      <div className="week">{strip}</div>
      <div className="today-row" onClick={onToday}>
        <div className="row" style={{ gap: 9, minWidth: 0 }}>
          <span className="lrow-i" style={{ background: S.active ? 'var(--orange)' : routine ? 'var(--acc)' : 'var(--surface-3)' }}>
            <Icon name={S.active ? 'timer' : routine ? glyphOf(routine.emoji) : 'moon'} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="lbl2">{t('Today')}</div>
            <div className="ttl">{S.active ? t('{0} — in progress', S.active.name) : routine ? routine.name : t('Rest day')}{todayOvr && routine ? ' · ' + t('rescheduled') : ''}</div>
          </div>
        </div>
        {S.active ? <span className="tag" style={{ color: 'var(--orange)', background: 'color-mix(in srgb,var(--orange) 16%,transparent)' }}>{t('Resume')}</span>
          : routine ? <span className="tag acc">{t('Start')}</span>
          : <Icon name="plus" className="chev" />}
      </div>
      {/* Full history and the trend chart live in Stats now — this is only ever a glance + a
          one-tap log, so the week card doesn't have to compete with the feed for space. */}
      <div className="week-weight-row" onClick={() => bwSheet()}>
        <Icon name="scale" style={{ color: 'var(--label-2)' }} />
        {bw ? <>
          <span>{fmtNum(bw.w)} {S.unit}</span>
          {!!delta && <span className="small row" style={{ gap: 2, fontWeight: 500, color: bwDeltaColor(delta, bw.w) }}>
            <Icon name={delta > 0 ? 'arrowUp' : 'arrowDown'} style={{ fontSize: 11 }} />{fmtNum(Math.abs(delta))}
          </span>}
        </> : <span className="muted">{t('Log your weight')}</span>}
        <span className="dim">{bw ? fmtDate(bw.d, true) : ''}</span>
        <Icon name="plus" className="chev" />
      </div>
    </div>

    {!S.routines.length && !S.active && (
      <div className="card">
        <div className="row" style={{ gap: 10, marginBottom: 6 }}>
          <span className="lrow-i"><Icon name="sparkles" /></span>
          <div className="big" style={{ fontSize: 22 }}>{t('Welcome!')}</div>
        </div>
        <div className="muted small" style={{ marginBottom: 12 }}>{t('Set up your weekly routine to get going — or load a ready-made Push / Pull / Legs plan.')}</div>
        {coachOn && <>
          <Button variant="primary" icon="sparkles" onClick={() => nav(hasConsent(S) ? '/coach/intake' : '/coach')}>{t('Let the Coach build it')}</Button>
          <div style={{ height: 8 }} />
        </>}
        <Button variant={coachOn ? 'plain' : 'primary'} icon="sparkles" onClick={loadStarterPlan}>{t('Load starter plan (PPL)')}</Button>
        <div style={{ height: 8 }} /><Button onClick={() => nav('/plan')}>{t('Build my own plan')}</Button>
      </div>
    )}

    {coachOn && <CoachCard nav={nav} />}

    {config?.social?.enabled && <Feed />}
  </div>
}
