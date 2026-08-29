import { api } from './api.js'

export const SOCIAL_FIELD_DEFAULTS = {
  exerciseNames: true, exactSets: false, effort: false, volume: false,
  bodyweight: false, rating: false, note: false
}

export const socialMe = () => api('/api/social/me')
export const saveSocialMe = profile => api('/api/social/me', { method: 'PUT', body: JSON.stringify(profile) })
export const purgeSocial = () => api('/api/social/me', { method: 'PUT', body: JSON.stringify({ purge: true }) })
export const socialFeed = (limit = 20, before = '') => api(`/api/social/feed?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`)
export const socialPost = id => api(`/api/social/post?id=${encodeURIComponent(id)}`)
export async function uploadSocialPhoto(blob) {
  const response = await fetch('/api/social/photo', { method: 'POST', headers: { 'Content-Type': blob.type || 'image/jpeg' }, body: blob })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) { const error = new Error(data.error || `HTTP ${response.status}`); error.status = response.status; throw error }
  return data.id
}
// Photos for your own exercises. Same upload shape as the social one, different store on the
// server: an exercise photo is personal, so it must survive with Social off and must not be
// swept away when a post that happened to use it is deleted.
export async function uploadExercisePhoto(blob) {
  const response = await fetch('/api/exercise-photo', { method: 'POST', headers: { 'Content-Type': blob.type || 'image/jpeg' }, body: blob })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) { const error = new Error(data.error || `HTTP ${response.status}`); error.status = response.status; throw error }
  return data.id
}
// Best-effort: the exercise is already gone from the user's state, so a failure here only
// leaves an orphan file behind — never a broken exercise.
export const deleteExercisePhoto = id =>
  fetch(`/api/exercise-photo/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {})
export const exercisePhotoSrc = id => `/api/exercise-photo/${encodeURIComponent(id)}`

export const socialRankings = week => api(`/api/social/rankings${week ? `?week=${encodeURIComponent(week)}` : ''}`)
export const socialChallenges = () => api('/api/social/challenges')
export const savePostSettings = data => api('/api/social/post/settings', { method: 'POST', body: JSON.stringify(data) })
export const toggleKudos = (postId, active) => api('/api/social/kudos', { method: 'POST', body: JSON.stringify({ postId, active }) })
export const addComment = (postId, text) => api('/api/social/comments/new', { method: 'POST', body: JSON.stringify({ postId, text }) })
export const deleteComment = commentId => api('/api/social/comments/delete', { method: 'POST', body: JSON.stringify({ commentId }) })
export const createChallenge = challenge => api('/api/social/challenges/new', { method: 'POST', body: JSON.stringify(challenge) })
export const joinChallenge = challengeId => api('/api/social/challenges/join', { method: 'POST', body: JSON.stringify({ challengeId }) })
export const cancelChallenge = challengeId => api('/api/social/challenges/cancel', { method: 'POST', body: JSON.stringify({ challengeId }) })

export function socialWorkoutDefaults(profile) {
  return {
    eligible: true,
    publish: !!profile?.defaultPublish,
    fields: { ...SOCIAL_FIELD_DEFAULTS, ...(profile?.fields || {}) }
  }
}
