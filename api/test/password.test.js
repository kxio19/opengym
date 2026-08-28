import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { hashLoginSecret, normalizeUsername, validateLoginSecret, verifyLoginSecret } from '../auth/password.js';

test('passwords and PINs are validated and verified with a salted scrypt hash', async () => {
  assert.equal(validateLoginSecret('123456'), '123456');
  assert.equal(validateLoginSecret('long password'), 'long password');
  assert.throws(() => validateLoginSecret('12345'), /6 to 12/);
  assert.throws(() => validateLoginSecret('short'), /8 to 128/);
  assert.equal(normalizeUsername('  KÁIO  '), 'káio');
  const encoded = await hashLoginSecret('123456', 'server-secret');
  assert.match(encoded, /^scrypt\$32768\$8\$1\$/);
  assert.equal(encoded.includes('123456'), false);
  assert.equal(await verifyLoginSecret('123456', encoded, 'server-secret'), true);
  assert.equal(await verifyLoginSecret('654321', encoded, 'server-secret'), false);
});

test('a profile can register and sign in without a passkey', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-password-test-'));
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
    users: [], creds: [], subs: [], invites: [{ code: 'INVITE-123', created: new Date().toISOString() }]
  }));
  const port = 35000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), RP_ID: 'localhost', ORIGIN: `http://localhost:${port}`, INVITE_ONLY: '1', COACH_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let childError = '';
  child.stderr.on('data', chunk => { childError += chunk.toString(); });
  const cleanup = () => { child.kill('SIGTERM'); fs.rmSync(dir, { recursive: true, force: true }); };
  after(cleanup);
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
    if (attempt === 49) throw new Error('test API did not start: ' + childError);
  }

  const withoutInvite = await fetch(base + '/api/password/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Kaio', secret: '123456' })
  });
  assert.equal(withoutInvite.status, 403);

  const register = await fetch(base + '/api/password/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Kaio', secret: '123456', code: 'invite-123' })
  });
  assert.equal(register.status, 200);
  const registered = await register.json();
  assert.equal(registered.user.name, 'Kaio');
  assert.equal(registered.user.hasPassword, true);
  assert.equal(registered.user.hasPasskey, false);

  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
  assert.equal(stored.users[0].passwordHash.includes('123456'), false);
  assert.equal(stored.creds.length, 0);
  assert.equal(stored.invites[0].usedBy, stored.users[0].id);

  const wrong = await fetch(base + '/api/password/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Kaio', secret: '654321' })
  });
  assert.equal(wrong.status, 401);

  const login = await fetch(base + '/api/password/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '  KAIO ', secret: '123456' })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const me = await fetch(base + '/api/me', { headers: { Cookie: cookie } });
  const meBody = await me.json();
  assert.equal(meBody.user.name, 'Kaio');
  assert.equal(meBody.user.hasPassword, true);

  const wrongChange = await fetch(base + '/api/password/change', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ currentSecret: '654321', newSecret: '987654' })
  });
  assert.equal(wrongChange.status, 401);

  const change = await fetch(base + '/api/password/change', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ currentSecret: '123456', newSecret: '987654' })
  });
  assert.equal(change.status, 200);

  const changedLogin = await fetch(base + '/api/password/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'kaio', secret: '987654' })
  });
  assert.equal(changedLogin.status, 200);

  const duplicate = await fetch(base + '/api/password/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'kaio', secret: 'another password' })
  });
  assert.equal(duplicate.status, 409);
});
