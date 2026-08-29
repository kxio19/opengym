import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { hashLoginSecret } from '../auth/password.js';

// A one-pixel JPEG and PNG. The server sniffs magic bytes rather than trusting Content-Type,
// so the tests have to send something that really is an image.
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQECAgMCAgICAgQDAwIDBQQFBQUEBAQFBgcGBQUHBgQEBgkGBwgICAgIBQYJCgkICgcICAj/2wBDAQEBAQICAgQCAgQIBQQFCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAj/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD+/iiiigD/2Q==',
  'base64'
);
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-exercise-photos-test-'));
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(path.join(dir, 'secret'), secret);
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
    users: [
      { id: 'mine_uid', name: 'Mine', passwordHash: await hashLoginSecret('mine-password-1', secret) },
      { id: 'other_uid', name: 'Other', passwordHash: await hashLoginSecret('other-password-1', secret) }
    ],
    creds: [], subs: [], invites: []
  }));
  // Its own port band, like every other API test file: node --test runs the files in parallel,
  // and probing for a free port and then handing the number to a child is a race.
  const port = 38000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    // SOCIAL_DISABLED proves the point of the whole feature: an exercise photo is personal and
    // has to keep working when the group side of the app is switched off entirely.
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), RP_ID: 'localhost', ORIGIN: `http://localhost:${port}`, COACH_DISABLED: '1', SOCIAL_DISABLED: '1' },
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
  const signIn = async (name, password) => {
    const response = await fetch(base + '/api/password/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, secret: password })
    });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  const upload = (bytes, cookie, type = 'image/jpeg') => fetch(base + '/api/exercise-photo', {
    method: 'POST', headers: { 'Content-Type': type, ...(cookie ? { Cookie: cookie } : {}) }, body: bytes
  });
  const read = (id, cookie) => fetch(`${base}/api/exercise-photo/${encodeURIComponent(id)}`,
    { headers: cookie ? { Cookie: cookie } : {} });
  const remove = (id, cookie) => fetch(`${base}/api/exercise-photo/${encodeURIComponent(id)}`,
    { method: 'DELETE', headers: cookie ? { Cookie: cookie } : {} });
  const photosDir = path.join(dir, 'exercise-photos');
  return {
    upload, read, remove, photosDir,
    mine: await signIn('Mine', 'mine-password-1'),
    other: await signIn('Other', 'other-password-1')
  };
}

const api = await boot();

test('uploading works with Social switched off, and only for a signed-in account', async () => {
  assert.equal((await api.upload(JPEG, null)).status, 401);
  const response = await api.upload(JPEG, api.mine);
  assert.equal(response.status, 200);
  const { id } = await response.json();
  assert.match(id, /^[a-f0-9-]{20,40}\.jpg$/);
  assert.equal(fs.existsSync(path.join(api.photosDir, id)), true);
});

test('only images are accepted — the bytes are checked, not the declared type', async () => {
  const lying = await api.upload(Buffer.from('<?php echo "hi"; ?>'), api.mine, 'image/png');
  assert.equal(lying.status, 415);
  assert.equal((await api.upload(PNG, api.mine, 'image/png')).status, 200);
});

test('nobody can read someone else\'s photo, and a missing one is indistinguishable', async () => {
  const { id } = await (await api.upload(JPEG, api.mine)).json();
  assert.equal((await api.read(id, api.mine)).status, 200);
  // 404 rather than 403 on purpose: a 403 would confirm the id exists.
  assert.equal((await api.read(id, api.other)).status, 404);
  assert.equal((await api.read(id, null)).status, 401);
  assert.equal((await api.read('11111111-1111-1111-1111-111111111111.jpg', api.mine)).status, 404);
});

test('an id that walks out of the directory never reaches the filesystem', async () => {
  for (const evil of ['../../secret', '..%2f..%2fsecret', 'db.json', '../db.json']) {
    assert.equal((await api.read(evil, api.mine)).status, 404);
  }
  // The file it was reaching for is still there, i.e. nothing leaked and nothing was touched.
  assert.equal(fs.existsSync(path.join(api.photosDir, '..', 'secret')), true);
});

test('deleting removes the file, and only its owner can do it', async () => {
  const { id } = await (await api.upload(JPEG, api.mine)).json();
  const file = path.join(api.photosDir, id);
  assert.equal((await api.remove(id, api.other)).status, 404);
  assert.equal(fs.existsSync(file), true, 'another account must not be able to delete it');
  assert.equal((await api.remove(id, api.mine)).status, 200);
  assert.equal(fs.existsSync(file), false);
  // Once gone it is gone for its owner too, not just unlinked from disk.
  assert.equal((await api.read(id, api.mine)).status, 404);
});
