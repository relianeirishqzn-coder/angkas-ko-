// src/auth.js
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// ---- Password hashing (scrypt, built into Node's crypto module) ----
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const attempt = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(attempt, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ---- Signed session tokens (HMAC-SHA256, similar shape to a minimal JWT) ----
//
// The secret used to sign session tokens comes from one of two places:
//
//   1. process.env.SESSION_SECRET — set this in production (see .env.example).
//      Recommended: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
//   2. An auto-generated secret persisted to data/.session-secret — convenient
//      for local development, but that file MUST be included in your backups.
//      If it's lost (e.g. a restore from an old backup, or a fresh deploy that
//      regenerates it), every existing session is silently invalidated and
//      everyone gets logged out. It is NOT sensitive in the way a database
//      backup is, but treat it as a secret nonetheless (never commit it).
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const SECRET_PATH = path.join(DATA_DIR, '.session-secret');

let SECRET;
let secretSource;
const envSecret = (process.env.SESSION_SECRET || '').trim();

if (envSecret) {
  if (envSecret.length < 32) {
    console.warn(
      '⚠️  SESSION_SECRET is set but shorter than 32 characters — this weakens session ' +
      'signing. Generate a strong one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  SECRET = envSecret;
  secretSource = 'environment variable';
} else if (fs.existsSync(SECRET_PATH)) {
  SECRET = fs.readFileSync(SECRET_PATH, 'utf8').trim();
  secretSource = 'existing data/.session-secret file';
} else {
  SECRET = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_PATH, SECRET, { mode: 0o600 });
  secretSource = 'newly generated data/.session-secret file';
}

if (secretSource !== 'environment variable') {
  console.warn(
    `⚠️  No SESSION_SECRET set — using ${secretSource}.\n` +
    '   This file MUST be included in your backups, or restoring the database ' +
    'from an older backup without it will invalidate every session (forces everyone to log in again).\n' +
    '   For production, set SESSION_SECRET explicitly — see .env.example.'
  );
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signSession(payload) {
  const body = base64url(JSON.stringify({ ...payload, iat: Date.now() }));
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifySession(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    // sessions expire after 7 days
    if (Date.now() - payload.iat > 7 * 24 * 60 * 60 * 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = { hashPassword, verifyPassword, signSession, verifySession };
