import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t, dateLocale } from '../lib/i18n.js'
import { fmtVol, exCount, setCount, ACCENTS } from '../lib/format.js'
import { loadOf } from '../lib/muscles.js'
import Icon from './Icon.jsx'
import BodyMap from './BodyMap.jsx'
import { Button } from './ui.jsx'

// Same-origin, cookie-authenticated — the web container proxies /api to the API container,
// so a plain <img src> carries the session cookie without any extra plumbing.
export const photoUrl = id => id ? '/api/social/photo/' + encodeURIComponent(id) : null

// Muscle load only needs a per-exercise SET COUNT, never weights or reps (loadOf takes
// {id, sets: count}, same shape loadOfRoutine already builds from a plan). A post's entries
// carry setCount whenever exercise names are shared at all, independent of whether exact sets
// are — sharing "3 sets of squats" without the weights is privacy-neutral, so the map works
// under the default privacy tier and not just the most permissive one.
export const postLoad = post => loadOf((post.entries || []).map(e => ({ id: e.id, sets: e.setCount ?? (e.sets ? e.sets.length : 0) })))

function StatsRow({ post }) {
  return <div className="social-stats">
    <span>{post.durationMinutes} {t('min')}</span>
    {post.volume !== undefined && <span>{fmtVol(Math.round(post.volume), post.unit)}</span>}
    {!!post.prCount && <span className="accent"><Icon name="trophy" style={{ fontSize: 12 }} /> {post.prCount} PR</span>}
    <span>{exCount(post.exerciseCount)}</span>
  </div>
}

// Two swipeable pages when there is something to swipe to: a photo (or, lacking one, the
// muscle map) first, the exercise list second. A post with neither a photo nor shared exercise
// names has nothing to show here and skips the carousel entirely — StatsRow still runs below it.
function Media({ post }) {
  const [page, setPage] = useState(0)
  const hasPhoto = !!post.photoId
  const hasEntries = !!post.entries?.length
  if (!hasPhoto && !hasEntries) return null
  const pages = []
  pages.push(hasPhoto
    ? <div className="post-media-page" key="photo"><img src={photoUrl(post.photoId)} alt="" loading="lazy" /></div>
    : <div className="post-media-page" key="map"><BodyMap load={postLoad(post)} body={post.body || 'male'} /></div>)
  if (hasEntries) pages.push(<div className="post-media-page post-media-list" key="list">
    {post.entries.map(e => <div className="social-entry" key={e.id}>
      <b>{e.name}</b>
      {e.sets?.length ? <span>{e.sets.map(s => `${s.weight}×${s.reps}`).join(' · ')}</span> : e.setCount ? <span>{setCount(e.setCount)}</span> : null}
    </div>)}
  </div>)
  const onScroll = e => setPage(Math.round(e.target.scrollLeft / e.target.clientWidth))
  return <div className="post-media-wrap">
    <div className="post-media" onScroll={onScroll}>{pages}</div>
    {pages.length > 1 && <div className="post-dots">{pages.map((_, i) => <span key={i} className={'post-dot' + (i === page ? ' on' : '')} />)}</div>}
  </div>
}

export default function PostCard({ post, onOpen, onKudos }) {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const open = () => (onOpen || nav)('/post/' + encodeURIComponent(post.id))
  return <article className="card social-post">
    <div className="row between">
      <div className="row" style={{ gap: 9, cursor: 'pointer' }} onClick={open}>
        {/* Each author's own chosen color, not the viewer's — set inline like the profile-color
            swatches (ProfileSetup) do, because .social-avatar's background is var(--acc), the
            viewer's own theme accent, and a data-accent attribute has no matching CSS rule. */}
        <span className="social-avatar" style={{ background: ACCENTS[post.accent] || 'var(--acc)' }}>{post.author.slice(0, 2).toUpperCase()}</span>
        <div><b>{post.author}</b><div className="small muted">{new Date(post.completedAt).toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' })}</div></div>
      </div>
    </div>
    <div style={{ cursor: 'pointer' }} onClick={open}>
      {post.title && <h3 className="post-title">{post.title}</h3>}
      {post.desc && <p className="post-desc">{post.desc}</p>}
      {!post.title && <h3>{post.routine}</h3>}
      <Media post={post} />
      <StatsRow post={post} />
    </div>
    <div className="social-actions">
      <Button size="sm" icon="heart" disabled={post.userId === user.id} style={post.kudosByMe ? { color: 'var(--pink)' } : null} onClick={() => onKudos(post)}>{post.kudos || ''} {t('Kudos')}</Button>
      <button className="iconbtn post-comment-btn" onClick={open} aria-label={t('Comments')}>
        <Icon name="message" /> {post.commentCount || post.comments?.length || 0}
      </button>
    </div>
  </article>
}
