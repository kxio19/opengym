import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, dateLocale } from '../lib/i18n.js'
import { ACCENTS, todayISO } from '../lib/format.js'
import {
  SOCIAL_FIELD_DEFAULTS, socialMe, saveSocialMe, purgeSocial, socialFeed, socialRankings,
  socialChallenges, toggleKudos, addComment, deleteComment, createChallenge, joinChallenge, cancelChallenge
} from '../lib/social-api.js'
import Icon from '../components/Icon.jsx'
import { Button, Segmented, Switch, TextArea, TextField } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'

const fieldLabels = {
  exerciseNames: 'Exercise names', exactSets: 'Exact weights and reps', effort: 'RIR / RPE effort', volume: 'Total volume',
  bodyweight: 'Body weight', rating: 'Session rating', note: 'Session notes'
}
const metricLabels = { sessions: 'Sessions', minutes: 'Minutes', sets: 'Sets', volume: 'Volume', prs: 'PRs' }
const rankLabels = { volume: 'Volume', consistency: 'Consistency', minutes: 'Minutes', prs: 'PRs', streak: 'Streak' }
const metricUnit = key => key === 'volume' ? 'kg' : key === 'minutes' ? 'min' : key === 'streak' ? t('weeks') : ''

function ProfileSetup({ initial, onReady }) {
  const toast = useUI(s => s.toast)
  const [draft, setDraft] = useState({ ...initial, fields: { ...SOCIAL_FIELD_DEFAULTS, ...initial.fields }, notifications: { kudos: false, comments: false, challenges: false, ...initial.notifications } })
  const save = async enabled => {
    try { const { profile } = await saveSocialMe({ ...draft, enabled, rankingsEnabled: enabled && !!draft.rankingsEnabled }); onReady(profile); toast(t('Social preferences saved')) }
    catch (e) { toast(e.message) }
  }
  return <div className="narrow">
    <div className="social-hero"><Icon name="personCircle" /><h2>{t('Train together, share by choice')}</h2>
      <p>{t('Social is private to this invite-only openGym. Nothing from your old or imported history is shared.')}</p></div>
    <div className="card">
      <label className="field-label">{t('Display name')}</label>
      <TextField maxLength={40} value={draft.displayName} onChange={e => setDraft(d => ({ ...d, displayName: e.target.value }))} />
      <label className="field-label">{t('Short bio')}</label>
      <TextArea rows={2} maxLength={120} value={draft.bio} onChange={e => setDraft(d => ({ ...d, bio: e.target.value }))} />
      <div className="field-label">{t('Profile color')}</div>
      <div className="swatches">{Object.entries(ACCENTS).map(([key, color]) => <button key={key} aria-label={key} className={'swatch' + (draft.accent === key ? ' on' : '')} style={{ background: color }} onClick={() => setDraft(d => ({ ...d, accent: key }))} />)}</div>
    </div>
    <div className="card">
      <SocialToggle label={t('Join weekly rankings')} detail={t('Ranking totals are calculated even when a workout is not posted.')} checked={draft.rankingsEnabled} onChange={v => setDraft(d => ({ ...d, rankingsEnabled: v }))} />
      <SocialToggle label={t('Post workouts by default')} detail={t('You can change this for every workout before publishing.')} checked={draft.defaultPublish} onChange={v => setDraft(d => ({ ...d, defaultPublish: v }))} />
      <h4 className="sec">{t('Default shared details')}</h4>
      {Object.keys(SOCIAL_FIELD_DEFAULTS).map(key => <SocialToggle key={key} label={t(fieldLabels[key])} checked={draft.fields[key]} disabled={(key === 'exactSets' || key === 'effort') && !draft.fields.exerciseNames}
        onChange={v => setDraft(d => ({ ...d, fields: { ...d.fields, [key]: v, ...(key === 'exerciseNames' && !v ? { exactSets: false, effort: false } : {}) } }))} />)}
      <h4 className="sec">{t('Social notifications')}</h4>
      {Object.entries({ kudos: 'Kudos', comments: 'Comments', challenges: 'Challenges' }).map(([key, label]) => <SocialToggle key={key} label={t(label)} checked={!!draft.notifications[key]} onChange={v => setDraft(d => ({ ...d, notifications: { ...d.notifications, [key]: v } }))} />)}
    </div>
    <div className="card privacy-note"><Icon name="shield" /><div><b>{t('Privacy first')}</b><p>{t('The instance administrator can access server files. Social only exposes the fields selected above to other members.')}</p></div></div>
    <Button variant="primary" onClick={() => save(true)}>{t(initial.enabled ? 'Save' : 'Enable Social')}</Button>
  </div>
}

function SocialToggle({ label, detail, checked, onChange, disabled }) {
  return <div className="social-toggle"><div><div>{label}</div>{detail && <div className="small muted">{detail}</div>}</div><Switch checked={checked} disabled={disabled} onChange={onChange} /></div>
}

function Feed({ data, reload }) {
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const [comments, setComments] = useState({})
  const react = async post => { try { await toggleKudos(post.id, !post.kudosByMe); reload() } catch (e) { toast(e.message) } }
  const submit = async post => {
    const text = (comments[post.id] || '').trim(); if (!text) return
    try { await addComment(post.id, text); setComments(c => ({ ...c, [post.id]: '' })); reload() } catch (e) { toast(e.message) }
  }
  if (!data.posts?.length) return <div className="empty"><div className="ico"><Icon name="personCircle" /></div>{t('No shared workouts yet.')}</div>
  return <div className="social-feed">{data.posts.map(post => <article className="card social-post" key={post.id}>
    <div className="row between"><div className="row" style={{ gap: 9 }}><span className="social-avatar" data-accent={post.accent}>{post.author.slice(0, 2).toUpperCase()}</span><div><b>{post.author}</b><div className="small muted">{new Date(post.completedAt).toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' })}</div></div></div></div>
    <h3>{post.routine}</h3>
    <div className="social-stats"><span>{post.durationMinutes} min</span><span>{post.setCount} {t('sets')}</span><span>{post.exerciseCount} {t('exercises')}</span><span>{post.prCount} PR</span>{post.volume !== undefined && <span>{Math.round(post.volume)} {post.unit}</span>}</div>
    {!!post.entries?.length && <details><summary>{t('Workout details')}</summary>{post.entries.map(entry => <div className="social-entry" key={entry.id}><b>{entry.name}</b>{entry.sets?.length ? <span>{entry.sets.map(s => `${s.weight}×${s.reps}`).join(' · ')}</span> : null}</div>)}</details>}
    {post.bodyweight !== undefined && <p className="small">{t('Body weight')}: {post.bodyweight} {post.bodyweightUnit}</p>}
    {post.rating && <p className="small">{t('Session rating')}: {post.rating}</p>}{post.note && <p className="social-note">{post.note}</p>}
    <div className="social-actions"><Button size="sm" icon="heart" disabled={post.userId === user.id} style={post.kudosByMe ? { color: 'var(--pink)' } : null} onClick={() => react(post)}>{post.kudos || ''} {t('Kudos')}</Button></div>
    <div className="social-comments">{post.comments?.map(c => <div key={c.id}><span><b>{c.author}</b> {c.text}</span>{(c.mine || user.admin) && <button aria-label={t('Delete')} onClick={async () => { await deleteComment(c.id); reload() }}><Icon name="trash" /></button>}</div>)}</div>
    <div className="social-comment-box"><TextField maxLength={300} value={comments[post.id] || ''} placeholder={t('Add a comment…')} onChange={e => setComments(c => ({ ...c, [post.id]: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') submit(post) }} /><Button size="sm" onClick={() => submit(post)}>{t('Send')}</Button></div>
  </article>)}</div>
}

function Rankings({ data }) {
  if (!data.rows?.length) return <div className="empty"><div className="ico"><Icon name="trophy" /></div>{t('No ranking activity this week.')}</div>
  return <>
    <div className="card podium"><h2>{t('Weekly podium')}</h2><div className="podium-row">{data.podium.map((row, i) => <div className={`podium-place p${i + 1}`} key={row.userId}><span>{['🥇', '🥈', '🥉'][i]}</span><b>{row.name}</b><strong>{row.score}</strong></div>)}</div><div className="small muted">{data.week} — {data.through} · {data.timeZone}</div></div>
    <div className="rank-grid">{data.activeCategories.map(key => <div className="card" key={key}><h3>{t(rankLabels[key])}</h3>{data.podiums[key].map((row, i) => <div className="rank-row" key={row.userId}><span>{i + 1}</span><b>{row.name}</b><span>{Math.round(row.metric[key] * 10) / 10} {metricUnit(key)}</span></div>)}</div>)}</div>
    <div className="card"><h3>{t('Overall ranking')}</h3>{data.rows.map((row, i) => <div className="rank-row" key={row.userId}><span>{i + 1}</span><b>{row.name}</b><strong>{row.score}</strong></div>)}</div>
  </>
}

function Challenges({ data, reload }) {
  const user = useStore(s => s.user), toast = useUI(s => s.toast)
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
  const [show, setShow] = useState(false)
  const [draft, setDraft] = useState({ title: '', metric: 'sessions', start: todayISO(), end: tomorrow.toISOString().slice(0, 10) })
  const create = async () => { try { await createChallenge(draft); setShow(false); reload() } catch (e) { toast(e.message) } }
  return <>
    <Button variant="primary" icon="plus" onClick={() => setShow(v => !v)}>{t('Create challenge')}</Button>
    {show && <div className="card challenge-form"><TextField maxLength={80} placeholder={t('Challenge title')} value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} />
      <Segmented options={Object.keys(metricLabels).map(value => ({ value, label: t(metricLabels[value]) }))} value={draft.metric} onChange={metric => setDraft(d => ({ ...d, metric }))} />
      <div className="row" style={{ gap: 8 }}><input className="field" type="date" value={draft.start} onChange={e => setDraft(d => ({ ...d, start: e.target.value }))} /><input className="field" type="date" value={draft.end} onChange={e => setDraft(d => ({ ...d, end: e.target.value }))} /></div>
      <Button onClick={create}>{t('Publish challenge')}</Button></div>}
    <div className="challenge-list">{data.challenges?.map(c => { const joined = c.participants.some(p => p.userId === user.id); return <div className="card" key={c.id}><div className="row between"><div><h3>{c.title}</h3><div className="small muted">{t(metricLabels[c.metric])} · {c.start} — {c.end}</div></div>{c.cancelledAt && <span className="tag">{t('Cancelled')}</span>}</div>
      <div className="challenge-board">{c.participants.slice(0, 5).map((p, i) => <div className="rank-row" key={p.userId}><span>{i + 1}</span><b>{p.name}</b><strong>{p.value}</strong></div>)}</div>
      {!joined && !c.cancelledAt && <Button size="sm" onClick={async () => { await joinChallenge(c.id); reload() }}>{t('Join challenge')}</Button>}
      {(c.creatorId === user.id || user.admin) && !c.cancelledAt && <Button size="sm" variant="danger" onClick={async () => { await cancelChallenge(c.id); reload() }}>{t('Cancel challenge')}</Button>}
    </div> })}</div>
  </>
}

export default function Social() {
  const nav = useNavigate(), config = useStore(s => s.config), user = useStore(s => s.user), toast = useUI(s => s.toast)
  const [tab, setTab] = useState('feed'), [profile, setProfile] = useState(null), [payload, setPayload] = useState({ posts: [], rows: [], challenges: [] }), [loading, setLoading] = useState(true)
  const load = async current => {
    try {
      const me = current ? { profile: current } : await socialMe(); setProfile(me.profile)
      if (me.profile.enabled) {
        const [feed, rankings, challenges] = await Promise.all([socialFeed(), socialRankings(), socialChallenges()])
        setPayload({ ...feed, ...rankings, ...challenges })
      }
    } catch (e) { toast(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { if (config?.social?.enabled) load() }, [config?.social?.enabled])
  if (!user) return <div className="narrow"><div className="hdr"><button className="iconbtn" onClick={() => nav('/home')}><Icon name="chevronLeft" /></button><h1>{t('Social')}</h1></div><div className="empty">{t('Sign in with a profile to use Social.')}</div></div>
  if (!config?.social?.enabled) return <div className="narrow"><div className="hdr"><button className="iconbtn" onClick={() => nav('/home')}><Icon name="chevronLeft" /></button><h1>{t('Social')}</h1></div><div className="empty">{t('Social is not enabled on this instance.')}</div></div>
  if (loading || !profile) return <div className="empty">{t('Loading…')}</div>
  if (!profile.enabled) return <><div className="hdr narrow"><button className="iconbtn" onClick={() => nav('/home')}><Icon name="chevronLeft" /></button><h1>{t('Social')}</h1></div><ProfileSetup initial={profile} onReady={p => { setProfile(p); load(p) }} /></>
  return <div className="narrow social-page">
    <div className="hdr"><button className="iconbtn" onClick={() => nav('/home')}><Icon name="chevronLeft" /></button><div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Social')}</h1><div className="sub">{t('Your private training group')}</div></div><button className="iconbtn" onClick={() => setTab('settings')}><Icon name="gear" /></button></div>
    <Segmented className="social-tabs" options={[{ value: 'feed', label: t('Feed') }, { value: 'rankings', label: t('Rankings') }, { value: 'challenges', label: t('Challenges') }]} value={tab === 'settings' ? 'feed' : tab} onChange={setTab} />
    {tab === 'feed' && <Feed data={payload} reload={() => load(profile)} />}
    {tab === 'rankings' && <Rankings data={payload} />}
    {tab === 'challenges' && <Challenges data={payload} reload={() => load(profile)} />}
    {tab === 'settings' && <><ProfileSetup initial={profile} onReady={p => { setProfile(p); setTab('feed'); load(p) }} /><div style={{ height: 8 }} /><Button variant="danger" onClick={() => confirmSheet({ title: t('Delete Social data?'), message: t('Your private workouts stay intact. Your social profile, posts, comments and challenge memberships are deleted.'), confirmText: t('Delete'), danger: true, onConfirm: async () => { const { profile: p } = await purgeSocial(); setProfile(p); setPayload({ posts: [], rows: [], challenges: [] }); setTab('feed') } })}>{t('Disable and delete Social')}</Button></>}
  </div>
}
