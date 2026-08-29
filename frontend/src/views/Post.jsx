import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, dateLocale } from '../lib/i18n.js'
import { fmtVol, setCount, ACCENTS } from '../lib/format.js'
import { socialPost, toggleKudos, addComment, deleteComment } from '../lib/social-api.js'
import { photoUrl, postLoad } from '../components/PostCard.jsx'
import Icon from '../components/Icon.jsx'
import BodyMap from '../components/BodyMap.jsx'
import { Button, TextField } from '../components/ui.jsx'

export default function Post() {
  const { id } = useParams()
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const [post, setPost] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [comment, setComment] = useState('')

  // id was encodeURIComponent'd to build the link; react-router may or may not have already
  // decoded it depending on version, and decoding an already-decoded plain string (no stray
  // '%') is always a safe no-op, so this works either way.
  const postId = decodeURIComponent(id || '')

  const load = () => socialPost(postId).then(setPost).catch(e => { if (e.status === 404) setNotFound(true); else toast(e.message) })
  useEffect(() => { load() }, [postId])

  const react = async () => { try { await toggleKudos(post.id, !post.kudosByMe); load() } catch (e) { toast(e.message) } }
  const submit = async () => {
    const text = comment.trim(); if (!text) return
    try { await addComment(post.id, text); setComment(''); load() } catch (e) { toast(e.message) }
  }
  const removeComment = async cid => { try { await deleteComment(cid); load() } catch (e) { toast(e.message) } }

  if (notFound) return <div className="narrow">
    <div className="hdr"><button className="iconbtn" onClick={() => nav('/home')} aria-label={t('Back')}><Icon name="chevronLeft" /></button></div>
    <div className="empty"><div className="ico"><Icon name="personCircle" /></div>{t('This post is no longer available.')}</div>
  </div>
  if (!post) return <div className="narrow"><div className="empty">{t('Loading…')}</div></div>

  const hasEntries = !!post.entries?.length

  return <div className="narrow post-detail">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div className="row" style={{ flex: 1, marginLeft: 8, gap: 9 }}>
        <span className="social-avatar" style={{ background: ACCENTS[post.accent] || 'var(--acc)' }}>{post.author.slice(0, 2).toUpperCase()}</span>
        <div><b>{post.author}</b><div className="small muted">{new Date(post.completedAt).toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' })}</div></div>
      </div>
    </div>

    {post.photoId && <div className="post-detail-photo"><img src={photoUrl(post.photoId)} alt="" /></div>}

    {post.title && <h2 style={{ margin: '14px 0 2px' }}>{post.title}</h2>}
    {post.desc && <p className="muted" style={{ margin: '0 0 14px', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{post.desc}</p>}
    {!post.title && <h2 style={{ margin: '14px 0 2px' }}>{post.routine}</h2>}

    <div className="tiles" style={{ marginTop: post.title ? 14 : 8, marginBottom: 14 }}>
      <div className="tile"><div className="l">{t('Duration')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{post.durationMinutes} {t('min')}</div></div>
      {post.volume !== undefined && <div className="tile"><div className="l">{t('Volume')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fmtVol(Math.round(post.volume), post.unit)}</div></div>}
      <div className="tile"><div className="l">{t('Sets')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{post.setCount}</div></div>
      <div className="tile"><div className="l">{t('PRs')}</div><div className="v" style={{ fontSize: 20 }}>{post.prCount || '—'}</div></div>
    </div>

    {hasEntries && <>
      <h4 className="sec" style={{ textAlign: 'left' }}>{t('What they trained')}</h4>
      <BodyMap load={postLoad(post)} body="male" />
      <div className="list" style={{ marginTop: 6 }}>{post.entries.map(e => <div className="social-entry" key={e.id}>
        <b>{e.name}</b>
        {e.sets?.length ? <span>{e.sets.map(s => `${s.weight}×${s.reps}`).join(' · ')}</span> : e.setCount ? <span>{setCount(e.setCount)}</span> : null}
      </div>)}</div>
    </>}

    {post.bodyweight !== undefined && <p className="small">{t('Body weight')}: {post.bodyweight} {post.bodyweightUnit}</p>}
    {post.rating && <p className="small">{t('Session rating')}: {post.rating}</p>}
    {post.note && <p className="social-note">{post.note}</p>}

    <div className="social-actions" style={{ marginTop: 16 }}>
      <Button icon="heart" disabled={post.userId === user.id} style={post.kudosByMe ? { color: 'var(--pink)' } : null} onClick={react}>{post.kudos || ''} {t('Kudos')}</Button>
    </div>

    <h4 className="sec">{t('Comments')}</h4>
    <div className="social-comments">
      {post.comments?.map(c => <div key={c.id}><span><b>{c.author}</b> {c.text}</span>{(c.mine || user.admin) && <button aria-label={t('Delete')} onClick={() => removeComment(c.id)}><Icon name="trash" /></button>}</div>)}
      {!post.comments?.length && <div className="dim small" style={{ padding: '6px 0' }}>{t('No comments yet.')}</div>}
    </div>
    <div className="social-comment-box"><TextField maxLength={300} value={comment} placeholder={t('Add a comment…')} onChange={e => setComment(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit() }} /><Button size="sm" onClick={submit}>{t('Send')}</Button></div>
  </div>
}
