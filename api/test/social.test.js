import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildRankings, createSocialService, DEFAULT_FIELDS, mondayOf } from '../social/service.js';

const tracked = (id, d, { unit = 'kg', vol = 1000, minutes = 60, prs = 1, publish = true, fields = DEFAULT_FIELDS } = {}) => ({
  id, d, start: Date.parse(`${d}T10:00:00Z`), end: Date.parse(`${d}T10:00:00Z`) + minutes * 60000,
  name: 'Push', origin: 'tracked', unit, vol, prs: Array.from({ length: prs }, (_, i) => `pr${i}`),
  social: { eligible: true, publish, fields }, entries: [{ id: 'bench', n: 'Bench press', sets: [{ done: true, w: 100, r: 5, rir: 2 }] }]
});

test('mondayOf uses an ISO week independent of server locale', () => {
  assert.equal(mondayOf('2026-08-27'), '2026-08-24');
  assert.equal(mondayOf('2026-08-24'), '2026-08-24');
});

test('rankings normalize every active category and average the scores', () => {
  const users = [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Beto' }];
  const profiles = Object.fromEntries(users.map(u => [u.id, { enabled: true, rankingsEnabled: true, enabledAt: '2026-08-01T00:00:00.000Z', displayName: u.name, accent: 'lime' }]));
  const states = {
    a: { workouts: [tracked('a1', '2026-08-24', { vol: 2000, minutes: 60, prs: 2 })] },
    b: { workouts: [tracked('b1', '2026-08-25', { vol: 1000, minutes: 30, prs: 1 })] }
  };
  const out = buildRankings({ profiles, users, states, week: '2026-08-27' });
  assert.equal(out.podium[0].userId, 'a');
  assert.equal(out.rows[0].score, 100);
  assert.equal(out.rows[1].scores.volume, 50);
  assert.deepEqual(out.activeCategories, ['volume', 'consistency', 'minutes', 'prs', 'streak']);
});

test('rankings convert pounds to kg and exclude imports, old workouts and non-consenting users', () => {
  const users = [{ id: 'kg', name: 'KG' }, { id: 'lb', name: 'LB' }, { id: 'off', name: 'Off' }];
  const profile = id => ({ userId: id, enabled: true, rankingsEnabled: id !== 'off', enabledAt: '2026-08-20T00:00:00.000Z', displayName: id, accent: 'lime' });
  const profiles = Object.fromEntries(users.map(u => [u.id, profile(u.id)]));
  const imported = { ...tracked('import', '2026-08-25', { vol: 999999 }), origin: 'import' };
  const old = tracked('old', '2026-08-25'); old.end = Date.parse('2026-08-01T12:00:00Z');
  const states = {
    kg: { workouts: [tracked('kg1', '2026-08-25', { vol: 100 })] },
    lb: { workouts: [tracked('lb1', '2026-08-25', { unit: 'lb', vol: 220.462262 }), imported, old] },
    off: { workouts: [tracked('off1', '2026-08-25', { vol: 999999 })] }
  };
  const out = buildRankings({ profiles, users, states, week: '2026-08-27' });
  assert.equal(out.rows.length, 2);
  assert.ok(Math.abs(out.rows.find(r => r.userId === 'lb').metric.volume - 100) < 0.01);
});

test('sync stores only approved fields and removes posts when a workout is unshared or deleted', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-social-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const user = { id: 'u1', name: 'Kaio' };
  let state = { workouts: [] };
  const service = createSocialService({ dataDir: dir, users: () => [user], readState: () => state, writeState: (_, next) => { state = next; }, isAdmin: () => false, sendPush: () => {}, enabled: true, now: () => new Date('2026-08-27T12:00:00Z') });
  service.getData().profiles.u1 = { userId: 'u1', displayName: 'Kaio', accent: 'lime', enabled: true, rankingsEnabled: true, enabledAt: '2026-08-20T00:00:00.000Z', fields: DEFAULT_FIELDS, notifications: {} };
  state.workouts = [tracked('w1', '2026-08-27', { fields: { ...DEFAULT_FIELDS, volume: false, exactSets: true, effort: false, bodyweight: false, note: false, rating: false } })];
  state.workouts[0].bw = 80; state.workouts[0].note = '<private>';
  await service.syncUserState(user, state);
  const post = service.getData().posts['u1:w1'];
  assert.equal(post.volume, undefined);
  assert.equal(post.bodyweight, undefined);
  assert.equal(post.note, undefined);
  assert.deepEqual(post.entries[0].sets[0], { weight: 100, reps: 5 });
  state.workouts[0].social.publish = false;
  await service.syncUserState(user, state);
  assert.equal(service.getData().posts['u1:w1'], undefined);
});

test('social routes enforce authentication, ownership and idempotent kudos', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-social-routes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const owner = { id: 'owner', name: 'Owner' }, friend = { id: 'friend', name: 'Friend' };
  const states = { owner: { workouts: [tracked('w1', '2026-08-27')] }, friend: { workouts: [] } };
  const service = createSocialService({ dataDir: dir, users: () => [owner, friend], readState: id => states[id], writeState: (id, next) => { states[id] = next; }, isAdmin: () => false, sendPush: () => {}, enabled: true, now: () => new Date('2026-08-27T09:00:00Z') });
  for (const user of [owner, friend]) service.getData().profiles[user.id] = { userId: user.id, displayName: user.name, accent: 'lime', enabled: true, rankingsEnabled: true, enabledAt: '2026-08-20T00:00:00Z', fields: DEFAULT_FIELDS, notifications: {} };
  await service.syncUserState(owner, states.owner);
  const json = (res, code, body) => Object.assign(res, { code, body });
  const routeMap = service.routes({ json, readBody: async req => req.body || {}, readSession: req => req.user || null, requireAdmin: () => null });
  let res = {};
  await routeMap['GET /api/social/feed']({ url: '/api/social/feed' }, res);
  assert.equal(res.code, 401);
  res = {};
  await routeMap['POST /api/social/kudos']({ user: owner, body: { postId: 'owner:w1', active: true } }, res);
  assert.equal(res.code, 400);
  res = {};
  await routeMap['POST /api/social/kudos']({ user: friend, body: { postId: 'owner:w1', active: true } }, res);
  assert.deepEqual(res.body, { ok: true, active: true, count: 1 });
  res = {};
  await routeMap['POST /api/social/kudos']({ user: friend, body: { postId: 'owner:w1', active: true } }, res);
  assert.equal(res.body.count, 1);
});

test('comments and challenges validate input and keep voluntary membership idempotent', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-social-community-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const owner = { id: 'owner', name: 'Owner' }, friend = { id: 'friend', name: 'Friend' };
  const states = { owner: { workouts: [tracked('w1', '2026-08-27')] }, friend: { workouts: [] } };
  const service = createSocialService({ dataDir: dir, users: () => [owner, friend], readState: id => states[id], writeState: (id, next) => { states[id] = next; }, isAdmin: () => false, sendPush: () => {}, enabled: true, now: () => new Date('2026-08-27T09:00:00Z') });
  for (const user of [owner, friend]) service.getData().profiles[user.id] = { userId: user.id, displayName: user.name, accent: 'lime', enabled: true, rankingsEnabled: true, enabledAt: '2026-08-20T00:00:00Z', fields: DEFAULT_FIELDS, notifications: {} };
  await service.syncUserState(owner, states.owner);
  const json = (res, code, body) => Object.assign(res, { code, body });
  const routes = service.routes({ json, readBody: async req => req.body || {}, readSession: req => req.user || null, requireAdmin: () => null });
  let res = {};
  await routes['POST /api/social/comments/new']({ user: friend, body: { postId: 'owner:w1', text: 'Nice work!' } }, res);
  assert.equal(res.code, 200); assert.equal(res.body.comment.text, 'Nice work!');
  res = {};
  await routes['POST /api/social/challenges/new']({ user: owner, body: { title: 'Too long', metric: 'sessions', start: '2026-08-27', end: '2026-10-01' } }, res);
  assert.equal(res.code, 400);
  res = {};
  await routes['POST /api/social/challenges/new']({ user: owner, body: { title: 'Three sessions', metric: 'sessions', start: '2026-08-27', end: '2026-09-02' } }, res);
  assert.equal(res.code, 200); const challengeId = res.body.challenge.id;
  await routes['POST /api/social/challenges/join']({ user: friend, body: { challengeId } }, {});
  await routes['POST /api/social/challenges/join']({ user: friend, body: { challengeId } }, {});
  res = {};
  await routes['GET /api/social/challenges']({ user: owner, url: '/api/social/challenges' }, res);
  assert.equal(res.body.challenges[0].participants.length, 2);
  assert.equal(res.body.challenges[0].participants.find(p => p.userId === 'owner').value, 1);
});

test('mandatory membership, post detail and photos stay authenticated and clean up with the post', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-social-photo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const owner = { id: 'owner', name: 'Owner' }, friend = { id: 'friend', name: 'Friend' };
  const members = [owner];
  const states = { owner: { workouts: [] }, friend: { workouts: [] } };
  const service = createSocialService({ dataDir: dir, users: () => members, readState: id => states[id], writeState: (id, next) => { states[id] = next; }, isAdmin: () => false, sendPush: () => {}, enabled: true, now: () => new Date('2026-08-27T09:00:00Z') });
  assert.equal(service.getData().profiles.owner.enabled, true);

  const json = (res, code, body) => Object.assign(res, { code, body });
  const routes = service.routes({ json, readBody: async req => req.body || {}, readRawBody: async req => req.raw, readSession: req => req.user || null, requireAdmin: () => null });
  members.push(friend);
  let res = {};
  await routes['GET /api/social/feed']({ user: friend, url: '/api/social/feed' }, res);
  assert.equal(res.code, 200);
  assert.equal(service.getData().profiles.friend.enabled, true);
  res = {};
  await routes['POST /api/social/photo']({ user: owner, raw: Buffer.from('not an image') }, res);
  assert.equal(res.code, 415);

  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  res = {};
  await routes['POST /api/social/photo']({ user: owner, raw: jpeg }, res);
  assert.equal(res.code, 200);
  const photoId = res.body.id;
  assert.equal(fs.existsSync(path.join(dir, 'social-photos', photoId)), true);

  states.owner.workouts = [tracked('w1', '2026-08-27')];
  states.owner.workouts[0].end = Date.parse('2026-08-27T10:00:00Z');
  states.owner.workouts[0].social = { ...states.owner.workouts[0].social, title: '<Push day>', desc: 'Strong & steady', photoId };
  await service.syncUserState(owner, states.owner);
  const snapshot = service.getData().posts['owner:w1'];
  assert.equal(snapshot.title, 'Push day');
  assert.equal(snapshot.desc, 'Strong & steady');
  assert.equal(snapshot.photoId, photoId);
  assert.equal(snapshot.entries[0].setCount, 1);

  res = {};
  await routes['GET /api/social/post']({ user: friend, url: '/api/social/post?id=owner%3Aw1' }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.id, 'owner:w1');
  assert.equal(res.body.commentCount, 0);

  const binaryRes = { writeHead(code, headers) { this.code = code; this.headers = headers; }, end(body) { this.body = body; } };
  await routes['GET /api/social/photo/:id']({ user: friend, url: `/api/social/photo/${photoId}` }, binaryRes);
  assert.equal(binaryRes.code, 200);
  assert.equal(binaryRes.headers['Content-Type'], 'image/jpeg');
  assert.deepEqual(binaryRes.body, jpeg);

  states.owner.workouts[0].social.publish = false;
  await service.syncUserState(owner, states.owner);
  assert.equal(fs.existsSync(path.join(dir, 'social-photos', photoId)), false);
  assert.equal(service.getData().photoOwners[photoId], undefined);
});
