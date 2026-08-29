import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { hashLoginSecret } from '../auth/password.js';

async function boot(suggestions = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-suggestions-test-'));
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(path.join(dir, 'secret'), secret);
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
    users: [
      { id: 'admin_uid', name: 'Owner', passwordHash: await hashLoginSecret('admin-password-1', secret) },
      { id: 'friend_uid', name: 'Friend', passwordHash: await hashLoginSecret('friend-password-1', secret) }
    ],
    creds: [], subs: [], invites: [], suggestions
  }));
  const port = 36000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), RP_ID: 'localhost', ORIGIN: `http://localhost:${port}`, COACH_DISABLED: '1', ADMIN_UIDS: 'admin_uid' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let childError = '';
  child.stderr.on('data', chunk => { childError += chunk.toString(); });
  after(() => { child.kill('SIGTERM'); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
    if (attempt === 39) throw new Error('test API did not start: ' + childError);
  }
  const post = (url, body, cookie) => fetch(base + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body ?? {})
  });
  const signIn = async (name, password) => {
    const response = await post('/api/password/login', { name, secret: password });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  return {
    base, dir, post,
    adminCookie: await signIn('Owner', 'admin-password-1'),
    friendCookie: await signIn('Friend', 'friend-password-1')
  };
}

const api = await boot();

test('suggestions require a signed-in account and valid content', async () => {
  assert.equal((await api.post('/api/suggestions', { type: 'bug', text: 'It does not work' })).status, 401);
  assert.equal((await api.post('/api/suggestions', { type: 'other', text: 'It does not work' }, api.friendCookie)).status, 400);
  assert.equal((await api.post('/api/suggestions', { type: 'idea', text: ' <>' }, api.friendCookie)).status, 400);
});

test('a suggestion is sanitized, bounded, attributed, and persisted', async () => {
  const response = await api.post('/api/suggestions', { type: 'bug', text: `  <b>${'x'.repeat(1100)}</b>  ` }, api.friendCookie);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  const list = await fetch(api.base + '/api/admin/suggestions', { headers: { Cookie: api.adminCookie } });
  assert.equal(list.status, 200);
  const [suggestion] = (await list.json()).suggestions;
  assert.equal(suggestion.type, 'bug');
  assert.equal(suggestion.text.length, 1000);
  assert.equal(/[<>]/.test(suggestion.text), false);
  assert.equal(suggestion.userId, 'friend_uid');
  assert.equal(suggestion.userName, 'Friend');
  assert.ok(suggestion.created);
  assert.equal(suggestion.resolvedAt, null);

  const stored = JSON.parse(fs.readFileSync(path.join(api.dir, 'db.json'), 'utf8'));
  assert.equal(stored.suggestions[0].id, suggestion.id);
});

test('only an admin can read and resolve suggestions', async () => {
  const friendList = await fetch(api.base + '/api/admin/suggestions', { headers: { Cookie: api.friendCookie } });
  assert.equal(friendList.status, 403);
  assert.equal((await fetch(api.base + '/api/admin/suggestions')).status, 401);

  const before = await fetch(api.base + '/api/admin/suggestions', { headers: { Cookie: api.adminCookie } });
  const [suggestion] = (await before.json()).suggestions;
  assert.equal((await api.post('/api/admin/suggestions/resolve', { id: suggestion.id }, api.friendCookie)).status, 403);
  const resolved = await api.post('/api/admin/suggestions/resolve', { id: suggestion.id }, api.adminCookie);
  assert.equal(resolved.status, 200);
  const data = await resolved.json();
  assert.ok(data.suggestion.resolvedAt);
  assert.equal(data.suggestion.resolvedBy, 'admin_uid');
  assert.equal((await api.post('/api/admin/suggestions/resolve', { id: 'missing' }, api.adminCookie)).status, 404);
});

test('saving suggestions caps the mailbox and prunes the oldest resolved entries first', async () => {
  const makeSuggestion = (id, resolvedAt = null) => ({
    id, type: 'idea', text: id, userId: 'friend_uid', userName: 'Friend',
    created: '2026-01-01T00:00:00.000Z', resolvedAt, resolvedBy: resolvedAt ? 'admin_uid' : null
  });
  const seeded = [
    makeSuggestion('resolved-old-1', '2026-01-02T00:00:00.000Z'),
    makeSuggestion('pending-old'),
    makeSuggestion('resolved-old-2', '2026-01-03T00:00:00.000Z'),
    ...Array.from({ length: 498 }, (_, index) => makeSuggestion(`pending-${index}`))
  ];
  const cappedApi = await boot(seeded);
  const response = await cappedApi.post('/api/suggestions', { type: 'bug', text: 'Newest report' }, cappedApi.friendCookie);
  assert.equal(response.status, 200);

  const list = await fetch(cappedApi.base + '/api/admin/suggestions', { headers: { Cookie: cappedApi.adminCookie } });
  const suggestions = (await list.json()).suggestions;
  assert.equal(suggestions.length, 500);
  assert.equal(suggestions.some(item => item.id === 'resolved-old-1'), false);
  assert.equal(suggestions.some(item => item.id === 'resolved-old-2'), false);
  assert.equal(suggestions.some(item => item.id === 'pending-old'), true);
  assert.equal(suggestions.some(item => item.text === 'Newest report'), true);
});
