/* opengym-api — passkey (WebAuthn) auth + per-user state storage for openGym
   No framework, JSON-file storage, signed session cookies.               */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse
} from '@simplewebauthn/server';
import webpush from 'web-push';
import * as coachConfig from './coach/config.js';
import * as coachJobs from './coach/jobs.js';
import { coachRoutes } from './coach/routes.js';
import { startCadence } from './coach/cadence.js';
import { createSocialService, defaultSocialProfile } from './social/service.js';
import { createRecoveryCodes, findRecoveryCode, hashRecoveryCode } from './auth/recovery.js';
import { hashLoginSecret, normalizeUsername, validateLoginSecret, verifyLoginSecret } from './auth/password.js';

const PORT = +(process.env.PORT || 3000);
const DATA = process.env.DATA_DIR || '/data';
const RP_ID = process.env.RP_ID || 'localhost';
const ORIGIN = process.env.ORIGIN || 'http://localhost:8080';
const RP_NAME = process.env.RP_NAME || 'openGym';
// Admin dashboard (issue): admins are matched by uid; INVITE_ONLY gates new signups behind a
// code the admin generates. Both default off so a fresh self-hosted instance stays open.
const ADMIN_UIDS = (process.env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
const INVITE_ONLY = /^(1|true|yes|on)$/i.test(process.env.INVITE_ONLY || '');
const SOCIAL_ENABLED = /^(1|true|yes|on)$/i.test(process.env.SOCIAL_ENABLED || '');
const SOCIAL_TZ = process.env.SOCIAL_TZ || 'Europe/Madrid';
const APP_VERSION = process.env.APP_VERSION || 'dev';
const SOURCE_URL = process.env.SOURCE_URL || 'https://github.com/kxio19/opengym';
// 90 days keeps someone who trains a few times a week permanently signed in without a stolen
// cookie staying good for a year. Overridable because a family instance and one on the open
// internet don't want the same number. Only affects cookies minted from now on — the expiry is
// baked into each cookie when it's issued, so lowering this never cuts an existing session short.
const SESSION_DAYS = Math.max(1, +(process.env.SESSION_DAYS || 90) || 90);
const MAX_BODY = 5 * 1024 * 1024;
// Secure cookies require HTTPS; over plain http://localhost the flag would drop the cookie
const SECURE = /^https:/i.test(ORIGIN) ? ' Secure;' : '';

fs.mkdirSync(DATA, { recursive: true });
// 0700 is what stops the unprivileged user that Coach jobs run as from reading any of this —
// state files, db.json, the session secret, the provider credential. The Agent SDK process gets
// its job payload in a temp directory and nothing else. Best-effort: a bind-mounted host directory
// may refuse the chmod, and that is not a reason to refuse to boot.
try { fs.chmodSync(DATA, 0o700); } catch { /* host filesystem says no — carry on */ }

/* ---------- secret + db ---------- */
const secretFile = path.join(DATA, 'secret');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = fs.readFileSync(secretFile, 'utf8').trim();
const DUMMY_PASSWORD_HASH = await hashLoginSecret('invalid-login-secret', SECRET);

// A temporary password an admin reads out over the phone or pastes into a chat, so no glyph pair
// anyone confuses (0/O, 1/l/I) is in the alphabet. Twelve characters from 32 is 60 bits, which is
// plenty for a secret whose whole purpose is to be replaced at the next sign-in.
function generateTempSecret() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

const dbFile = path.join(DATA, 'db.json');
let db = { users: [], creds: [], subs: [], invites: [] };
try { db = JSON.parse(fs.readFileSync(dbFile, 'utf8')); } catch {}
db.subs = db.subs || [];
db.invites = db.invites || [];
db.adminActions = db.adminActions || [];
db.suggestions = db.suggestions || [];
db.exercisePhotoOwners = db.exercisePhotoOwners || {};
const isAdmin = user => !!user && (user.admin === true || ADMIN_UIDS.includes(user.id));

// Exercise photos are deliberately independent from Social: they remain available when Social is
// disabled and cannot be removed as a side effect of deleting a social post. The whole dataDir is
// already backed up, so keeping this directory alongside social-photos needs no backup exception.
const EXERCISE_PHOTO_ID = /^[a-f0-9-]{20,40}\.(jpg|png)$/;
const exercisePhotosDir = path.join(DATA, 'exercise-photos');
fs.mkdirSync(exercisePhotosDir, { recursive: true });

// An admin who can hand someone a way back into their account can also sign in as them. That is
// a real power, so it is written down — and publicUser hands the timestamp back to the person it
// was used on, so a rescue is never silent. The secret itself is never part of the record.
function recordAdminAction(adminId, targetId, action) {
  db.adminActions.push({ ts: new Date().toISOString(), adminId, targetId, action });
  if (db.adminActions.length > 500) db.adminActions.splice(0, db.adminActions.length - 500);
}
function recordSuggestion(suggestion) {
  db.suggestions.push(suggestion);
  let excess = db.suggestions.length - 500;
  for (let i = 0; i < db.suggestions.length && excess > 0;) {
    if (db.suggestions[i].resolvedAt) { db.suggestions.splice(i, 1); excess--; }
    else i++;
  }
  if (excess > 0) db.suggestions.splice(0, excess);
}
function lastAdminRecovery(uid) {
  for (let i = db.adminActions.length - 1; i >= 0; i--) if (db.adminActions[i].targetId === uid) return db.adminActions[i].ts;
  return null;
}

const publicUser = user => ({
  id: user.id,
  name: user.name,
  admin: isAdmin(user),
  hasPasskey: db.creds.some(c => c.userId === user.id),
  hasPassword: !!user.passwordHash,
  // What the app needs to tell someone their account has no way back if this device dies.
  passkeyCount: db.creds.filter(c => c.userId === user.id).length,
  recoveryCodesLeft: (user.recoveryCodes || []).length,
  mustChangeSecret: !!user.mustChangeSecret,
  lastAdminRecovery: lastAdminRecovery(user.id)
});
function saveDb() { atomicWrite(dbFile, JSON.stringify(db, null, 2)); }
function atomicWrite(file, content) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}
const stateFile = uid => path.join(DATA, 'state-' + uid.replace(/[^a-zA-Z0-9_-]/g, '') + '.json');
function readState(uid) {
  try { return JSON.parse(fs.readFileSync(stateFile(uid), 'utf8')); } catch { return null; }
}
function writeState(uid, state) { atomicWrite(stateFile(uid), JSON.stringify(state)); }

/* ---------- push notifications (Web Push / VAPID) ---------- */
const vapidFile = path.join(DATA, 'vapid.json');
let vapid;
try { vapid = JSON.parse(fs.readFileSync(vapidFile, 'utf8')); }
catch { vapid = webpush.generateVAPIDKeys(); fs.writeFileSync(vapidFile, JSON.stringify(vapid), { mode: 0o600 }); }
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || (SECURE ? ORIGIN : 'mailto:admin@localhost');
webpush.setVapidDetails(VAPID_SUBJECT, vapid.publicKey, vapid.privateKey);

async function sendPush(userId, payload) {
  const subs = db.subs.filter(s => s.userId === userId);
  if (!subs.length) return;
  const body = JSON.stringify(payload);
  let dirty = false;
  await Promise.all(subs.map(async sub => {
    // urgency 'high' is the one lever we have over delivery speed — iOS/Android throttle
    // low-urgency background push more aggressively under battery-saving modes. TTL is left
    // at the library default (long) so a briefly-offline device still gets it once reconnected,
    // rather than risking it being dropped for the sake of shaving off latency that TTL doesn't
    // actually control anyway.
    try { await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body, { urgency: 'high' }); }
    catch (e) {
      console.error('push send failed', userId, e.statusCode, e.body || e.message);
      if (e.statusCode === 404 || e.statusCode === 410) {
        db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint); dirty = true;
      }
    }
  }));
  if (dirty) saveDb();
}

// Rest-timer alerts: client schedules on start/extend, cancels on skip or on-screen completion —
// this only fires when the tab was backgrounded/suspended and never got to cancel it itself.
const restTimers = new Map(); // userId -> Timeout
function scheduleRestTimer(userId, sec) {
  const t = restTimers.get(userId);
  if (t) clearTimeout(t);
  restTimers.set(userId, setTimeout(() => {
    restTimers.delete(userId);
    sendPush(userId, { title: 'Rest over 💪', body: 'Time for your next set.', tag: 'rest-timer' });
  }, sec * 1000));
}
function cancelRestTimer(userId) {
  const t = restTimers.get(userId);
  if (t) { clearTimeout(t); restTimers.delete(userId); }
}

// "Workout planned today" reminder — one per user per day, at their chosen time.
// Duplicated (not imported) from frontend/src/lib/history.js effectiveRoutineId — tiny pure helper, not worth sharing across the two runtimes.
function effectiveRoutineId(S, iso) {
  const ov = S.dayPlan?.[iso];
  if (ov === 'rest') return null;
  if (ov && S.routines?.some(r => r.id === ov)) return ov;
  const wd = new Date(iso + 'T12:00:00').getDay();
  return S.week?.[wd] || null;
}
// Computes "now" in an arbitrary IANA zone (e.g. "Europe/Lisbon") instead of the server's own —
// each user's reminder fires by their own clock, wherever they and their phone actually are.
function userNow(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).formatToParts(new Date());
    const g = t => parts.find(p => p.type === t)?.value;
    const date = `${g('year')}-${g('month')}-${g('day')}`;
    // Weekday is derived from the zone's own date, not the server's — a Sunday-evening review
    // has to be Sunday where the user is, which is what the reminder already assumes for time.
    return { date, hhmm: `${g('hour')}:${g('minute')}`, weekday: new Date(date + 'T12:00:00Z').getUTCDay() };
  } catch { return null; } // unknown/invalid tz string — skip this user rather than guess
}
setInterval(() => {
  for (const user of db.users) {
    if (!db.subs.some(s => s.userId === user.id)) continue;
    const S = readState(user.id);
    if (!S?.reminder?.on) continue;
    const now = userNow(S.reminder.tz || 'UTC');
    if (!now || S.reminder.time !== now.hhmm) continue;
    if (user.lastReminder === now.date) continue;
    if ((S.workouts || []).some(w => w.d === now.date)) continue;
    const rid = effectiveRoutineId(S, now.date);
    if (!rid) continue; // rest day — nothing planned
    const routine = (S.routines || []).find(r => r.id === rid);
    console.log('reminder firing', user.id, rid);
    user.lastReminder = now.date;
    saveDb();
    sendPush(user.id, {
      title: routine ? `${routine.emoji || '🏋️'} ${routine.name} today` : 'Workout planned today',
      body: "It's on your plan — let's go 💪",
      tag: 'day-reminder'
    });
  }
// Checked every 10s (not 60s) — ticks aren't aligned to the top of the minute, so a 60s
// interval could sit on your target minute for up to 59s before noticing. 10s caps that at ~9s.
}, 10000).unref();

/* ---------- sessions (signed cookie) ---------- */
function sign(payload) {
  const mac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + mac;
}
function verifySig(token) {
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i), mac = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  } catch { return null; }
  return payload;
}
// Session payload is `<uid>:<expiry>:<version>`, where the version is the user's `sv` counter.
// Bumping `sv` (POST /api/logout/all) makes every cookie ever handed out for that account stop
// verifying, which is the only revocation there was before short of deleting ./data/secret and
// signing out the whole instance. Cookies minted before `sv` existed have no third field and are
// read as version 0, matching a user who has never bumped — they stay valid until they expire.
const sessionVersion = user => user.sv || 0;
function makeSession(user) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  return sign(user.id + ':' + exp + ':' + sessionVersion(user));
}
function readSession(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(c => {
    const i = c.indexOf('='); return i < 0 ? ['', ''] : [c.slice(0, i).trim(), c.slice(i + 1).trim()];
  }));
  const tok = cookies.gymsid;
  if (!tok) return null;
  const payload = verifySig(tok);
  if (!payload) return null;
  const [uid, exp, ver] = payload.split(':');
  if (!uid || +exp < Date.now()) return null;
  const user = db.users.find(u => u.id === uid) || null;
  if (!user) return null;
  if (user.disabled || user.pending) return null; // disabled and unapproved accounts are locked out everywhere
  // Missing third field = pre-versioning cookie = version 0. Anything non-numeric is a malformed
  // payload (it still had to pass the HMAC, so this is belt-and-braces) and is refused outright.
  const claimed = ver === undefined ? 0 : Number(ver);
  if (!Number.isInteger(claimed) || claimed !== sessionVersion(user)) return null;
  return user;
}
// Guard for /api/admin/* — resolves the caller and 401/403s if they aren't an admin.
function requireAdmin(req, res) {
  const user = readSession(req);
  if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
  if (!isAdmin(user)) { json(res, 403, { error: 'forbidden' }); return null; }
  return user;
}
function sessionCookie(user) {
  return `gymsid=${makeSession(user)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly;${SECURE} SameSite=Lax`;
}
const clearCookie = `gymsid=; Path=/; Max-Age=0; HttpOnly;${SECURE} SameSite=Lax`;

/* ---------- challenge store (in-memory, 5 min TTL) ---------- */
const challenges = new Map(); // cid -> {challenge, name?, uid?, exp}
function putChallenge(data) {
  const cid = crypto.randomBytes(16).toString('base64url');
  challenges.set(cid, { ...data, exp: Date.now() + 5 * 60000 });
  return cid;
}
function takeChallenge(cid) {
  const c = challenges.get(cid);
  challenges.delete(cid);
  if (!c || c.exp < Date.now()) return null;
  return c;
}
setInterval(() => { for (const [k, v] of challenges) if (v.exp < Date.now()) challenges.delete(k); }, 60000).unref();

/* ---------- helpers ---------- */
function json(res, code, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(extraHeaders || {}) });
  res.end(body);
}
function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', d => {
      size += d.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(d);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}
function readRawBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; let tooLarge = false; const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { tooLarge = true; return; }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) { const error = new Error('body too large'); error.status = 413; reject(error); }
      else resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}
const b64uToBuf = s => Buffer.from(s, 'base64url');

/* ---------- live presence (in-memory) ---------- */
// Clients heartbeat /api/activity while a workout is on screen; the admin dashboard reads who's
// live. Purely ephemeral — never persisted. Expires shortly after the last ping.
const presence = new Map();               // uid -> { name, exIdx, exTotal, setsDone, setsTotal, startedAt, updatedAt }
const PRESENCE_TTL = 70000;               // ~3.5× the 20s client heartbeat
function livePresence(uid) {
  const p = presence.get(uid);
  if (!p) return null;
  if (Date.now() - p.updatedAt > PRESENCE_TTL) { presence.delete(uid); return null; }
  return p;
}
setInterval(() => { for (const [k, v] of presence) if (Date.now() - v.updatedAt > PRESENCE_TTL) presence.delete(k); }, 30000).unref();

const social = createSocialService({
  dataDir: DATA,
  // Pending requests are not members yet and must not be enrolled by Social's boot migration.
  users: () => db.users.filter(user => !user.pending),
  readState,
  writeState,
  isAdmin,
  sendPush,
  enabled: SOCIAL_ENABLED,
  timeZone: SOCIAL_TZ
});

// Keep immediate invite signups and admin approvals on one explicit Social-enrolment path.
// syncUserState persists the profile together with the user's (normally empty) initial state.
async function ensureSocialProfile(user) {
  if (!SOCIAL_ENABLED) return;
  const data = social.getData();
  if (!data.profiles[user.id]) data.profiles[user.id] = defaultSocialProfile(user);
  await social.syncUserState(user, readState(user.id) || {});
}

async function notifyAdminsOfAccessRequest(user) {
  await Promise.all(db.users.filter(candidate => isAdmin(candidate) && !candidate.disabled && !candidate.pending)
    .map(admin => sendPush(admin.id, {
      title: 'New openGym access request',
      body: `${user.name} is waiting for approval.`,
      tag: `access-request-${user.id}`,
      url: '#/admin'
    })));
}

async function notifyAdminsOfSuggestion(user, suggestion) {
  await Promise.all(db.users.filter(candidate => isAdmin(candidate) && !candidate.disabled && !candidate.pending)
    .map(admin => sendPush(admin.id, {
      title: 'New openGym suggestion',
      body: `${user.name} sent a ${suggestion.type === 'bug' ? 'bug report' : 'feature idea'}.`,
      tag: `suggestion-${suggestion.id}`,
      url: '#/admin'
    })));
}

// Small in-process guard in addition to the reverse proxy. The instance is deliberately
// single-process, so a per-process sliding window is enough to stop accidental loops and
// low-effort abuse without adding another service. NPM remains the outer IP-based limit.
const rateBuckets = new Map();
function rateRule(key) {
  if (key === 'POST /api/password/login') return { max: 5, ms: 10 * 60000 };
  if (key === 'POST /api/password/change') return { max: 5, ms: 10 * 60000 };
  if (key === 'POST /api/password/register') return { max: 10, ms: 10 * 60000 };
  if (key === 'POST /api/recovery/login') return { max: 5, ms: 10 * 60000 };
  if (/^POST \/api\/(register|login|passkeys|recovery|password)\//.test(key)) return { max: 20, ms: 10 * 60000 };
  if (key === 'POST /api/social/comments/new') return { max: 5, ms: 60000 };
  if (key === 'POST /api/suggestions') return { max: 5, ms: 60000 };
  if (key === 'POST /api/social/challenges/new') return { max: 10, ms: 86400000 };
  if (key === 'POST /api/exercise-photo') return { max: 30, ms: 60000 };
  if (key.startsWith('POST /api/social/') || key === 'PUT /api/social/me') return { max: 30, ms: 60000 };
  if (key.startsWith('GET /api/social/')) return { max: 120, ms: 60000 };
  return null;
}
function rateAllowed(req, key) {
  const rule = rateRule(key); if (!rule) return { ok: true };
  const user = readSession(req);
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const actor = user?.id || forwarded || req.socket.remoteAddress || 'unknown';
  const bucketKey = `${key}:${actor}`, cutoff = Date.now() - rule.ms;
  const hits = (rateBuckets.get(bucketKey) || []).filter(ts => ts > cutoff);
  if (hits.length >= rule.max) return { ok: false, retryAfter: Math.max(1, Math.ceil((hits[0] + rule.ms - Date.now()) / 1000)) };
  hits.push(Date.now()); rateBuckets.set(bucketKey, hits); return { ok: true };
}
setInterval(() => { const cutoff = Date.now() - 86400000; for (const [key, hits] of rateBuckets) if (!hits.some(ts => ts > cutoff)) rateBuckets.delete(key); }, 3600000).unref();

/* ---------- routes ---------- */
const routes = {
  'GET /api/health': async (req, res) => json(res, 200, { ok: true, users: db.users.length, version: APP_VERSION }),

  // Public config the login screen needs before anyone is signed in. `coach` is absent unless
  // the instance has both switched the Coach on and successfully connected a provider — the
  // single flag every piece of Coach UI hangs off, so an unconfigured instance is byte-for-byte
  // the app it was before the feature existed.
  'GET /api/config': async (req, res) => {
    const coach = coachConfig.publicConfig();
    json(res, 200, { invite_only: INVITE_ONLY, social: { enabled: SOCIAL_ENABLED }, version: APP_VERSION, source_url: SOURCE_URL, ...(coach ? { coach } : {}) });
  },

  'GET /api/me': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { user: publicUser(user) });
  },

  'POST /api/exercise-photo': async (req, res) => {
    const user = readSession(req); if (!user) return json(res, 401, { error: 'not signed in' });
    const image = await readRawBody(req, 1024 * 1024);
    const jpeg = image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
    const png = image.length >= 8 && image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (!jpeg && !png) return json(res, 415, { error: 'only JPEG and PNG images are accepted' });
    const id = `${crypto.randomUUID()}.${jpeg ? 'jpg' : 'png'}`;
    fs.writeFileSync(path.join(exercisePhotosDir, id), image, { mode: 0o600, flag: 'wx' });
    db.exercisePhotoOwners[id] = user.id;
    saveDb();
    json(res, 200, { id });
  },

  'GET /api/exercise-photo/:id': async (req, res) => {
    const user = readSession(req); if (!user) return json(res, 401, { error: 'not signed in' });
    let id;
    try { id = decodeURIComponent(new URL(req.url, 'http://x').pathname.slice('/api/exercise-photo/'.length)); }
    catch { return json(res, 404, { error: 'photo not found' }); }
    if (!EXERCISE_PHOTO_ID.test(id) || db.exercisePhotoOwners[id] !== user.id) return json(res, 404, { error: 'photo not found' });
    let image;
    try { image = fs.readFileSync(path.join(exercisePhotosDir, id)); } catch { return json(res, 404, { error: 'photo not found' }); }
    res.writeHead(200, { 'Content-Type': id.endsWith('.png') ? 'image/png' : 'image/jpeg', 'Content-Length': image.length, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
    res.end(image);
  },

  // The client calls this when a custom exercise is deleted or its image is replaced; making
  // deletion owner-only prevents cleanup from becoming a way to remove another user's photo.
  'DELETE /api/exercise-photo/:id': async (req, res) => {
    const user = readSession(req); if (!user) return json(res, 401, { error: 'not signed in' });
    let id;
    try { id = decodeURIComponent(new URL(req.url, 'http://x').pathname.slice('/api/exercise-photo/'.length)); }
    catch { return json(res, 404, { error: 'photo not found' }); }
    if (!EXERCISE_PHOTO_ID.test(id) || db.exercisePhotoOwners[id] !== user.id) return json(res, 404, { error: 'photo not found' });
    try { fs.unlinkSync(path.join(exercisePhotosDir, id)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    delete db.exercisePhotoOwners[id];
    saveDb();
    json(res, 200, { ok: true, id });
  },

  'POST /api/password/register': async (req, res) => {
    const body = await readBody(req, 4096);
    if (body.termsAccepted !== true) return json(res, 400, { error: 'group terms must be accepted' });
    const name = String(body.name || '').normalize('NFKC').trim().slice(0, 40);
    const username = normalizeUsername(name);
    if (!name) return json(res, 400, { error: 'name required' });
    if (db.users.some(u => normalizeUsername(u.name) === username)) return json(res, 409, { error: 'that username is already in use' });
    let secret;
    try { secret = validateLoginSecret(body.secret); }
    catch (error) { return json(res, 400, { error: error.message }); }
    const code = String(body.code || '').trim().toUpperCase();
    const requestingAccess = INVITE_ONLY && body.requestAccess === true && !code;
    if (body.requestAccess === true && code) return json(res, 400, { error: 'an access request cannot include an invite code' });
    if (INVITE_ONLY && !requestingAccess && !db.invites.some(i => i.code === code && !i.usedBy && !i.revoked))
      return json(res, 403, { error: 'a valid invite code is required' });
    const passwordHash = await hashLoginSecret(secret, SECRET);
    if (db.users.some(u => normalizeUsername(u.name) === username)) return json(res, 409, { error: 'that username is already in use' });
    let invite = null;
    if (INVITE_ONLY && !requestingAccess) {
      invite = db.invites.find(i => i.code === code && !i.usedBy && !i.revoked);
      if (!invite) return json(res, 403, { error: 'invite code is no longer valid — ask for a new one' });
    }
    const user = { id: crypto.randomBytes(12).toString('base64url'), name, passwordHash, created: new Date().toISOString() };
    user.termsAcceptedAt = user.created;
    if (requestingAccess) { user.pending = true; user.requestedAt = user.created; }
    if (invite) { user.invitedBy = invite.code; invite.usedBy = user.id; invite.usedAt = user.created; }
    db.users.push(user);
    saveDb();
    if (requestingAccess) {
      await notifyAdminsOfAccessRequest(user);
      return json(res, 200, { pending: true });
    }
    await ensureSocialProfile(user);
    json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/password/login': async (req, res) => {
    const body = await readBody(req, 4096);
    const username = normalizeUsername(body.name);
    const user = db.users.find(u => normalizeUsername(u.name) === username && u.passwordHash);
    const valid = await verifyLoginSecret(body.secret, user?.passwordHash || DUMMY_PASSWORD_HASH, SECRET);
    if (!valid || !user || user.disabled) return json(res, 401, { error: 'invalid username or password/PIN' });
    if (user.pending) return json(res, 403, { error: 'your access request is pending approval' });
    json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/password/options': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const own = db.creds.filter(c => c.userId === user.id);
    if (!own.length) return json(res, 400, { error: 'this profile has no passkey to confirm with' });
    const options = await generateAuthenticationOptions({
      rpID: RP_ID, userVerification: 'required',
      allowCredentials: own.map(c => ({ id: c.id, transports: c.transports || [] }))
    });
    const cid = putChallenge({ challenge: options.challenge, passwordUserId: user.id });
    json(res, 200, { cid, options });
  },

  'POST /api/password/set': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req, 4096);
    let secret;
    try { secret = validateLoginSecret(body.secret); }
    catch (error) { return json(res, 400, { error: error.message }); }
    const c = takeChallenge(body.cid);
    if (!c || c.passwordUserId !== user.id) return json(res, 400, { error: 'challenge expired — try again' });
    const cred = db.creds.find(x => x.id === body.credential?.id && x.userId === user.id);
    if (!cred) return json(res, 400, { error: 'use a passkey belonging to this profile' });
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: true,
        credential: { id: cred.id, publicKey: b64uToBuf(cred.publicKey), counter: cred.counter, transports: cred.transports }
      });
    } catch (error) { return json(res, 400, { error: 'verification failed: ' + error.message }); }
    if (!verification.verified) return json(res, 400, { error: 'not verified' });
    cred.counter = verification.authenticationInfo.newCounter;
    user.passwordHash = await hashLoginSecret(secret, SECRET);
    delete user.mustChangeSecret;
    saveDb();
    json(res, 200, { user: publicUser(user) });
  },

  'POST /api/password/change': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req, 4096);
    const valid = await verifyLoginSecret(body.currentSecret, user.passwordHash || DUMMY_PASSWORD_HASH, SECRET);
    if (!user.passwordHash || !valid) return json(res, 401, { error: 'current password/PIN is incorrect' });
    let secret;
    try { secret = validateLoginSecret(body.newSecret); }
    catch (error) { return json(res, 400, { error: error.message }); }
    user.passwordHash = await hashLoginSecret(secret, SECRET);
    // Whatever the admin handed over is now gone: this is the user's own secret again.
    delete user.mustChangeSecret;
    saveDb();
    json(res, 200, { user: publicUser(user) });
  },

  'POST /api/register/options': async (req, res) => {
    const body = await readBody(req);
    if (body.termsAccepted !== true) return json(res, 400, { error: 'group terms must be accepted' });
    const name = String(body.name || '').normalize('NFKC').trim().slice(0, 40);
    if (!name) return json(res, 400, { error: 'name required' });
    if (db.users.some(u => normalizeUsername(u.name) === normalizeUsername(name))) return json(res, 409, { error: 'that username is already in use' });
    const code = String(body.code || '').trim().toUpperCase();
    const requestingAccess = INVITE_ONLY && body.requestAccess === true && !code;
    if (body.requestAccess === true && code) return json(res, 400, { error: 'an access request cannot include an invite code' });
    if (INVITE_ONLY && !requestingAccess && !db.invites.some(i => i.code === code && !i.usedBy && !i.revoked))
      return json(res, 403, { error: 'a valid invite code is required' });
    const uid = crypto.randomBytes(12).toString('base64url');
    const options = await generateRegistrationOptions({
      rpName: RP_NAME, rpID: RP_ID,
      userID: Buffer.from(uid), userName: name, userDisplayName: name,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      excludeCredentials: []
    });
    const cid = putChallenge({ challenge: options.challenge, name, uid, code, termsAccepted: true, requestingAccess });
    json(res, 200, { cid, options });
  },

  'POST /api/register/verify': async (req, res) => {
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c || !c.uid || !c.termsAccepted) return json(res, 400, { error: 'challenge expired — try again' });
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false
      });
    } catch (e) { return json(res, 400, { error: 'verification failed: ' + e.message }); }
    if (!verification.verified) return json(res, 400, { error: 'not verified' });
    const { credential } = verification.registrationInfo;
    if (db.creds.find(x => x.id === credential.id)) return json(res, 409, { error: 'credential already registered' });
    if (db.users.some(u => normalizeUsername(u.name) === normalizeUsername(c.name))) return json(res, 409, { error: 'that username is already in use' });
    // Re-check the invite at the last moment (it may have been used/revoked since options), then burn it.
    let invite = null;
    if (INVITE_ONLY && !c.requestingAccess) {
      invite = db.invites.find(i => i.code === c.code && !i.usedBy && !i.revoked);
      if (!invite) return json(res, 403, { error: 'invite code is no longer valid — ask for a new one' });
    }
    const user = { id: c.uid, name: c.name, created: new Date().toISOString() };
    user.termsAcceptedAt = user.created;
    if (c.requestingAccess) { user.pending = true; user.requestedAt = user.created; }
    if (invite) { user.invitedBy = invite.code; invite.usedBy = user.id; invite.usedAt = user.created; }
    db.users.push(user);
    db.creds.push({
      id: credential.id, userId: user.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter || 0,
      transports: body.credential?.response?.transports || []
    });
    saveDb();
    if (c.requestingAccess) {
      await notifyAdminsOfAccessRequest(user);
      return json(res, 200, { pending: true });
    }
    await ensureSocialProfile(user);
    json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/login/options': async (req, res) => {
    const options = await generateAuthenticationOptions({
      rpID: RP_ID, userVerification: 'preferred', allowCredentials: []
    });
    const cid = putChallenge({ challenge: options.challenge });
    json(res, 200, { cid, options });
  },

  'POST /api/login/verify': async (req, res) => {
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c) return json(res, 400, { error: 'challenge expired — try again' });
    const cred = db.creds.find(x => x.id === body.credential?.id);
    if (!cred) return json(res, 404, { error: 'unknown passkey — create a profile first' });
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false,
        credential: {
          id: cred.id,
          publicKey: b64uToBuf(cred.publicKey),
          counter: cred.counter,
          transports: cred.transports
        }
      });
    } catch (e) { return json(res, 400, { error: 'verification failed: ' + e.message }); }
    if (!verification.verified) return json(res, 400, { error: 'not verified' });
    cred.counter = verification.authenticationInfo.newCounter;
    saveDb();
    const user = db.users.find(u => u.id === cred.userId);
    if (!user) return json(res, 500, { error: 'user missing' });
    if (user.disabled) return json(res, 403, { error: 'this account has been disabled' });
    if (user.pending) return json(res, 403, { error: 'your access request is pending approval' });
    json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(user) });
  },

  'GET /api/passkeys': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const passkeys = db.creds.filter(c => c.userId === user.id).map((c, index) => ({
      label: c.label || (index === 0 ? 'Original passkey' : 'Passkey'),
      created: c.created || user.created || null
    }));
    json(res, 200, { passkeys, recoveryCodes: Array.isArray(user.recoveryCodes) ? user.recoveryCodes.length : 0 });
  },

  'POST /api/passkeys/options': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req, 4096);
    const label = String(body.label || '').trim().slice(0, 40) || 'Passkey';
    const own = db.creds.filter(c => c.userId === user.id);
    const options = await generateRegistrationOptions({
      rpName: RP_NAME, rpID: RP_ID,
      userID: Buffer.from(user.id), userName: user.name, userDisplayName: user.name,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: own.map(c => ({ id: c.id, transports: c.transports || [] }))
    });
    const cid = putChallenge({ challenge: options.challenge, addUserId: user.id, label });
    json(res, 200, { cid, options });
  },

  'POST /api/passkeys/verify': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c || c.addUserId !== user.id) return json(res, 400, { error: 'challenge expired — try again' });
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: true
      });
    } catch (e) { return json(res, 400, { error: 'verification failed: ' + e.message }); }
    if (!verification.verified) return json(res, 400, { error: 'not verified' });
    const { credential } = verification.registrationInfo;
    if (db.creds.some(x => x.id === credential.id)) return json(res, 409, { error: 'this passkey is already registered' });
    db.creds.push({
      id: credential.id, userId: user.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter || 0,
      transports: body.credential?.response?.transports || [],
      label: c.label,
      created: new Date().toISOString()
    });
    saveDb();
    json(res, 200, { ok: true, count: db.creds.filter(x => x.userId === user.id).length, user: publicUser(user) });
  },

  'POST /api/recovery/options': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const own = db.creds.filter(c => c.userId === user.id);
    const options = await generateAuthenticationOptions({
      rpID: RP_ID, userVerification: 'required',
      allowCredentials: own.map(c => ({ id: c.id, transports: c.transports || [] }))
    });
    const cid = putChallenge({ challenge: options.challenge, recoveryUserId: user.id });
    json(res, 200, { cid, options });
  },

  // Two ways to prove the profile is yours before minting new codes: a passkey, or the current
  // password/PIN. The second path exists because a profile that never registered a passkey could
  // otherwise never generate the codes that are its only way back if the password is lost.
  'POST /api/recovery/regenerate': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (body.secret !== undefined) {
      const valid = await verifyLoginSecret(body.secret, user.passwordHash || DUMMY_PASSWORD_HASH, SECRET);
      if (!user.passwordHash || !valid) return json(res, 401, { error: 'current password/PIN is incorrect' });
    } else {
      const c = takeChallenge(body.cid);
      if (!c || c.recoveryUserId !== user.id) return json(res, 400, { error: 'challenge expired — try again' });
      const cred = db.creds.find(x => x.id === body.credential?.id && x.userId === user.id);
      if (!cred) return json(res, 400, { error: 'use a passkey belonging to this profile' });
      let verification;
      try {
        verification = await verifyAuthenticationResponse({
          response: body.credential,
          expectedChallenge: c.challenge,
          expectedOrigin: ORIGIN,
          expectedRPID: RP_ID,
          requireUserVerification: true,
          credential: { id: cred.id, publicKey: b64uToBuf(cred.publicKey), counter: cred.counter, transports: cred.transports }
        });
      } catch (e) { return json(res, 400, { error: 'verification failed: ' + e.message }); }
      if (!verification.verified) return json(res, 400, { error: 'not verified' });
      cred.counter = verification.authenticationInfo.newCounter;
    }
    const codes = createRecoveryCodes();
    const created = new Date().toISOString();
    user.recoveryCodes = codes.map(code => ({ hash: hashRecoveryCode(code, SECRET), created }));
    saveDb();
    json(res, 200, { codes });
  },

  'POST /api/recovery/login': async (req, res) => {
    const body = await readBody(req, 4096);
    const match = findRecoveryCode(db.users, body.code, SECRET);
    if (!match || match.user.disabled) return json(res, 401, { error: 'invalid or already used recovery code' });
    if (match.user.pending) return json(res, 403, { error: 'your access request is pending approval' });
    match.user.recoveryCodes.splice(match.index, 1);
    saveDb();
    const user = match.user;
    json(res, 200, {
      user: publicUser(user),
      recoveryCodesRemaining: user.recoveryCodes.length
    }, { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/logout': async (req, res) => json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie }),

  // "Sign out everywhere" — bumps this user's session version, which invalidates every cookie
  // ever issued for the account, on every device, including a copy someone else walked off with.
  // The caller's own cookie is cleared here too, so the browser doing it doesn't sit on a token
  // it no longer accepts. Passkeys are untouched: signing back in works immediately.
  'POST /api/logout/all': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    user.sv = sessionVersion(user) + 1;
    saveDb();
    json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
  },

  'GET /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    try {
      const state = JSON.parse(fs.readFileSync(stateFile(user.id), 'utf8'));
      json(res, 200, { state });
    } catch { json(res, 200, { state: null }); }
  },

  'PUT /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (!body.state || typeof body.state !== 'object') return json(res, 400, { error: 'state required' });
    delete body.state.active;              // in-progress workouts stay device-local
    writeState(user.id, body.state);
    if (SOCIAL_ENABLED) await social.syncUserState(user, body.state);
    json(res, 200, { ok: true, ts: body.state._ts || null });
  },

  'GET /api/push/public-key': async (req, res) => json(res, 200, { key: vapid.publicKey }),

  'POST /api/push/subscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sub = body.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return json(res, 400, { error: 'invalid subscription' });
    db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint);
    db.subs.push({ userId: user.id, endpoint: sub.endpoint, keys: sub.keys, created: new Date().toISOString() });
    saveDb();
    json(res, 200, { ok: true });
  },

  'POST /api/push/unsubscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    db.subs = db.subs.filter(s => !(s.userId === user.id && s.endpoint === body.endpoint));
    saveDb();
    json(res, 200, { ok: true });
  },

  'POST /api/push/test': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    await sendPush(user.id, { title: 'openGym', body: 'Test notification ✅ — this is what alerts look like.', tag: 'test' });
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sec = Math.max(1, Math.min(3600, Math.round(+body.seconds || 0)));
    if (!sec) return json(res, 400, { error: 'seconds required' });
    scheduleRestTimer(user.id, sec);
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer/cancel': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    cancelRestTimer(user.id);
    json(res, 200, { ok: true });
  },

  // Live-workout heartbeat: client pings while a workout is on screen; { active:false } drops it.
  'POST /api/activity': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (body.active) {
      presence.set(user.id, {
        name: String(body.name || '').slice(0, 60),
        exIdx: +body.exIdx || 0, exTotal: +body.exTotal || 0,
        setsDone: +body.setsDone || 0, setsTotal: +body.setsTotal || 0,
        startedAt: +body.startedAt || Date.now(),
        updatedAt: Date.now()
      });
    } else presence.delete(user.id);
    json(res, 200, { ok: true });
  },

  'POST /api/suggestions': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req, 4096);
    const type = String(body.type || '');
    if (type !== 'bug' && type !== 'idea') return json(res, 400, { error: 'type must be bug or idea' });
    const text = String(body.text || '').trim().replace(/[<>]/g, '').slice(0, 1000);
    if (!text) return json(res, 400, { error: 'text required' });
    const suggestion = {
      id: crypto.randomBytes(12).toString('base64url'),
      type,
      text,
      userId: user.id,
      userName: user.name,
      created: new Date().toISOString(),
      resolvedAt: null,
      resolvedBy: null
    };
    recordSuggestion(suggestion);
    saveDb();
    await notifyAdminsOfSuggestion(user, suggestion);
    json(res, 200, { ok: true });
  },

  /* ---------- admin dashboard ---------- */
  // One row per user, cheap enough for a personal instance (reads each state file once).
  'GET /api/admin/users': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const users = db.users.map(u => {
      const S = readState(u.id) || {};
      const workouts = S.workouts || [];
      const last = workouts[workouts.length - 1];
      return {
        id: u.id, name: u.name, created: u.created || null,
        disabled: !!u.disabled, pending: !!u.pending, requestedAt: u.requestedAt || null,
        admin: isAdmin(u), invitedBy: u.invitedBy || null,
        workouts: workouts.length,
        lastWorkout: last ? last.d : null,
        lastSync: S._ts || null,
        hasPush: db.subs.some(s => s.userId === u.id),
        live: livePresence(u.id)
      };
    });
    json(res, 200, { users, invite_only: INVITE_ONLY, now: Date.now() });
  },

  'POST /api/admin/user/approve': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    if (!u.pending) return json(res, 400, { error: 'user is not pending approval' });
    delete u.pending;
    await ensureSocialProfile(u);
    recordAdminAction(admin.id, u.id, 'approve-access');
    saveDb();
    json(res, 200, { ok: true, id: u.id });
  },

  'POST /api/admin/user/reject': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    if (!u.pending) return json(res, 400, { error: 'user is not pending approval' });
    recordAdminAction(admin.id, u.id, 'reject-access');
    db.creds = db.creds.filter(credential => credential.userId !== u.id);
    db.users = db.users.filter(user => user.id !== u.id);
    saveDb();
    json(res, 200, { ok: true, id: u.id });
  },

  // Drill-down: full workout history + body-weight log for one user.
  'GET /api/admin/user': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    const u = db.users.find(x => x.id === id);
    if (!u) return json(res, 404, { error: 'no such user' });
    const S = readState(u.id) || {};
    json(res, 200, {
      user: { id: u.id, name: u.name, created: u.created || null, disabled: !!u.disabled, admin: isAdmin(u), invitedBy: u.invitedBy || null },
      unit: S.unit || 'kg',
      lastSync: S._ts || null,
      routines: (S.routines || []).map(r => ({ id: r.id, name: r.name, emoji: r.emoji, count: (r.ex || []).length })),
      bodyweight: S.bodyweight || [],
      workouts: (S.workouts || []).slice().reverse(),   // newest first for display
      // How this account can currently be signed into, so the admin can see at a glance whether
      // it is one lost phone away from being unreachable. Counts only — never a hash.
      access: {
        passkeys: db.creds.filter(c => c.userId === u.id).length,
        hasPassword: !!u.passwordHash,
        recoveryCodesLeft: (u.recoveryCodes || []).length,
        mustChangeSecret: !!u.mustChangeSecret
      },
      adminActions: db.adminActions.filter(a => a.targetId === u.id).slice(-20).reverse()
    });
  },

  'POST /api/admin/user/disable': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    if (isAdmin(u)) return json(res, 400, { error: 'cannot disable an admin' });
    u.disabled = !!body.disabled;
    if (u.disabled) presence.delete(u.id);   // drop them off "training now" at once
    saveDb();
    json(res, 200, { ok: true, id: u.id, disabled: u.disabled });
  },

  // ---- Account rescue ----
  // Losing the only passkey on a profile with no password and no recovery codes used to mean
  // losing the account outright: /api/recovery/regenerate needs the passkey you no longer have.
  // These two give the instance owner a way to hand someone back in. Both are logged, and the log
  // is shown to the affected user, because being able to do this is also being able to sign in
  // as them — with Social on, that means posting in their name.
  'POST /api/admin/user/recovery-code': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    if (u.disabled) return json(res, 400, { error: 'enable the account before issuing a code' });
    const [code] = createRecoveryCodes(1);
    // Appended rather than replacing: any codes the user still holds keep working, so a rescue
    // never quietly invalidates the backup they had all along.
    u.recoveryCodes = [...(u.recoveryCodes || []), { hash: hashRecoveryCode(code, SECRET), created: new Date().toISOString(), issuedBy: admin.id }];
    recordAdminAction(admin.id, u.id, 'recovery-code');
    saveDb();
    json(res, 200, { code });   // returned once, stored only as an HMAC
  },

  'POST /api/admin/user/password-reset': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req, 4096);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    if (u.disabled) return json(res, 400, { error: 'enable the account before resetting its password' });
    let secret, generated = false;
    if (body.secret === undefined || body.secret === null || body.secret === '') {
      secret = generateTempSecret(); generated = true;
    } else {
      try { secret = validateLoginSecret(body.secret); }
      catch (error) { return json(res, 400, { error: error.message }); }
    }
    u.passwordHash = await hashLoginSecret(secret, SECRET);
    // The admin knows this one, so the app asks for a replacement at the next sign-in. Sessions
    // are deliberately left alone: the point is to let someone back in, not to evict them.
    u.mustChangeSecret = true;
    recordAdminAction(admin.id, u.id, 'password-reset');
    saveDb();
    json(res, 200, { ok: true, ...(generated ? { secret } : {}) });
  },

  'GET /api/admin/invites': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    // resolve usedBy uid → name for display
    const invites = db.invites.map(i => ({
      ...i, usedByName: i.usedBy ? (db.users.find(u => u.id === i.usedBy) || {}).name || null : null
    }));
    json(res, 200, { invites, invite_only: INVITE_ONLY });
  },

  'POST /api/admin/invites/new': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    let code;
    // 16 hex chars = 64 bits, up from 8 chars / 32 bits. The app has no rate limiting by design
    // (that's the reverse proxy's job) and /api/register/options tells a caller whether a code is
    // good, so the code itself has to be the thing that isn't worth guessing. Codes already in
    // db.json keep working — validation is an exact string compare, never a length or format check.
    do { code = crypto.randomBytes(8).toString('hex').toUpperCase(); } while (db.invites.some(i => i.code === code));
    const invite = { code, note: String(body.note || '').slice(0, 60), createdBy: admin.id, created: new Date().toISOString() };
    db.invites.push(invite);
    saveDb();
    json(res, 200, { invite });
  },

  'POST /api/admin/invites/revoke': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const inv = db.invites.find(i => i.code === String(body.code || '').toUpperCase());
    if (!inv) return json(res, 404, { error: 'no such code' });
    if (inv.usedBy) return json(res, 400, { error: 'already used — cannot revoke' });
    db.invites = db.invites.filter(i => i.code !== inv.code);
    saveDb();
    json(res, 200, { ok: true });
  },

  'GET /api/admin/suggestions': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    json(res, 200, { suggestions: db.suggestions });
  },

  'POST /api/admin/suggestions/resolve': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req, 4096);
    const suggestion = db.suggestions.find(item => item.id === String(body.id || ''));
    if (!suggestion) return json(res, 404, { error: 'no such suggestion' });
    if (!suggestion.resolvedAt) {
      suggestion.resolvedAt = new Date().toISOString();
      suggestion.resolvedBy = admin.id;
      saveDb();
    }
    json(res, 200, { ok: true, suggestion });
  },

  /* ---------- AI Coach ---------- */
  // Routes live in coach/routes.js and are handed the helpers above rather than importing
  // them: they are closures over db and SECRET, and passing them in keeps that module free of
  // a cycle. Every one of them is inert while the feature is unconfigured.
  ...social.routes({ json, readBody: req => readBody(req, 64 * 1024), readRawBody, readSession, requireAdmin }),
  ...coachRoutes({ json, readBody, readSession, requireAdmin })
};

/* ---------- Coach: boot recovery, notifications, scheduled reviews ---------- */
// A job that was running when the process died is not coming back; say so rather than leaving
// a spinner that never resolves.
coachJobs.recoverOnBoot();
// A ready proposal is the one Coach event worth a notification. Failures and "nothing to
// change" stay silent on purpose (FR-38/E4).
coachJobs.setProposalHook((uid, pending) => {
  const n = (pending?.changes || []).length;
  if (!n) return;
  sendPush(uid, {
    title: 'Your Coach has been reading',
    body: n === 1 ? '1 suggestion after this week' : `${n} suggestions after this week`,
    tag: 'coach-proposal', url: '#/coach'
  });
});
startCadence({ users: () => db.users.filter(user => !user.pending), userNow });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const key = req.method + ' ' + url.pathname;
  const handler = routes[key]
    || (req.method === 'GET' && url.pathname.startsWith('/api/social/photo/') ? routes['GET /api/social/photo/:id'] : null)
    || (req.method === 'GET' && url.pathname.startsWith('/api/exercise-photo/') ? routes['GET /api/exercise-photo/:id'] : null)
    || (req.method === 'DELETE' && url.pathname.startsWith('/api/exercise-photo/') ? routes['DELETE /api/exercise-photo/:id'] : null);
  if (!handler) return json(res, 404, { error: 'not found' });
  const rate = rateAllowed(req, key);
  if (!rate.ok) return json(res, 429, { error: 'too many requests' }, { 'Retry-After': String(rate.retryAfter) });
  try { await handler(req, res); }
  catch (e) {
    console.error(key, e);
    if (!res.headersSent) json(res, e.status || 500, { error: e.status === 413 ? 'body too large' : 'server error' });
  }
}).listen(PORT, () => console.log(`gym-api on :${PORT} (rpID=${RP_ID}, origin=${ORIGIN})`));
