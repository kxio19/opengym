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
