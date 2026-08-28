import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRecoveryCodes, findRecoveryCode, hashRecoveryCode, normalizeRecoveryCode } from '../auth/recovery.js';

test('recovery codes are high-entropy, normalized and stored only as hashes', () => {
  const codes = createRecoveryCodes();
  assert.equal(codes.length, 8);
  assert.equal(new Set(codes).size, 8);
  for (const code of codes) assert.match(code, /^OG-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
  assert.equal(normalizeRecoveryCode(codes[0].toLowerCase()), codes[0].replaceAll('-', ''));
  const hash = hashRecoveryCode(codes[0], 'secret');
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash.includes(normalizeRecoveryCode(codes[0])), false);
});

test('recovery lookup is exact and points to a single consumable code', () => {
  const secret = 'a'.repeat(64), [code] = createRecoveryCodes(1);
  const users = [{ id: 'u1', recoveryCodes: [{ hash: hashRecoveryCode(code, secret) }] }];
  assert.deepEqual(findRecoveryCode(users, code.toLowerCase(), secret), { user: users[0], index: 0 });
  assert.equal(findRecoveryCode(users, code.slice(0, -1) + '2', secret), null);
  users[0].recoveryCodes.splice(0, 1);
  assert.equal(findRecoveryCode(users, code, secret), null);
});

test('a recovery code signs in once and the recovered session can add another passkey', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-auth-test-'));
  const secret = crypto.randomBytes(32).toString('hex');
  const [code] = createRecoveryCodes(1);
  fs.writeFileSync(path.join(dir, 'secret'), secret);
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
    users: [{ id: 'owner_uid', name: 'Owner', created: new Date().toISOString(), recoveryCodes: [{ hash: hashRecoveryCode(code, secret) }] }],
    creds: [{ id: 'Y3JlZDE', userId: 'owner_uid', publicKey: 'AA', counter: 0, transports: ['internal'] }],
    subs: [], invites: []
  }));
  const port = 34000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), RP_ID: 'localhost', ORIGIN: `http://localhost:${port}`, COACH_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let childError = '';
  child.stderr.on('data', chunk => { childError += chunk.toString(); });
  const cleanup = () => { child.kill('SIGTERM'); fs.rmSync(dir, { recursive: true, force: true }); };
  after(cleanup);
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
    if (attempt === 39) throw new Error('test API did not start: ' + childError);
  }

  const login = await fetch(base + '/api/recovery/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const me = await fetch(base + '/api/me', { headers: { Cookie: cookie } });
  assert.equal((await me.json()).user.id, 'owner_uid');

  const options = await fetch(base + '/api/passkeys/options', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ label: 'Mobile' }) });
  assert.equal(options.status, 200);
  const payload = await options.json();
  assert.equal(Buffer.from(payload.options.user.id, 'base64url').toString(), 'owner_uid');
  assert.equal(payload.options.excludeCredentials[0].id, 'Y3JlZDE');

  const reused = await fetch(base + '/api/recovery/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
  assert.equal(reused.status, 401);
});
