import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hashLoginSecret } from '../auth/password.js';
import { hashRecoveryCode } from '../auth/recovery.js';

const apiDir = path.dirname(fileURLToPath(new URL('../server.js', import.meta.url)));
const serverFile = path.join(apiDir, 'server.js');
const secret = 'access-request-test-secret'.padEnd(64, '0');

const json = async response => ({ response, body: await response.json() });
const post = (base, route, body, cookie) => fetch(base + route, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify(body)
});
const cookieFor = user => {
  const payload = `${user.id}:${Date.now() + 86400000}:${user.sv || 0}`;
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `gymsid=${payload}.${mac}`;
};
const noSessionCookie = response => assert.equal(response.headers.get('set-cookie'), null);

async function startApi(t, { users = [], creds = [], invites = [], social = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-access-requests-'));
  fs.writeFileSync(path.join(dir, 'secret'), secret, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users, creds, subs: [], invites }));
  const port = 37000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [serverFile], {
    cwd: apiDir,
    env: {
      ...process.env,
      DATA_DIR: dir,
      PORT: String(port),
      RP_ID: 'localhost',
      ORIGIN: `http://localhost:${port}`,
      INVITE_ONLY: '1',
      SOCIAL_ENABLED: social ? '1' : '0',
      COACH_DISABLED: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let childError = '';
  child.stderr.on('data', chunk => { childError += chunk.toString(); });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 2000))]);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(base + '/api/health')).ok) return { base, dir }; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('test API did not start: ' + childError);
}

function passkey(userId) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x, 'base64url'), y = Buffer.from(jwk.y, 'base64url');
  const cosePublicKey = Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]), x,
    Buffer.from([0x22, 0x58, 0x20]), y
  ]);
  const id = crypto.randomBytes(16).toString('base64url');
  return {
    privateKey,
    stored: { id, userId, publicKey: cosePublicKey.toString('base64url'), counter: 0, transports: ['internal'] }
  };
}

async function passkeyLogin(base, key) {
  const options = await json(await post(base, '/api/login/options', {}));
  assert.equal(options.response.status, 200);
  const clientDataJSON = Buffer.from(JSON.stringify({
    type: 'webauthn.get',
    challenge: options.body.options.challenge,
    origin: new URL(base).origin.replace('127.0.0.1', 'localhost'),
    crossOrigin: false
  }));
  const authenticatorData = Buffer.alloc(37);
  crypto.createHash('sha256').update('localhost').digest().copy(authenticatorData);
  authenticatorData[32] = 0x05;
  authenticatorData.writeUInt32BE(1, 33);
  const clientHash = crypto.createHash('sha256').update(clientDataJSON).digest();
  const signature = crypto.sign('sha256', Buffer.concat([authenticatorData, clientHash]), key.privateKey);
  return post(base, '/api/login/verify', {
    cid: options.body.cid,
    credential: {
      id: key.stored.id,
      rawId: key.stored.id,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: clientDataJSON.toString('base64url'),
        authenticatorData: authenticatorData.toString('base64url'),
        signature: signature.toString('base64url'),
        userHandle: Buffer.from(key.stored.userId).toString('base64url')
      }
    }
  });
}

async function requestAccess(base, name, loginSecret = '123456') {
  return json(await post(base, '/api/password/register', {
    name, secret: loginSecret, requestAccess: true, termsAccepted: true
  }));
}

test('pending accounts get no session from password, passkey or recovery login and remain distinct from disabled accounts', async t => {
  const pendingPasskey = passkey('pending'), disabledPasskey = passkey('disabled');
  const pendingCode = 'OG-2345-6789-ABCD', disabledCode = 'OG-BCDE-FGHJ-KMNP';
  const users = [
    {
      id: 'pending', name: 'Pending', pending: true, created: new Date().toISOString(),
      passwordHash: await hashLoginSecret('123456', secret),
      recoveryCodes: [{ hash: hashRecoveryCode(pendingCode, secret) }]
    },
    {
      id: 'disabled', name: 'Disabled', disabled: true, created: new Date().toISOString(),
      passwordHash: await hashLoginSecret('123456', secret),
      recoveryCodes: [{ hash: hashRecoveryCode(disabledCode, secret) }]
    }
  ];
  const { base } = await startApi(t, { users, creds: [pendingPasskey.stored, disabledPasskey.stored], social: false });

  const pendingPassword = await json(await post(base, '/api/password/login', { name: 'Pending', secret: '123456' }));
  const disabledPassword = await json(await post(base, '/api/password/login', { name: 'Disabled', secret: '123456' }));
  assert.equal(pendingPassword.response.status, 403);
  assert.match(pendingPassword.body.error, /pending approval/i);
  assert.equal(disabledPassword.response.status, 401);
  assert.doesNotMatch(disabledPassword.body.error, /pending approval/i);
  noSessionCookie(pendingPassword.response); noSessionCookie(disabledPassword.response);

  const pendingWebAuthn = await json(await passkeyLogin(base, pendingPasskey));
  const disabledWebAuthn = await json(await passkeyLogin(base, disabledPasskey));
  assert.equal(pendingWebAuthn.response.status, 403, JSON.stringify(pendingWebAuthn.body));
  assert.match(pendingWebAuthn.body.error, /pending approval/i);
  assert.equal(disabledWebAuthn.response.status, 403, JSON.stringify(disabledWebAuthn.body));
  assert.match(disabledWebAuthn.body.error, /disabled/i);
  assert.doesNotMatch(disabledWebAuthn.body.error, /pending approval/i);
  noSessionCookie(pendingWebAuthn.response); noSessionCookie(disabledWebAuthn.response);

  const pendingRecovery = await json(await post(base, '/api/recovery/login', { code: pendingCode }));
  const disabledRecovery = await json(await post(base, '/api/recovery/login', { code: disabledCode }));
  assert.equal(pendingRecovery.response.status, 403);
  assert.match(pendingRecovery.body.error, /pending approval/i);
  assert.equal(disabledRecovery.response.status, 401);
  assert.doesNotMatch(disabledRecovery.body.error, /pending approval/i);
  noSessionCookie(pendingRecovery.response); noSessionCookie(disabledRecovery.response);
});

test('readSession rejects an otherwise valid session belonging to a pending account', async t => {
  const pending = { id: 'pending-session', name: 'Pending Session', pending: true, created: new Date().toISOString() };
  const { base } = await startApi(t, { users: [pending], social: false });
  const me = await json(await fetch(base + '/api/me', { headers: { Cookie: cookieFor(pending) } }));
  assert.equal(me.response.status, 401);
  assert.deepEqual(me.body, { error: 'not signed in' });
});

test('admin approval clears pending, enrolls the social profile and allows normal login', async t => {
  const admin = { id: 'admin', name: 'Admin', admin: true, created: new Date().toISOString() };
  const { base, dir } = await startApi(t, { users: [admin] });
  const registration = await requestAccess(base, 'Awaiting Approval');
  assert.equal(registration.response.status, 200);
  assert.deepEqual(registration.body, { pending: true });
  const pending = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8')).users.find(u => u.name === 'Awaiting Approval');

  const approval = await json(await post(base, '/api/admin/user/approve', { id: pending.id }, cookieFor(admin)));
  assert.equal(approval.response.status, 200);
  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8')).users.find(u => u.id === pending.id);
  assert.equal(stored.pending, undefined);
  const social = JSON.parse(fs.readFileSync(path.join(dir, 'social.json'), 'utf8'));
  assert.equal(social.profiles[pending.id].userId, pending.id);
  assert.equal(social.profiles[pending.id].enabled, true);

  const login = await json(await post(base, '/api/password/login', { name: 'Awaiting Approval', secret: '123456' }));
  assert.equal(login.response.status, 200);
  assert.match(login.response.headers.get('set-cookie'), /^gymsid=/);
});

test('admin rejection deletes the pending record and frees its username for another signup', async t => {
  const admin = { id: 'admin', name: 'Admin', admin: true, created: new Date().toISOString() };
  const { base, dir } = await startApi(t, { users: [admin] });
  const first = await requestAccess(base, 'Reusable Name');
  assert.equal(first.response.status, 200);
  const rejected = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8')).users.find(u => u.name === 'Reusable Name');

  const rejection = await json(await post(base, '/api/admin/user/reject', { id: rejected.id }, cookieFor(admin)));
  assert.equal(rejection.response.status, 200);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8')).users.some(u => u.id === rejected.id), false);
  const second = await requestAccess(base, 'Reusable Name', '654321');
  assert.equal(second.response.status, 200);
  assert.deepEqual(second.body, { pending: true });
});

test('a valid invite still creates an immediately usable account outside the pending queue', async t => {
  const invite = { code: 'INVITE-NOW', created: new Date().toISOString() };
  const { base, dir } = await startApi(t, { invites: [invite] });
  const registration = await json(await post(base, '/api/password/register', {
    name: 'Invited Member', secret: '123456', code: 'invite-now', termsAccepted: true
  }));
  assert.equal(registration.response.status, 200);
  assert.equal(registration.body.user.name, 'Invited Member');
  assert.match(registration.response.headers.get('set-cookie'), /^gymsid=/);
  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8')).users.find(u => u.name === 'Invited Member');
  assert.equal(stored.pending, undefined);
  assert.equal(stored.invitedBy, 'INVITE-NOW');

  const login = await json(await post(base, '/api/password/login', { name: 'Invited Member', secret: '123456' }));
  assert.equal(login.response.status, 200);
  assert.match(login.response.headers.get('set-cookie'), /^gymsid=/);
});

test('pending users do not appear in Social membership or increase its member count', async t => {
  const admin = { id: 'admin', name: 'Admin', admin: true, created: new Date().toISOString() };
  const pending = { id: 'pending-member', name: 'Pending Member', pending: true, created: new Date().toISOString() };
  const { base } = await startApi(t, { users: [admin, pending] });
  const social = await json(await fetch(base + '/api/admin/social', { headers: { Cookie: cookieFor(admin) } }));
  assert.equal(social.response.status, 200);
  assert.equal(social.body.profiles.length, 1);
  assert.deepEqual(social.body.profiles.map(profile => profile.userId), [admin.id]);
  assert.equal(social.body.profiles.some(profile => profile.userId === pending.id), false);
});
