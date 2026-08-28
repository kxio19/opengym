import crypto from 'node:crypto';

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const MAX_MEM = 64 * 1024 * 1024;

export function normalizeUsername(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en-US');
}

export function validateLoginSecret(value) {
  const secret = String(value || '');
  if (/^\d+$/.test(secret)) {
    if (secret.length < 6 || secret.length > 12) throw new Error('PIN must contain 6 to 12 digits');
    return secret;
  }
  if (secret.length < 8 || secret.length > 128) throw new Error('password must contain 8 to 128 characters');
  return secret;
}

function pepper(secret, serverSecret) {
  return crypto.createHmac('sha256', serverSecret).update(secret, 'utf8').digest();
}

function scrypt(input, salt, options) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(input, salt, KEY_LENGTH, options, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashLoginSecret(value, serverSecret) {
  const secret = validateLoginSecret(value);
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pepper(secret, serverSecret), salt, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: MAX_MEM });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyLoginSecret(value, encoded, serverSecret) {
  const parts = String(encoded || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || N < 16384 || N > 131072 || r < 1 || r > 16 || p < 1 || p > 4) return false;
  let salt, expected;
  try { salt = Buffer.from(parts[4], 'base64url'); expected = Buffer.from(parts[5], 'base64url'); }
  catch { return false; }
  if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
  let actual;
  try { actual = await scrypt(pepper(String(value || ''), serverSecret), salt, { N, r, p, maxmem: MAX_MEM }); }
  catch { return false; }
  return crypto.timingSafeEqual(actual, expected);
}
