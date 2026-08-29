import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { fmtDate, fmtNum, fmtVol, fmtDur, setCount, workoutCount } from '../lib/format.js'
import { workoutVolume, setsDone } from '../lib/history.js'
import { confirmSheet } from '../sheets.jsx'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button, TextField } from '../components/ui.jsx'
import AdminCoach from './AdminCoach.jsx'

// Admin-only operator dashboard (owner passkey + admin flag; guarded again server-side).
// Translated like the rest of the app: the operator of a self-hosted instance is a user too,
// and on this one they do not read English.

const rel = ts => {
  if (!ts) return t('never')
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return t('just now')
  if (s < 3600) return t('{0}m ago', Math.floor(s / 60))
  if (s < 86400) return t('{0}h ago', Math.floor(s / 3600))
  return t('{0}d ago', Math.floor(s / 86400))
}
const dur = ms => { const m = Math.max(0, Math.floor(ms / 60000)); return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h' + (m % 60) + 'm' }

function UserDetail({ id, onChanged, close }) {
  const [d, setD] = useState(null)
  const toast = useUI(s => s.toast)
  useEffect(() => { api('/api/admin/user?id=' + encodeURIComponent(id)).then(setD).catch(e => toast(e.message)) }, [id])
  if (!d) return <div className="muted small">{t('Loading…')}</div>
  const u = d.user
  const setDisabled = disabled => {
    api('/api/admin/user/disable', { method: 'POST', body: JSON.stringify({ id: u.id, disabled }) })
      .then(() => { toast(disabled ? t('User disabled') : t('User enabled')); onChanged(); close() })
      .catch(e => toast(e.message))
  }
  return <>
    <h3 className="capitalize">{u.name}</h3>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0 12px' }}>
      {u.admin && <span className="tag acc">{t('admin')}</span>}
      {u.disabled && <span className="tag" style={{ color: 'var(--red)' }}>{t('disabled')}</span>}
      {u.invitedBy && <span className="tag">{t('invite {0}', u.invitedBy)}</span>}
      <span className="tag">{t('joined {0}', u.created ? fmtDate(u.created.slice(0, 10)) : '—')}</span>
    </div>
    <div className="tiles" style={{ textAlign: 'left' }}>
      <div className="tile"><div className="l">{t('Workouts')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.workouts.length}</div></div>
      <div className="tile"><div className="l">{t('Weigh-ins')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.bodyweight.length}</div></div>
      <div className="tile"><div className="l">{t('Routines')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.routines.length}</div></div>
      <div className="tile"><div className="l">{t('Last sync')}</div><div className="v" style={{ fontSize: '.95rem' }}>{rel(d.lastSync)}</div></div>
    </div>
    {!u.admin && <button className={'btn ' + (u.disabled ? 'primary' : 'danger')} style={{ margin: '12px 0 4px' }}
      onClick={() => u.disabled ? setDisabled(false)
        : confirmSheet({ title: t('Disable {0}?', u.name), message: t('They are signed out everywhere and can no longer sync or log in until re-enabled.'), confirmText: t('Disable'), danger: true, onConfirm: () => setDisabled(true) })}>
      {u.disabled ? t('Enable account') : t('Disable account')}</button>}
    <AccessCard d={d} reload={() => api('/api/admin/user?id=' + encodeURIComponent(id)).then(setD).catch(e => toast(e.message))} />
    <h4 className="sec">{t('Workout history')}</h4>
    {d.workouts.length ? <div className="list" style={{ gap: 0 }}>
      {d.workouts.slice(0, 60).map(w => <div key={w.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div><div className="small" style={{ fontWeight: 600 }}>{w.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{fmtDate(w.d, true)} · {fmtDur((w.end || w.start) - w.start)} · {setCount(setsDone(w))}{w.prs?.length ? ' · ' + t('{0} PR', w.prs.length) : ''}</div></div>
        <span className="small muted">{fmtVol(w.vol ?? workoutVolume(w), d.unit)}</span>
      </div>)}
    </div> : <div className="empty small">{t('No workouts logged.')}</div>}
  </>
}

// Account rescue. Someone who loses their only passkey cannot use /api/recovery/regenerate —
// it asks for the passkey they no longer have — so without this the account is simply gone.
// Both actions amount to being able to sign in as that person, so both are logged and the log
// is shown here and in their own Settings screen.
function AccessCard({ d, reload }) {
  const toast = useUI(s => s.toast)
  const [issued, setIssued] = useState(null)   // { kind, value } — shown once, never re-fetchable
  const [chosen, setChosen] = useState('')
  const a = d.access || {}
  const atRisk = !a.hasPassword && !a.recoveryCodesLeft && (a.passkeys || 0) <= 1

  const run = (path, body, kind) => api(path, { method: 'POST', body: JSON.stringify({ id: d.user.id, ...body }) })
    .then(r => { if (r.code || r.secret) setIssued({ kind, value: r.code || r.secret }); else { toast(t('Password set')); setIssued(null) }; setChosen(''); reload() })
    .catch(e => toast(e.message))

  const copy = () => navigator.clipboard?.writeText(issued.value)
    .then(() => toast(t('Copied'))).catch(() => toast(t('Could not copy')))

  return <>
    <h4 className="sec">{t('Access')}</h4>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
      <span className="tag">{a.passkeys === 1 ? t('1 passkey') : t('{0} passkeys', a.passkeys || 0)}</span>
      <span className="tag">{a.hasPassword ? t('password/PIN set') : t('no password')}</span>
      <span className="tag">{t('{0} recovery codes', a.recoveryCodesLeft || 0)}</span>
      {a.mustChangeSecret && <span className="tag" style={{ color: 'var(--orange)' }}>{t('must change password')}</span>}
      {atRisk && <span className="tag" style={{ color: 'var(--red)' }}>{t('one way in')}</span>}
    </div>

    {issued ? <div className="card" style={{ borderLeft: '3px solid var(--orange)', marginBottom: 10 }}>
      <div className="small" style={{ fontWeight: 600, marginBottom: 4 }}>
        {issued.kind === 'code' ? t('One-time recovery code') : t('Temporary password')}</div>
      <pre style={{ userSelect: 'all', margin: '6px 0', letterSpacing: '.06em' }}>{issued.value}</pre>
      <div className="dim" style={{ fontSize: '.72rem', marginBottom: 8 }}>
        {t('Shown once — the server keeps only a hash. Send it over a channel you trust, and never paste it back into this app.')}</div>
      <div className="row" style={{ gap: 8 }}>
        <Button onClick={copy}>{t('Copy')}</Button>
        <Button variant="primary" onClick={() => setIssued(null)}>{t('Done')}</Button>
      </div>
    </div> : <>
      <Button style={{ marginBottom: 8 }} onClick={() => confirmSheet({
        title: t('Issue a recovery code?'),
        message: t('Generates one single-use code for {0}. Codes they already hold keep working. This is logged and shown to them.', d.user.name),
        confirmText: t('Issue code'),
        onConfirm: () => run('/api/admin/user/recovery-code', {}, 'code')
      })}>{t('Issue recovery code')}</Button>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <TextField value={chosen} onChange={e => setChosen(e.target.value)} placeholder={t('Password to set (blank = generate)')} maxLength={128} />
        <Button onClick={() => confirmSheet({
          title: t('Reset password for {0}?', d.user.name),
          message: t('They will be asked to choose a new one at their next sign-in. Their sessions are not ended. This is logged and shown to them.'),
          confirmText: t('Reset'), danger: true,
          onConfirm: () => run('/api/admin/user/password-reset', chosen ? { secret: chosen } : {}, 'secret')
        })}>{t('Reset')}</Button>
      </div>
    </>}

    {!!d.adminActions?.length && <div className="dim" style={{ fontSize: '.72rem', marginTop: 10 }}>
      {d.adminActions.map((x, i) => <div key={i}>
        {x.action === 'recovery-code' ? t('Recovery code issued') : t('Password reset')} · {fmtDate(x.ts.slice(0, 10), true)}
      </div>)}
    </div>}
  </>
}

function InvitesCard({ invites, reload }) {
  const toast = useUI(s => s.toast)
  const gen = () => api('/api/admin/invites/new', { method: 'POST', body: '{}' })
    .then(({ invite }) => { navigator.clipboard?.writeText(invite.code).catch(() => {}); toast(t('Code {0} created and copied', invite.code)); reload() })
    .catch(e => toast(e.message))
  const revoke = code => api('/api/admin/invites/revoke', { method: 'POST', body: JSON.stringify({ code }) })
    .then(() => { toast(t('Code revoked')); reload() }).catch(e => toast(e.message))
  const open = (invites || []).filter(i => !i.usedBy)
  const used = (invites || []).filter(i => i.usedBy)
  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>{t('Invite codes')}</h2>
      <Button variant="primary" size="sm" onClick={gen} icon="plus">{t('Generate')}</Button></div>
    <div className="small muted" style={{ margin: '6px 0 10px' }}>{t('{0} unused · {1} redeemed', open.length, used.length)}</div>
    {open.map(i => <div key={i.code} className="row between" style={{ padding: '7px 2px', borderBottom: '1px solid var(--sep)' }}>
      <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontWeight: 500, letterSpacing: '.06em' }}
        onClick={() => { navigator.clipboard?.writeText(i.code).catch(() => {}); toast(t('Copied {0}', i.code)) }}>{i.code}</span>
      <button className="iconbtn" style={{ width: 32, height: 30, borderRadius: 8, fontSize: 15, color: 'var(--red)' }} onClick={() => revoke(i.code)} aria-label={t('revoke')}><Icon name="trash" /></button>
    </div>)}
    {used.map(i => <div key={i.code} className="row between dim" style={{ padding: '7px 2px', fontSize: '.8rem' }}>
      <span style={{ fontFamily: 'monospace' }}>{i.code}</span><span>→ {i.usedByName || t('used')}</span>
    </div>)}
    {!open.length && !used.length && <div className="dim small">{t('No codes yet — generate one to invite someone.')}</div>}
  </div>
}

function SocialModeration({ data, reload }) {
  const toast = useUI(s => s.toast)
  if (!data?.enabled) return null
  const act = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) }).then(() => { toast(t('Social content removed')); reload() }).catch(e => toast(e.message))
  return <div className="card"><div className="row between"><h2 style={{ margin: 0 }}>{t('Social moderation')}</h2><span className="tag acc">{t('{0} members', data.profiles.filter(p => p.enabled).length)}</span></div>
    <div className="small muted" style={{ margin: '6px 0 10px' }}>{t('{0} posts · {1} comments · {2} challenges', data.posts.length, data.comments.length, data.challenges.length)}</div>
    {data.posts.slice(0, 8).map(post => <div key={post.id} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--sep)' }}><div><b className="small">{post.author}</b><div className="dim" style={{ fontSize: '.72rem' }}>{post.routine} · {fmtDate(post.date, true)}</div></div><button className="iconbtn" style={{ color: 'var(--red)', width: 32, height: 32 }} aria-label={t('remove post')} onClick={() => confirmSheet({ title: t('Remove social post?'), message: t('The member’s private workout remains intact.'), confirmText: t('Remove'), danger: true, onConfirm: () => act('/api/admin/social/remove-post', { postId: post.id }) })}><Icon name="trash" /></button></div>)}
    {data.comments.slice(0, 8).map(comment => <div key={comment.id} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--sep)' }}><div><b className="small">{comment.author}</b><div className="dim" style={{ fontSize: '.72rem' }}>{comment.text}</div></div><button className="iconbtn" style={{ color: 'var(--red)', width: 32, height: 32 }} aria-label={t('remove comment')} onClick={() => act('/api/admin/social/remove-comment', { commentId: comment.id })}><Icon name="trash" /></button></div>)}
  </div>
}

export default function Admin() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [users, setUsers] = useState(null)
  const [invites, setInvites] = useState(null)
  const [inviteOnly, setInviteOnly] = useState(false)
  const [social, setSocial] = useState(null)

  const loadUsers = () => api('/api/admin/users').then(d => { setUsers(d.users); setInviteOnly(d.invite_only) }).catch(e => toast(e.message || t('Failed to load')))
  const loadInvites = () => api('/api/admin/invites').then(d => setInvites(d.invites)).catch(() => {})
  const loadSocial = () => api('/api/admin/social').then(setSocial).catch(() => {})
  // poll every 15s so the "training now" section stays live without a manual refresh
  useEffect(() => { if (!user?.admin) return; loadUsers(); loadInvites(); loadSocial(); const iv = setInterval(loadUsers, 15000); return () => clearInterval(iv) }, [])
  if (!user?.admin) return null

  const openUser = id => openSheet(close => <UserDetail id={id} onChanged={loadUsers} close={close} />)
  const liveUsers = (users || []).filter(u => u.live)
  const activeCount = (users || []).filter(u => u.lastSync && Date.now() - u.lastSync < 7 * 86400000).length
  const disabledCount = (users || []).filter(u => u.disabled).length

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Admin')}</h1>
        <div className="sub">{users ? t('{0} users · {1} active this week', users.length, activeCount) : t('Loading…')}</div></div>
      <button className="iconbtn" onClick={() => { loadUsers(); loadInvites(); loadSocial() }} aria-label={t('refresh')}>↻</button>
    </div>

    <div className="tiles" style={{ marginBottom: 12 }}>
      <div className="tile"><div className="l">{t('Users')}</div><div className="v">{users ? users.length : '—'}</div></div>
      <div className="tile"><div className="l">{t('Training now')}</div><div className="v" style={{ color: liveUsers.length ? 'var(--acc)' : undefined }}>{users ? liveUsers.length : '—'}</div></div>
      <div className="tile"><div className="l">{t('Active 7d')}</div><div className="v">{users ? activeCount : '—'}</div></div>
      <div className="tile"><div className="l">{t('Disabled')}</div><div className="v">{users ? disabledCount : '—'}</div></div>
    </div>

    {liveUsers.length > 0 && <div className="card" style={{ borderColor: 'var(--acc)' }}>
      <h2 className="row" style={{ margin: '0 0 8px', gap: 6 }}><Icon name="dot" style={{ fontSize: 10, color: 'var(--green)' }} />{t('Training now')}</h2>
      {liveUsers.map(u => <div key={u.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)' }} onClick={() => openUser(u.id)}>
        <div><div className="small" style={{ fontWeight: 600 }}>{u.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{u.live.name} · {t('ex {0}/{1}', u.live.exIdx, u.live.exTotal)} · {t('{0}/{1} sets', u.live.setsDone, u.live.setsTotal)}</div></div>
        <span className="tag acc">{dur(Date.now() - u.live.startedAt)}</span>
      </div>)}
    </div>}

    <AdminCoach />

    <SocialModeration data={social} reload={loadSocial} />

    <InvitesCard invites={invites} reload={loadInvites} />

    <h4 className="sec">{t('Users')}</h4>
    <div className="list">
      {(users || []).map(u => <button type="button" key={u.id} className="item" onClick={() => openUser(u.id)} style={u.disabled ? { opacity: .55 } : null}>
        <div className="grow"><div className="tt">{u.live && <Icon name="dot" style={{ fontSize: 9, color: 'var(--green)', display: 'inline-block', marginRight: 5 }} />}{u.name} {u.admin && <span className="tag acc" style={{ marginLeft: 4 }}>{t('admin')}</span>}{u.disabled && <span className="tag" style={{ marginLeft: 4, color: 'var(--red)' }}>{t('off')}</span>}</div>
          <div className="ss">{u.live ? t('training now') + ' · ' + u.live.name : workoutCount(u.workouts) + (u.lastWorkout ? ' · ' + t('last {0}', fmtDate(u.lastWorkout)) : '') + ' · ' + t('synced {0}', rel(u.lastSync))}</div></div>
        {u.hasPush && <Icon name="bell" title={t('push enabled')} style={{ fontSize: 15, color: 'var(--label-3)' }} />}<Icon name="chevronRight" className="chev" />
      </button>)}
      {users && !users.length && <div className="empty">{t('No users yet.')}</div>}
    </div>
  </div>
}
