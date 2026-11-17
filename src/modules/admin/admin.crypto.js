/**
 * Crypto helpers for the back-office. Node's crypto only, no extra dependency.
 *
 * - Passwords: scrypt with a per-password salt, compared in constant time.
 * - Two-factor: TOTP (RFC 6238, SHA-1, 30 s, 6 digits) — what Google
 *   Authenticator, Authy, 1Password… implement.
 * - TOTP secrets are stored encrypted with AES-256-GCM.
 * - Session tokens: 32 random bytes; only their SHA-256 is stored.
 * - User references: a short HMAC of an app user's id, so moderators can tell
 *   "same account" apart without ever handling the real id.
 */
const crypto = require('crypto');
const env = require('../../config/env');

// ── Passwords ────────────────────────────────────────────────────────────────
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

const hashPassword = (password) =>
  new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, (err, key) => {
      if (err) return reject(err);
      return resolve(`scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`);
    });
  });

// Used when the email is unknown, so a wrong email costs the same time as a
// wrong password (no account enumeration by timing).
const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

const verifyPassword = (password, stored) =>
  new Promise((resolve) => {
    const parts = String(stored || DUMMY_HASH).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return resolve(false);
    const [, N, r, p, saltB64, keyB64] = parts;
    const expected = Buffer.from(keyB64, 'base64');
    crypto.scrypt(
      String(password || ''),
      Buffer.from(saltB64, 'base64'),
      expected.length,
      { N: Number(N), r: Number(r), p: Number(p) },
      (err, key) => {
        if (err || key.length !== expected.length) return resolve(false);
        return resolve(crypto.timingSafeEqual(key, expected));
      },
    );
  });

const PASSWORD_MIN_LENGTH = 12;

/** Readable temporary password: 4 groups of 4, no ambiguous characters. */
const generateTemporaryPassword = () => {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const chars = Array.from(crypto.randomBytes(16), (b) => alphabet[b % alphabet.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
};

// ── Base32 (RFC 4648) for TOTP secrets ──────────────────────────────────────
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const base32Encode = (buf) => {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
};

const base32Decode = (str) => {
  const clean = String(str).toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};

// ── TOTP ────────────────────────────────────────────────────────────────────
const TOTP_PERIOD = 30;

const generateTotpSecret = () => base32Encode(crypto.randomBytes(20));

const hotp = (secretBuf, counter) => {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', secretBuf).update(msg).digest();
  const offset = h[h.length - 1] & 0xf;
  const code = (h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
};

const totpStep = (nowMs = Date.now()) => Math.floor(nowMs / 1000 / TOTP_PERIOD);

/**
 * Returns the matching time step (to refuse replays) or null.
 * Accepts the previous and next step to absorb clock drift.
 */
const verifyTotp = (secretB32, code, { nowMs = Date.now(), lastStep = null } = {}) => {
  const normalized = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return null;
  const secret = base32Decode(secretB32);
  const current = totpStep(nowMs);
  for (const step of [current - 1, current, current + 1]) {
    if (lastStep != null && step <= Number(lastStep)) continue;
    const candidate = hotp(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(normalized))) return step;
  }
  return null;
};

const otpauthUri = (secretB32, email) =>
  `otpauth://totp/${encodeURIComponent(`MystMe Admin:${email}`)}?secret=${secretB32}&issuer=${encodeURIComponent('MystMe Admin')}&algorithm=SHA1&digits=6&period=${TOTP_PERIOD}`;

// ── Encryption of TOTP secrets at rest ──────────────────────────────────────
const encryptionKey = () =>
  crypto.hkdfSync(
    'sha256',
    Buffer.from(process.env.ADMIN_SECRET_KEY || env.jwtSecret),
    Buffer.from('mystme-admin'),
    Buffer.from('totp-secret-encryption'),
    32,
  );

const encryptSecret = (plain) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(encryptionKey()), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
};

const decryptSecret = (payload) => {
  const [v, ivB64, tagB64, encB64] = String(payload).split('.');
  if (v !== 'v1') throw new Error('Unknown secret format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(encryptionKey()), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()]).toString('utf8');
};

// ── Session tokens ──────────────────────────────────────────────────────────
const generateSessionToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

// ── Opaque user references ──────────────────────────────────────────────────
const userRef = (userId) =>
  userId
    ? crypto.createHmac('sha256', env.jwtSecret).update(`admin-user-ref:${userId}`).digest('hex').slice(0, 10)
    : null;

module.exports = {
  hashPassword,
  verifyPassword,
  PASSWORD_MIN_LENGTH,
  generateTemporaryPassword,
  base32Encode,
  base32Decode,
  generateTotpSecret,
  hotp,
  totpStep,
  verifyTotp,
  otpauthUri,
  encryptSecret,
  decryptSecret,
  generateSessionToken,
  hashToken,
  userRef,
};
