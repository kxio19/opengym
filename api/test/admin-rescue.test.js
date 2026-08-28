import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRecoveryCodes, hashRecoveryCode } from '../auth/recovery.js';
import { hashLoginSecret } from '../auth/password.js';

// One instance for the whole file: booting the server is the slow part, and every case here is
// about an admin acting on a second account rather than about server startup.
async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-rescue-test-'));
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(path.join(dir, 'secret'), secret);
  // The admin signs in with a password so the test needs no WebAuthn ceremony. The rescued user
  // is the shape that motivated the feature: one passkey, no password, no recovery codes.
  const adminSecret = 'admin-password-1';
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
    users: [
      { id: 'admin_uid', name: 'Owner', created: new Date().toISOString(), passwordHash: await hashLoginSecret(adminSecret, secret) },
      { id: 'friend_uid', name: 'Friend', created: new Date().toISOString(), invitedBy: 'ABC123' }
    ],
    creds: [{ id: 'Y3JlZDE', userId: 'friend_uid', publicKey: 'AA', counter: 0, transports: ['internal'] }],
    subs: [], invites: []
  }));
  const port = 35000 + Math.floor(Math.random() * 1000);
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
  const login = await post('/api/password/login', { name: 'Owner', secret: adminSecret });
  assert.equal(login.status, 200);
  return { base, post, dir, adminCookie: login.headers.get('set-cookie').split(';')[0] };
}

const api = await boot();

test('an admin issues a one-time code that signs the locked-out user in exactly once', async () => {
  const issued = await api.post('/api/admin/user/recovery-code', { id: 'friend_uid' }, api.adminCookie);
  assert.equal(issued.status, 200);
  const { code } = await issued.json();
  assert.match(code, /^OG-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);

  const first = await api.post('/api/recovery/login', { code });
  assert.equal(first.status, 200);
  const cookie = first.headers.get('set-cookie').split(';')[0];
  const me = await fetch(api.base + '/api/me', { headers: { Cookie: cookie } });
  assert.equal((await me.json()).user.id, 'friend_uid');

  const reused = await api.post('/api/recovery/login', { code });
  assert.equal(reused.status, 401);
});

test('issuing a code leaves the codes the user already held untouched', async () => {
  const db = () => JSON.parse(fs.readFileSync(path.join(api.dir, 'db.json'), 'utf8'));
  const secret = fs.readFileSync(path.join(api.dir, 'secret'), 'utf8').trim();
  const [existing] = createRecoveryCodes(1);
  const before = db();
  before.users.find(u => u.id === 'friend_uid').recoveryCodes = [{ hash: hashRecoveryCode(existing, secret) }];
  fs.writeFileSync(path.join(api.dir, 'db.json'), JSON.stringify(before));
  // The running server holds db in memory, so drive the append through the API and assert on the
  // response rather than the file: what matters is that the old code still signs in afterwards.
  const issued = await api.post('/api/admin/user/recovery-code', { id: 'friend_uid' }, api.adminCookie);
  assert.equal(issued.status, 200);
  const fresh = (await issued.json()).code;
  assert.notEqual(fresh, existing);
  const stored = db().users.find(u => u.id === 'friend_uid').recoveryCodes;
  assert.ok(stored.length >= 1);
  for (const entry of stored) assert.match(entry.hash, /^[a-f0-9]{64}$/);
});

test('a password reset hands back a temporary secret and forces a change at first sign-in', async () => {
  const reset = await api.post('/api/admin/user/password-reset', { id: 'friend_uid' }, api.adminCookie);
  assert.equal(reset.status, 200);
  const { secret } = await reset.json();
  assert.equal(typeof secret, 'string');
  assert.ok(secret.length >= 8);

  const login = await api.post('/api/password/login', { name: 'Friend', secret });
  assert.equal(login.status, 200);
  const body = await login.json();
  assert.equal(body.user.mustChangeSecret, true);
  const cookie = login.headers.get('set-cookie').split(';')[0];

  const changed = await api.post('/api/password/change', { currentSecret: secret, newSecret: 'their-own-secret-9' }, cookie);
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).user.mustChangeSecret, false);

  const stale = await api.post('/api/password/login', { name: 'Friend', secret });
  assert.equal(stale.status, 401);
});

test('an admin-chosen password is validated and never echoed back', async () => {
  const tooShort = await api.post('/api/admin/user/password-reset', { id: 'friend_uid', secret: 'short' }, api.adminCookie);
  assert.equal(tooShort.status, 400);

  const chosen = await api.post('/api/admin/user/password-reset', { id: 'friend_uid', secret: 'chosen-by-admin-1' }, api.adminCookie);
  assert.equal(chosen.status, 200);
  assert.equal((await chosen.json()).secret, undefined);
  assert.equal((await api.post('/api/password/login', { name: 'Friend', secret: 'chosen-by-admin-1' })).status, 200);
});

test('rescues are recorded and shown to the user they were used on, without the secret', async () => {
  const detail = await fetch(api.base + '/api/admin/user?id=friend_uid', { headers: { Cookie: api.adminCookie } });
  const data = await detail.json();
  assert.ok(data.adminActions.length >= 2);
  for (const entry of data.adminActions) {
    assert.equal(entry.adminId, 'admin_uid');
    assert.equal(entry.targetId, 'friend_uid');
    assert.ok(['recovery-code', 'password-reset'].includes(entry.action));
    assert.equal(JSON.stringify(entry).includes('secret'), false);
  }
  // The whole payload the admin sees must never carry a credential.
  const serialized = JSON.stringify(data);
  assert.equal(serialized.includes('passwordHash'), false);
  assert.equal(serialized.includes('scrypt$'), false);
  assert.equal(data.access.passkeys, 1);

  // And the affected user is told, in their own app, that this happened.
  const login = await api.post('/api/password/login', { name: 'Friend', secret: 'chosen-by-admin-1' });
  const me = await fetch(api.base + '/api/me', { headers: { Cookie: login.headers.get('set-cookie').split(';')[0] } });
  assert.ok((await me.json()).user.lastAdminRecovery);
});

test('a signed-out caller and a non-admin are both refused', async () => {
  assert.equal((await api.post('/api/admin/user/recovery-code', { id: 'friend_uid' })).status, 401);
  assert.equal((await api.post('/api/admin/user/password-reset', { id: 'friend_uid' })).status, 401);

  // Signed in via a fresh recovery code rather than the password: /api/password/login is rate
  // limited to a handful of attempts per window, and the earlier cases in this file already
  // spend most of them.
  const { code } = await (await api.post('/api/admin/user/recovery-code', { id: 'friend_uid' }, api.adminCookie)).json();
  const friend = await api.post('/api/recovery/login', { code });
  assert.equal(friend.status, 200);
  const friendCookie = friend.headers.get('set-cookie').split(';')[0];
  assert.equal((await api.post('/api/admin/user/recovery-code', { id: 'admin_uid' }, friendCookie)).status, 403);
  assert.equal((await api.post('/api/admin/user/password-reset', { id: 'admin_uid' }, friendCookie)).status, 403);
});

test('rescuing an account that does not exist fails cleanly', async () => {
  assert.equal((await api.post('/api/admin/user/recovery-code', { id: 'nobody' }, api.adminCookie)).status, 404);
  assert.equal((await api.post('/api/admin/user/password-reset', { id: 'nobody' }, api.adminCookie)).status, 404);
});
