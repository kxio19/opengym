import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { socialRankings, socialChallenges, createChallenge, joinChallenge, cancelChallenge } from '../lib/social-api.js'
import Icon from './Icon.jsx'
import { Button, Segmented, TextField } from './ui.jsx'

const metricLabels = { sessions: 'Sessions', minutes: 'Minutes', sets: 'Sets', volume: 'Volume', prs: 'PRs' }
const rankLabels = { volume: 'Volume', consistency: 'Consistency', minutes: 'Minutes', prs: 'PRs', streak: 'Streak' }
const metricUnit = key => key === 'volume' ? 'kg' : key === 'minutes' ? 'min' : key === 'streak' ? t('weeks') : ''

function Rankings({ data }) {
  if (!data?.rows?.length) return <div className="empty"><div className="ico"><Icon name="trophy" /></div>{t('No ranking activity this week.')}</div>
  return <>
    <div className="card podium"><h2>{t('Weekly podium')}</h2><div className="podium-row">{data.podium.map((row, i) => <div className={`podium-place p${i + 1}`} key={row.userId}><span>{['🥇', '🥈', '🥉'][i]}</span><b>{row.name}</b><strong>{row.score}</strong></div>)}</div><div className="small muted">{data.week} — {data.through} · {data.timeZone}</div></div>
    <div className="rank-grid">{data.activeCategories.map(key => <div className="card" key={key}><h3>{t(rankLabels[key])}</h3>{data.podiums[key].map((row, i) => <div className="rank-row" key={row.userId}><span>{i + 1}</span><b>{row.name}</b><span>{Math.round(row.metric[key] * 10) / 10} {metricUnit(key)}</span></div>)}</div>)}</div>
    <div className="card"><h3>{t('Overall ranking')}</h3>{data.rows.map((row, i) => <div className="rank-row" key={row.userId}><span>{i + 1}</span><b>{row.name}</b><strong>{row.score}</strong></div>)}</div>
  </>
}

function Challenges({ data, reload }) {
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
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
    <div className="challenge-list">{data?.challenges?.map(c => { const joined = c.participants.some(p => p.userId === user.id); return <div className="card" key={c.id}><div className="row between"><div><h3>{c.title}</h3><div className="small muted">{t(metricLabels[c.metric])} · {c.start} — {c.end}</div></div>{c.cancelledAt && <span className="tag">{t('Cancelled')}</span>}</div>
      <div className="challenge-board">{c.participants.slice(0, 5).map((p, i) => <div className="rank-row" key={p.userId}><span>{i + 1}</span><b>{p.name}</b><strong>{p.value}</strong></div>)}</div>
      {!joined && !c.cancelledAt && <Button size="sm" onClick={async () => { try { await joinChallenge(c.id); reload() } catch (e) { toast(e.message) } }}>{t('Join challenge')}</Button>}
      {(c.creatorId === user.id || user.admin) && !c.cancelledAt && <Button size="sm" variant="danger" onClick={async () => { try { await cancelChallenge(c.id); reload() } catch (e) { toast(e.message) } }}>{t('Cancel challenge')}</Button>}
    </div> })}</div>
  </>
}

export default function SocialStats() {
  const enabled = !!useStore(s => s.config)?.social?.enabled
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const [tab, setTab] = useState('rankings')
  const [rankings, setRankings] = useState(null)
  const [challenges, setChallenges] = useState(null)
  const load = async () => {
    try { const [r, c] = await Promise.all([socialRankings(), socialChallenges()]); setRankings(r); setChallenges(c) }
    catch (e) { toast(e.message) }
  }
  useEffect(() => { if (enabled && user) load() }, [enabled, user?.id])
  if (!enabled || !user) return null
  return <section style={{ marginTop: 28 }}>
    <h4 className="sec">{t('Training group')}</h4>
    <Segmented className="social-tabs" options={[{ value: 'rankings', label: t('Rankings') }, { value: 'challenges', label: t('Challenges') }]} value={tab} onChange={setTab} />
    {tab === 'rankings' ? <Rankings data={rankings} /> : <Challenges data={challenges} reload={load} />}
  </section>
}
