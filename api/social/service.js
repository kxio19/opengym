import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SOCIAL_VERSION = 1;
export const SOCIAL_FIELDS = ['exerciseNames', 'exactSets', 'effort', 'volume', 'bodyweight', 'rating', 'note'];
export const DEFAULT_FIELDS = Object.freeze({
  exerciseNames: true, exactSets: true, effort: true, volume: true,
  bodyweight: true, rating: true, note: true
});
export const CHALLENGE_METRICS = ['sessions', 'minutes', 'sets', 'volume', 'prs'];
const PHOTO_ID = /^[a-f0-9-]{20,40}\.(jpg|png)$/;

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
    enabled: true, rankingsEnabled: true, enabledAt: isoNow(),
    rankingsEnabledAt: null,
    defaultPublish: true, askFields: false, fields: { ...DEFAULT_FIELDS },
    notifications: { kudos: true, comments: true, challenges: true },
    socialDefaultsEnabledMigrated: true
  };
}

export function emptySocialData() {
  return { version: SOCIAL_VERSION, profiles: {}, posts: {}, kudos: {}, comments: [], challenges: [], moderation: [], photoOwners: {} };
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
    const doneSets = (entry.sets || []).filter(s => s.done);
    // A per-exercise SET COUNT rides along whenever the exercise name itself is shared, whether
    // or not the exact weights/reps are (fields.exactSets is a separate, stricter opt-in). A
    // count reveals nothing about load — "3 sets of squats" without numbers — so it costs
    // nothing in privacy and it's what a feed card needs to draw the muscle map under the
    // *default* privacy tier, not only the most permissive one.
    const item = { id: cleanText(entry.id, 100), name: cleanText(entry.n || entry.name || entry.id, 100), setCount: doneSets.length };
    if (fields.exactSets) item.sets = doneSets.map(s => ({
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
  // Title, description and photo describe the post itself rather than a detail someone can
  // choose to redact from an otherwise-shared workout, so — unlike the fields above — they
  // aren't gated by a privacy toggle of their own: the publish switch is already the gate.
  if (workout.social?.title) snapshot.title = cleanText(workout.social.title, 80);
  if (workout.social?.desc) snapshot.desc = cleanText(workout.social.desc, 500);
  if (PHOTO_ID.test(String(workout.social?.photoId || ''))) snapshot.photoId = workout.social.photoId;
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

  // Post photos: a small per-post upload, kept inside dataDir so it rides along with everything
  // else the daily backup already covers. Filenames are <uuid>.(jpg|png) — never anything the
  // client sent, so there is nothing here that needs path sanitising beyond the id regex used
  // to read one back.
  const photosDir = path.join(dataDir, 'social-photos');
  fs.mkdirSync(photosDir, { recursive: true });
  function deletePostPhoto(post) {
    if (!post?.photoId || !PHOTO_ID.test(post.photoId)) return;
    try { fs.unlinkSync(path.join(photosDir, post.photoId)); } catch { /* already gone, or never existed */ }
    delete data.photoOwners[post.photoId];
  }

  // Membership is mandatory now (Kaio's call, with every current member told and on board): a
  // profile is created enabled, not opted into later. enabledAt is always "now" — never the
  // account's creation date — because eligible() below uses it as the cutoff for what can ever
  // be published; backdating it would publish someone's entire history the moment they were
  // enrolled, imported workouts included.
  function enroll(user) {
    const profile = { ...defaultSocialProfile(user), enabled: true, enabledAt: now().toISOString() };
    data.profiles[user.id] = profile;
    return profile;
  }
  // One-time migration for accounts created before membership became mandatory or before the
  // enabled-by-default settings. Consent timestamps are deliberately left untouched.
  if (enabled) {
    let migrated = false;
    for (const u of users()) {
      if (!data.profiles[u.id]) { enroll(u); migrated = true; continue; }
      const profile = data.profiles[u.id];
      if (profile.socialDefaultsEnabledMigrated) continue;
      profile.rankingsEnabled = true;
      profile.defaultPublish = true;
      profile.askFields = false;
      profile.fields = { ...DEFAULT_FIELDS };
      profile.notifications = { ...profile.notifications, kudos: true, comments: true, challenges: true };
      profile.socialDefaultsEnabledMigrated = true;
      migrated = true;
    }
    if (migrated) persist();
  }

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
        const next = workoutSnapshot(user, workout, profile);
        // A post that stays published can still swap or drop its photo (post/settings patches
        // workout.social directly) — the old file only stops being referenced here, not when
        // the whole post goes away, so it has to be cleaned up in this branch too.
        const prevPhoto = data.posts[id]?.photoId;
        if (prevPhoto && prevPhoto !== next.photoId) deletePostPhoto({ photoId: prevPhoto });
        keep.add(id); data.posts[id] = next;
      }
    }
    for (const [id, post] of Object.entries(data.posts)) if (post.userId === user.id && !keep.has(id)) {
      deletePostPhoto(post);
      delete data.posts[id]; delete data.kudos[id]; data.comments = data.comments.filter(c => c.postId !== id);
    }
    await persist();
  }

  const stateMap = () => Object.fromEntries(users().map(u => [u.id, readState(u.id) || {}]));
  // Everyone with a session should already have a profile from registration or the boot
  // migration above; this is the belt-and-suspenders path for the one it somehow missed —
  // enrolled and persisted right here rather than handed a throwaway object nothing ever saves.
  const profileFor = user => { if (data.profiles[user.id]) return data.profiles[user.id]; const p = enroll(user); persist(); return p; };
  const requireMember = (user, res, json) => {
    if (!enabled) { json(res, 404, { error: 'social is disabled' }); return null; }
    const p = profileFor(user);
    if (!p?.enabled) { json(res, 403, { error: 'social consent required' }); return null; }
    return p;
  };

  const decoratePost = (post, user) => ({
    ...post,
    kudos: (data.kudos[post.id] || []).length,
    kudosByMe: (data.kudos[post.id] || []).includes(user.id),
    commentCount: data.comments.filter(c => c.postId === post.id).length,
    comments: data.comments.filter(c => c.postId === post.id).map(c => ({ ...c, mine: c.userId === user.id }))
  });

  const routes = ({ json, readBody, readRawBody, readSession, requireAdmin }) => ({
    'GET /api/social/me': async (req, res) => {
      const user = readSession(req); if (!user) return json(res, 401, { error: 'not signed in' });
      json(res, 200, { enabled, profile: profileFor(user) });
    },
    // Membership itself is no longer something this route can turn off (see enroll() above) —
    // `purge` now means "delete everything I've posted", not "leave the group". It only touches
    // this user's own posts: kudos and comments hanging off THOSE posts go with them, but a
    // comment they left on someone else's still-standing post, or their spot in a challenge,
    // is not "a publication" of theirs and is left alone.
    'PUT /api/social/me': async (req, res) => {
      const user = readSession(req); if (!user) return json(res, 401, { error: 'not signed in' });
      if (!enabled) return json(res, 404, { error: 'social is disabled' });
      const body = await readBody(req);
      if (body.purge === true) {
        for (const [id, p] of Object.entries(data.posts)) if (p.userId === user.id) {
          deletePostPhoto(p);
          delete data.posts[id]; delete data.kudos[id]; data.comments = data.comments.filter(c => c.postId !== id);
        }
        await persist(); return json(res, 200, { ok: true, profile: profileFor(user) });
      }
      const prev = profileFor(user);
      const enablingRankings = !prev.rankingsEnabled && body.rankingsEnabled === true;
      const profile = {
        ...prev, displayName: cleanText(body.displayName ?? prev.displayName, 40) || user.name,
        bio: cleanText(body.bio ?? prev.bio, 120), accent: cleanText(body.accent ?? prev.accent, 20) || 'lime',
        rankingsEnabled: body.rankingsEnabled === undefined ? prev.rankingsEnabled : !!body.rankingsEnabled,
        rankingsEnabledAt: enablingRankings ? now().toISOString() : prev.rankingsEnabledAt,
        defaultPublish: body.defaultPublish === undefined ? prev.defaultPublish : !!body.defaultPublish,
        askFields: body.askFields === undefined ? prev.askFields !== false : !!body.askFields,
        fields: normalizeFields(body.fields, prev.fields),
        notifications: { ...prev.notifications, ...(body.notifications || {}) }
      };
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
      posts = posts.slice(0, limit).map(p => decoratePost(p, user));
      json(res, 200, { posts, next: posts.at(-1)?.completedAt || null });
    },
    'GET /api/social/post': async (req, res) => {
      const user = readSession(req); if (!user) return json(res, 401, { error: 'not signed in' });
      if (!requireMember(user, res, json)) return;
      const id = safeId(new URL(req.url, 'http://x').searchParams.get('id'));
      const post = data.posts[id];
      if (!post) return json(res, 404, { error: 'post not found' });
      json(res, 200, decoratePost(post, user));
    },
    'POST /api/social/photo': async (req, res) => {
      const user = readSession(req); if (!user) return json(res, 401, { error: 'not signed in' });
      if (!requireMember(user, res, json)) return;
      const image = await readRawBody(req, 1024 * 1024);
      const jpeg = image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
      const png = image.length >= 8 && image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      if (!jpeg && !png) return json(res, 415, { error: 'only JPEG and PNG images are accepted' });
      const id = `${crypto.randomUUID()}.${jpeg ? 'jpg' : 'png'}`;
      fs.writeFileSync(path.join(photosDir, id), image, { mode: 0o600, flag: 'wx' });
      data.photoOwners[id] = user.id;
      await persist();
      json(res, 200, { id });
    },
    'GET /api/social/photo/:id': async (req, res) => {
      const user = readSession(req); if (!user) return json(res, 401, { error: 'not signed in' });
      if (!requireMember(user, res, json)) return;
      let id;
      try { id = decodeURIComponent(new URL(req.url, 'http://x').pathname.slice('/api/social/photo/'.length)); }
      catch { return json(res, 404, { error: 'photo not found' }); }
      if (!PHOTO_ID.test(id)) return json(res, 404, { error: 'photo not found' });
      let image;
      try { image = fs.readFileSync(path.join(photosDir, id)); } catch { return json(res, 404, { error: 'photo not found' }); }
      res.writeHead(200, { 'Content-Type': id.endsWith('.png') ? 'image/png' : 'image/jpeg', 'Content-Length': image.length, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
      res.end(image);
    },
    'POST /api/social/post/settings': async (req, res) => {
      const user = readSession(req); if (!user) return json(res, 401, { error: 'not signed in' });
      const profile = requireMember(user, res, json); if (!profile) return;
      const body = await readBody(req), state = readState(user.id) || {}, workout = (state.workouts || []).find(w => w.id === body.workoutId);
      if (!workout || !eligible(workout, profile)) return json(res, 404, { error: 'eligible workout not found' });
      const photoId = body.photoId === null || body.photoId === '' ? null : String(body.photoId || workout.social?.photoId || '');
      if (photoId && (!PHOTO_ID.test(photoId) || data.photoOwners[photoId] !== user.id)) return json(res, 400, { error: 'invalid post photo' });
      workout.social = {
        ...workout.social,
        publish: !!body.publish,
        fields: normalizeFields(body.fields, profile.fields),
        title: cleanText(body.title ?? workout.social?.title, 80),
        desc: cleanText(body.desc ?? workout.social?.desc, 500),
        ...(photoId ? { photoId } : { photoId: null })
      };
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
      const owner = data.profiles[post.userId]; if (set.has(user.id) && owner?.notifications?.kudos) sendPush(post.userId, { title: 'New kudos', body: `${profileFor(user).displayName} supported your workout`, tag: `social-kudos-${post.id}`, url: `#/post/${encodeURIComponent(post.id)}` });
      json(res, 200, { ok: true, active: set.has(user.id), count: set.size });
    },
    'POST /api/social/comments/new': async (req, res) => {
      const user = readSession(req); if (!user) return json(res, 401, { error: 'not signed in' });
      const profile = requireMember(user, res, json); if (!profile) return;
      const body = await readBody(req), post = data.posts[safeId(body.postId)], text = cleanText(body.text, 300);
      if (!post) return json(res, 404, { error: 'post not found' }); if (!text) return json(res, 400, { error: 'comment required' });
      const comment = { id: crypto.randomUUID(), postId: post.id, userId: user.id, author: profile.displayName, text, createdAt: now().toISOString() };
      data.comments.push(comment); await persist();
      const owner = data.profiles[post.userId]; if (post.userId !== user.id && owner?.notifications?.comments) sendPush(post.userId, { title: 'New comment', body: `${profile.displayName}: ${text}`, tag: `social-comment-${post.id}`, url: `#/post/${encodeURIComponent(post.id)}` });
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
      for (const profile of Object.values(data.profiles)) if (profile.userId !== user.id && profile.enabled && profile.notifications?.challenges) sendPush(profile.userId, { title: 'New training challenge', body: `${profileFor(user).displayName}: ${challenge.title}`, tag: `social-challenge-${challenge.id}`, url: '#/stats' });
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
      deletePostPhoto(post); delete data.posts[post.id]; delete data.kudos[post.id]; data.comments = data.comments.filter(c => c.postId !== post.id);
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
        for (const [id, post] of Object.entries(data.posts)) if (post.userId === profile.userId) { deletePostPhoto(post); delete data.posts[id]; delete data.kudos[id]; }
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
