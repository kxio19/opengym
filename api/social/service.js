import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SOCIAL_VERSION = 1;
export const SOCIAL_FIELDS = ['exerciseNames', 'exactSets', 'effort', 'volume', 'bodyweight', 'rating', 'note'];
export const DEFAULT_FIELDS = Object.freeze({
  exerciseNames: true, exactSets: false, effort: false, volume: false,
  bodyweight: false, rating: false, note: false
});
export const CHALLENGE_METRICS = ['sessions', 'minutes', 'sets', 'volume', 'prs'];

const isoNow = () => new Date().toISOString();
const cleanText = (value, max) => String(value || '').trim().replace(/[<>]/g, '').slice(0, max);
const finite = value => Number.isFinite(+value) ? +value : 0;
const workoutKey = (uid, workoutId) => `${uid}:${workoutId}`;
const safeId = value => String(value || '').replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, 220);
const validISODate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export function defaultSocialProfile(user) {
  return {
    userId: user.id, displayName: cleanText(user.name, 40), bio: '', accent: 'lime',
    enabled: false, rankingsEnabled: false, enabledAt: null,
    rankingsEnabledAt: null,
    defaultPublish: false, fields: { ...DEFAULT_FIELDS },
    notifications: { kudos: false, comments: false, challenges: false }
  };
}

export function emptySocialData() {
  return { version: SOCIAL_VERSION, profiles: {}, posts: {}, kudos: {}, comments: [], challenges: [], moderation: [] };
}

function normalizeFields(fields, fallback = DEFAULT_FIELDS) {
  const out = {};
  for (const key of SOCIAL_FIELDS) out[key] = fields?.[key] === undefined ? !!fallback[key] : !!fields[key];
  if (!out.exerciseNames) { out.exactSets = false; out.effort = false; }
  return out;
}

function completedSets(workout) {
  return (workout.entries || []).flatMap(entry => (entry.sets || []).filter(set => set.done));
}

function workoutSnapshot(user, workout, profile) {
  const fields = normalizeFields(workout.social?.fields, profile.fields);
  const entries = fields.exerciseNames ? (workout.entries || []).map(entry => {
    const item = { id: cleanText(entry.id, 100), name: cleanText(entry.n || entry.name || entry.id, 100) };
    if (fields.exactSets) item.sets = (entry.sets || []).filter(s => s.done).map(s => ({
      weight: Math.max(0, finite(s.w)), reps: Math.max(0, Math.round(finite(s.r))),
      ...(fields.effort && Number.isFinite(+s.rir) ? { rir: +s.rir } : {}), ...(fields.effort && Number.isFinite(+s.rpe) ? { rpe: +s.rpe } : {})
    }));
    return item;
  }) : [];
  const snapshot = {
    id: workoutKey(user.id, workout.id), workoutId: workout.id, userId: user.id,
    author: profile.displayName || user.name, accent: profile.accent,
    completedAt: new Date(finite(workout.end) || Date.parse(`${workout.d}T12:00:00Z`)).toISOString(),
    date: workout.d, routine: cleanText(workout.name || 'Workout', 80),
    durationMinutes: Math.max(0, Math.min(360, Math.round((finite(workout.end) - finite(workout.start)) / 60000))),
    exerciseCount: (workout.entries || []).length, setCount: completedSets(workout).length,
    prCount: Array.isArray(workout.prs) ? workout.prs.length : 0, fields, entries
  };
  if (fields.volume) snapshot.volume = Math.max(0, finite(workout.vol));
  if (fields.volume) snapshot.unit = workout.unit || 'kg';
  if (fields.bodyweight && finite(workout.bw) > 0) snapshot.bodyweight = finite(workout.bw);
  if (fields.bodyweight) snapshot.bodyweightUnit = workout.unit || 'kg';
  if (fields.rating && workout.rating) snapshot.rating = cleanText(workout.rating, 20);
  if (fields.note && workout.note) snapshot.note = cleanText(workout.note, 300);
  return snapshot;
}

function zonedDate(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = type => parts.find(p => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDays(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}

export function mondayOf(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  return addDays(iso, -offset);
}

function workoutDate(workout, timeZone) {
  return finite(workout?.end) > 0 ? zonedDate(timeZone, new Date(finite(workout.end))) : workout?.d;
}

function streakWeeks(workouts, currentMonday, timeZone) {
  const weeks = new Set(workouts.map(w => mondayOf(workoutDate(w, timeZone))));
  let count = 0;
  for (let cursor = currentMonday; weeks.has(cursor) && count < 12; cursor = addDays(cursor, -7)) count++;
  return count;
}

export function buildRankings({ profiles, users, states, week, timeZone = 'Europe/Madrid', now = new Date() }) {
  const monday = mondayOf(week || zonedDate(timeZone, now));
  const sunday = addDays(monday, 6);
  const rows = [];
  for (const user of users) {
    const profile = profiles[user.id];
    if (!profile?.enabled || !profile.rankingsEnabled) continue;
    const consentAt = profile.rankingsEnabledAt || profile.enabledAt;
    const all = (states[user.id]?.workouts || []).filter(w => w.social?.eligible && w.origin === 'tracked' && finite(w.end) >= Date.parse(consentAt || 0));
    const workouts = all.filter(w => { const d = workoutDate(w, timeZone); return d >= monday && d <= sunday; });
    if (!workouts.length) continue;
    const metric = {
      volume: workouts.reduce((sum, w) => sum + Math.max(0, finite(w.vol)) * (w.unit === 'lb' ? 0.45359237 : 1), 0),
      consistency: new Set(workouts.map(w => workoutDate(w, timeZone))).size,
      minutes: workouts.reduce((sum, w) => sum + Math.max(0, Math.min(360, (finite(w.end) - finite(w.start)) / 60000)), 0),
      prs: workouts.reduce((sum, w) => sum + (Array.isArray(w.prs) ? w.prs.length : 0), 0),
      streak: streakWeeks(all, monday, timeZone)
    };
    rows.push({ userId: user.id, name: profile.displayName || user.name, accent: profile.accent, metric, firstAt: Math.min(...workouts.map(w => finite(w.end) || Infinity)) });
  }
  const categories = ['volume', 'consistency', 'minutes', 'prs', 'streak'];
  const active = categories.filter(key => Math.max(0, ...rows.map(r => r.metric[key])) > 0);
  for (const row of rows) {
    row.scores = {};
    for (const key of active) row.scores[key] = Math.round(row.metric[key] / Math.max(...rows.map(r => r.metric[key])) * 1000) / 10;
    row.score = active.length ? Math.round(active.reduce((sum, key) => sum + row.scores[key], 0) / active.length * 10) / 10 : 0;
  }
  const tie = (a, b) => b.metric.consistency - a.metric.consistency || b.metric.minutes - a.metric.minutes || a.firstAt - b.firstAt || a.name.localeCompare(b.name);
  rows.sort((a, b) => b.score - a.score || tie(a, b));
  const podiums = Object.fromEntries(active.map(key => [key, rows.slice().sort((a, b) => b.metric[key] - a.metric[key] || tie(a, b)).slice(0, 3)]));
  return { week: monday, through: sunday, timeZone, activeCategories: active, rows, podium: rows.slice(0, 3), podiums };
}

export function createSocialService({ dataDir, users, readState, writeState, isAdmin, sendPush, enabled = true, timeZone = 'Europe/Madrid', now = () => new Date() }) {
  const file = path.join(dataDir, 'social.json');
  let data = emptySocialData();
  try { data = { ...emptySocialData(), ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}
  let writeChain = Promise.resolve();
  const persist = () => {
    const content = JSON.stringify(data, null, 2);
    writeChain = writeChain.then(() => {
      const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, content, { mode: 0o600 }); fs.renameSync(tmp, file);
    });
    return writeChain;
  };
  const userById = id => users().find(u => u.id === id);
  const publicProfile = p => p ? ({ userId: p.userId, displayName: p.displayName, bio: p.bio, accent: p.accent }) : null;

  function eligible(workout, profile) {
    return profile?.enabled && workout?.social?.eligible && workout.origin === 'tracked' && finite(workout.end) >= Date.parse(profile.enabledAt || 0);
  }

  async function syncUserState(user, state) {
    const profile = data.profiles[user.id];
    const keep = new Set();
    const moderated = new Set(data.moderation.filter(m => m.action === 'remove-post').map(m => m.targetId));
    for (const workout of state?.workouts || []) {
      const id = workoutKey(user.id, workout.id);
      if (eligible(workout, profile) && workout.social?.publish && !moderated.has(id)) {
        keep.add(id); data.posts[id] = workoutSnapshot(user, workout, profile);
      }
    }
    for (const [id, post] of Object.entries(data.posts)) if (post.userId === user.id && !keep.has(id)) {
      delete data.posts[id]; delete data.kudos[id]; data.comments = data.comments.filter(c => c.postId !== id);
    }
    await persist();
  }

  const stateMap = () => Object.fromEntries(users().map(u => [u.id, readState(u.id) || {}]));
  const profileFor = user => data.profiles[user.id] || defaultSocialProfile(user);
  const requireMember = (user, res, json) => {
    if (!enabled) { json(res, 404, { error: 'social is disabled' }); return null; }
    const p = data.profiles[user.id];
    if (!p?.enabled) { json(res, 403, { error: 'social consent required' }); return null; }
    return p;
  };

  const routes = ({ json, readBody, readSession, requireAdmin }) => ({
    'GET /api/social/me': async (req, res) => {
      const user = readSession(req); if (!user) return json(res, 401, { error: 'not signed in' });
      json(res, 200, { enabled, profile: profileFor(user) });
    },
    'PUT /api/social/me': async (req, res) => {
      const user = readSession(req); if (!user) return json(res, 401, { error: 'not signed in' });
      if (!enabled) return json(res, 404, { error: 'social is disabled' });
      const body = await readBody(req);
      if (body.purge === true) {
        delete data.profiles[user.id];
        for (const [id, p] of Object.entries(data.posts)) if (p.userId === user.id) { delete data.posts[id]; delete data.kudos[id]; }
        data.comments = data.comments.filter(c => c.userId !== user.id && data.posts[c.postId]);
        data.challenges = data.challenges.map(c => ({ ...c, participants: c.participants.filter(p => p.userId !== user.id) }));
        await persist(); return json(res, 200, { ok: true, profile: defaultSocialProfile(user) });
      }
      const prev = profileFor(user), activating = !prev.enabled && body.enabled === true;
      const enablingRankings = !prev.rankingsEnabled && body.rankingsEnabled === true;
      const profile = {
        ...prev, displayName: cleanText(body.displayName ?? prev.displayName, 40) || user.name,
        bio: cleanText(body.bio ?? prev.bio, 120), accent: cleanText(body.accent ?? prev.accent, 20) || 'lime',
        enabled: body.enabled === undefined ? prev.enabled : !!body.enabled,
        rankingsEnabled: body.rankingsEnabled === undefined ? prev.rankingsEnabled : !!body.rankingsEnabled,
        rankingsEnabledAt: enablingRankings ? now().toISOString() : prev.rankingsEnabledAt,
        enabledAt: activating ? now().toISOString() : prev.enabledAt,
        defaultPublish: body.defaultPublish === undefined ? prev.defaultPublish : !!body.defaultPublish,
        fields: normalizeFields(body.fields, prev.fields),
        notifications: { ...prev.notifications, ...(body.notifications || {}) }
      };
      if (!profile.enabled) profile.rankingsEnabled = false;
      data.profiles[user.id] = profile; await syncUserState(user, readState(user.id) || {});
      json(res, 200, { ok: true, profile });
    },
    'GET /api/social/feed': async (req, res) => {
      const user = readSession(req); if (!user) return json(res, 401, { error: 'not signed in' });
      if (!requireMember(user, res, json)) return;
      const url = new URL(req.url, 'http://x'), before = url.searchParams.get('before');
      const limit = Math.max(1, Math.min(50, +(url.searchParams.get('limit') || 20)));
      let posts = Object.values(data.posts).sort((a, b) => b.completedAt.localeCompare(a.completedAt));
      if (before) posts = posts.filter(p => p.completedAt < before);
      posts = posts.slice(0, limit).map(p => ({ ...p, kudos: (data.kudos[p.id] || []).length, kudosByMe: (data.kudos[p.id] || []).includes(user.id), comments: data.comments.filter(c => c.postId === p.id).map(c => ({ ...c, mine: c.userId === user.id })) }));
      json(res, 200, { posts, next: posts.at(-1)?.completedAt || null });
    },
    'POST /api/social/post/settings': async (req, res) => {
      const user = readSession(req); if (!user) return json(res, 401, { error: 'not signed in' });
      const profile = requireMember(user, res, json); if (!profile) return;
      const body = await readBody(req), state = readState(user.id) || {}, workout = (state.workouts || []).find(w => w.id === body.workoutId);
      if (!workout || !eligible(workout, profile)) return json(res, 404, { error: 'eligible workout not found' });
      workout.social = { ...workout.social, publish: !!body.publish, fields: normalizeFields(body.fields, profile.fields) };
      writeState(user.id, state); await syncUserState(user, state);
      json(res, 200, { ok: true, social: workout.social });
    },
    'POST /api/social/kudos': async (req, res) => {
      const user = readSession(req); if (!user) return json(res, 401, { error: 'not signed in' });
      if (!requireMember(user, res, json)) return;
      const body = await readBody(req), post = data.posts[safeId(body.postId)];
      if (!post) return json(res, 404, { error: 'post not found' });
      if (post.userId === user.id) return json(res, 400, { error: 'cannot kudos your own post' });
      const set = new Set(data.kudos[post.id] || []);
      const active = typeof body.active === 'boolean' ? body.active : !set.has(user.id);
      active ? set.add(user.id) : set.delete(user.id); data.kudos[post.id] = [...set]; await persist();
      const owner = data.profiles[post.userId]; if (set.has(user.id) && owner?.notifications?.kudos) sendPush(post.userId, { title: 'New kudos', body: `${profileFor(user).displayName} supported your workout`, tag: `social-kudos-${post.id}`, url: '#/social' });
      json(res, 200, { ok: true, active: set.has(user.id), count: set.size });
    },
    'POST /api/social/comments/new': async (req, res) => {
      const user = readSession(req); if (!user) return json(res, 401, { error: 'not signed in' });
      const profile = requireMember(user, res, json); if (!profile) return;
      const body = await readBody(req), post = data.posts[safeId(body.postId)], text = cleanText(body.text, 300);
      if (!post) return json(res, 404, { error: 'post not found' }); if (!text) return json(res, 400, { error: 'comment required' });
      const comment = { id: crypto.randomUUID(), postId: post.id, userId: user.id, author: profile.displayName, text, createdAt: now().toISOString() };
      data.comments.push(comment); await persist();
      const owner = data.profiles[post.userId]; if (post.userId !== user.id && owner?.notifications?.comments) sendPush(post.userId, { title: 'New comment', body: `${profile.displayName}: ${text}`, tag: `social-comment-${post.id}`, url: '#/social' });
      json(res, 200, { comment: { ...comment, mine: true } });
    },
    'POST /api/social/comments/delete': async (req, res) => {
      const user = readSession(req); if (!user) return json(res, 401, { error: 'not signed in' });
      const body = await readBody(req), comment = data.comments.find(c => c.id === body.commentId);
      if (!comment) return json(res, 404, { error: 'comment not found' });
      if (comment.userId !== user.id && !isAdmin(user)) return json(res, 403, { error: 'forbidden' });
      data.comments = data.comments.filter(c => c.id !== comment.id); await persist(); json(res, 200, { ok: true });
    },
    'GET /api/social/rankings': async (req, res) => {
      const user = readSession(req); if (!user) return json(res, 401, { error: 'not signed in' });
      if (!requireMember(user, res, json)) return;
      const week = new URL(req.url, 'http://x').searchParams.get('week');
      if (week && !validISODate(week)) return json(res, 400, { error: 'invalid week' });
      json(res, 200, buildRankings({ profiles: data.profiles, users: users(), states: stateMap(), week, timeZone, now: now() }));
    },
    'GET /api/social/challenges': async (req, res) => {
      const user = readSession(req); if (!user) return json(res, 401, { error: 'not signed in' });
      if (!requireMember(user, res, json)) return;
      const states = stateMap();
      const challenges = data.challenges.map(c => ({ ...c, participants: c.participants.map(p => ({ ...p, name: data.profiles[p.userId]?.displayName || userById(p.userId)?.name, value: challengeValue(c, states[p.userId], p.joinedAt) })).sort((a, b) => b.value - a.value) }));
      json(res, 200, { challenges });
    },
    'POST /api/social/challenges/new': async (req, res) => {
      const user = readSession(req); if (!user) return json(res, 401, { error: 'not signed in' });
      if (!requireMember(user, res, json)) return;
      const body = await readBody(req), metric = CHALLENGE_METRICS.includes(body.metric) ? body.metric : null;
      const start = String(body.start || ''), end = String(body.end || ''), days = (Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000 + 1;
      if (!metric || !validISODate(start) || !validISODate(end) || days < 1 || days > 31) return json(res, 400, { error: 'invalid challenge' });
      if (data.challenges.filter(c => c.creatorId === user.id && !c.cancelledAt && c.end >= zonedDate(timeZone, now())).length >= 3) return json(res, 409, { error: 'three active challenges maximum' });
      const challenge = { id: crypto.randomUUID(), title: cleanText(body.title, 80), metric, start, end, creatorId: user.id, createdAt: now().toISOString(), participants: [{ userId: user.id, joinedAt: now().toISOString() }] };
      if (!challenge.title) return json(res, 400, { error: 'title required' });
      data.challenges.push(challenge); await persist();
      for (const profile of Object.values(data.profiles)) if (profile.userId !== user.id && profile.enabled && profile.notifications?.challenges) sendPush(profile.userId, { title: 'New training challenge', body: `${profileFor(user).displayName}: ${challenge.title}`, tag: `social-challenge-${challenge.id}`, url: '#/social' });
      json(res, 200, { challenge });
    },
    'POST /api/social/challenges/join': async (req, res) => {
      const user = readSession(req); if (!user) return json(res, 401, { error: 'not signed in' });
      if (!requireMember(user, res, json)) return;
      const body = await readBody(req), c = data.challenges.find(x => x.id === body.challengeId);
      if (!c || c.cancelledAt || c.end < zonedDate(timeZone, now())) return json(res, 404, { error: 'active challenge not found' });
      if (!c.participants.some(p => p.userId === user.id)) c.participants.push({ userId: user.id, joinedAt: now().toISOString() });
      await persist(); json(res, 200, { ok: true });
    },
    'POST /api/social/challenges/cancel': async (req, res) => {
      const user = readSession(req); if (!user) return json(res, 401, { error: 'not signed in' });
      const body = await readBody(req), c = data.challenges.find(x => x.id === body.challengeId);
      if (!c) return json(res, 404, { error: 'challenge not found' });
      if (c.creatorId !== user.id && !isAdmin(user)) return json(res, 403, { error: 'forbidden' });
      c.cancelledAt = now().toISOString(); await persist(); json(res, 200, { ok: true });
    },
    'POST /api/admin/social/remove-post': async (req, res) => {
      const admin = requireAdmin(req, res); if (!admin) return;
      const body = await readBody(req), post = data.posts[safeId(body.postId)]; if (!post) return json(res, 404, { error: 'post not found' });
      const state = readState(post.userId) || {}, workout = (state.workouts || []).find(w => w.id === post.workoutId);
      if (workout?.social) { workout.social.publish = false; writeState(post.userId, state); }
      delete data.posts[post.id]; delete data.kudos[post.id]; data.comments = data.comments.filter(c => c.postId !== post.id);
      data.moderation.push({ id: crypto.randomUUID(), adminId: admin.id, action: 'remove-post', targetId: post.id, reason: cleanText(body.reason, 160), createdAt: now().toISOString() });
      await persist(); json(res, 200, { ok: true });
    },
    'GET /api/admin/social': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      json(res, 200, {
        enabled,
        profiles: Object.values(data.profiles).map(p => ({ ...publicProfile(p), enabled: p.enabled, rankingsEnabled: p.rankingsEnabled })),
        posts: Object.values(data.posts).sort((a, b) => b.completedAt.localeCompare(a.completedAt)),
        comments: data.comments.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        challenges: data.challenges.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        moderation: data.moderation.slice(-100).reverse()
      });
    },
    'POST /api/admin/social/remove-comment': async (req, res) => {
      const admin = requireAdmin(req, res); if (!admin) return;
      const body = await readBody(req), comment = data.comments.find(c => c.id === body.commentId);
      if (!comment) return json(res, 404, { error: 'comment not found' });
      data.comments = data.comments.filter(c => c.id !== comment.id);
      data.moderation.push({ id: crypto.randomUUID(), adminId: admin.id, action: 'remove-comment', targetId: comment.id, reason: cleanText(body.reason, 160), createdAt: now().toISOString() });
      await persist(); json(res, 200, { ok: true });
    },
    'POST /api/admin/social/disable-user': async (req, res) => {
      const admin = requireAdmin(req, res); if (!admin) return;
      const body = await readBody(req), profile = data.profiles[safeId(body.userId)];
      if (!profile) return json(res, 404, { error: 'social profile not found' });
      profile.enabled = !body.disabled; if (body.disabled) profile.rankingsEnabled = false;
      if (body.disabled) {
        for (const [id, post] of Object.entries(data.posts)) if (post.userId === profile.userId) { delete data.posts[id]; delete data.kudos[id]; }
        data.comments = data.comments.filter(c => c.userId !== profile.userId && data.posts[c.postId]);
        data.challenges = data.challenges.map(c => ({ ...c, participants: c.participants.filter(p => p.userId !== profile.userId) }));
      }
      data.moderation.push({ id: crypto.randomUUID(), adminId: admin.id, action: body.disabled ? 'disable-social-user' : 'enable-social-user', targetId: profile.userId, reason: cleanText(body.reason, 160), createdAt: now().toISOString() });
      await persist(); json(res, 200, { ok: true });
    }
  });

  function challengeValue(challenge, state, joinedAt) {
    const joinedDate = String(joinedAt).slice(0, 10), from = joinedDate > challenge.start ? joinedDate : challenge.start, joinedMs = Date.parse(joinedAt);
    const ws = (state?.workouts || []).filter(w => { const d = workoutDate(w, timeZone); return w.origin === 'tracked' && w.social?.eligible && finite(w.end) >= joinedMs && d >= from && d <= challenge.end; });
    if (challenge.metric === 'sessions') return ws.length;
    if (challenge.metric === 'minutes') return Math.round(ws.reduce((n, w) => n + Math.max(0, Math.min(360, (finite(w.end) - finite(w.start)) / 60000)), 0));
    if (challenge.metric === 'sets') return ws.reduce((n, w) => n + completedSets(w).length, 0);
    if (challenge.metric === 'volume') return Math.round(ws.reduce((n, w) => n + finite(w.vol) * (w.unit === 'lb' ? 0.45359237 : 1), 0));
    if (challenge.metric === 'prs') return ws.reduce((n, w) => n + (w.prs || []).length, 0);
    return 0;
  }

  return { routes, syncUserState, getData: () => data, flush: () => writeChain };
}
