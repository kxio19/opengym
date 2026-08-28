import crypto from 'node:crypto';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function normalizeRecoveryCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashRecoveryCode(code, secret) {
  return crypto.createHmac('sha256', secret).update(normalizeRecoveryCode(code)).digest('hex');
}

export function createRecoveryCodes(count = 8) {
  return Array.from({ length: count }, () => {
    let raw = '';
    const bytes = crypto.randomBytes(12);
    for (let i = 0; i < 12; i++) raw += ALPHABET[bytes[i] % ALPHABET.length];
    return `OG-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  });
}

export function findRecoveryCode(users, code, secret) {
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length !== 14 || !normalized.startsWith('OG')) return null;
  const target = Buffer.from(hashRecoveryCode(normalized, secret), 'hex');
  for (const user of users) {
    const codes = Array.isArray(user.recoveryCodes) ? user.recoveryCodes : [];
    for (let index = 0; index < codes.length; index++) {
      const stored = Buffer.from(String(codes[index]?.hash || ''), 'hex');
      if (stored.length === target.length && crypto.timingSafeEqual(stored, target)) return { user, index };
    }
  }
  return null;
}
