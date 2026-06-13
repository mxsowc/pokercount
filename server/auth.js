// Sessions (signed cookies) and Google ID-token verification — no dependencies.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, randomBytes, createPublicKey, verify as cryptoVerify, timingSafeEqual } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const SECRET_FILE = join(DATA_DIR, '.session-secret');
const COOKIE = 'pc_session';
const MAX_AGE = 60 * 60 * 24 * 365; // 1 year

let SECRET = '';
export function initAuth() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(SECRET_FILE)) SECRET = readFileSync(SECRET_FILE, 'utf8').trim();
  if (!SECRET) { SECRET = randomBytes(32).toString('hex'); writeFileSync(SECRET_FILE, SECRET, { mode: 0o600 }); }
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64url = (s) => Buffer.from(s, 'base64url');
const hmac = (body) => createHmac('sha256', SECRET).update(body).digest('base64url');

function sign(uid) {
  const body = b64url(JSON.stringify({ uid, iat: Date.now() }));
  return body + '.' + hmac(body);
}
function read(token) {
  if (!token) return null;
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const body = token.slice(0, i);
  const expected = Buffer.from(hmac(body));
  const provided = Buffer.from(token.slice(i + 1));
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
  try {
    const { uid, iat } = JSON.parse(fromB64url(body).toString());
    // Absolute expiry: a valid signature isn't enough — reject stale tokens so a
    // captured cookie doesn't live forever (the signed iat is now actually checked).
    if (!iat || Date.now() - iat > MAX_AGE * 1000) return null;
    return uid;
  } catch { return null; }
}

export function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

/** User id from the request's session cookie, or null. */
export function sessionUid(req) {
  return read(parseCookies(req)[COOKIE]);
}

// Decide whether to mark the session cookie `Secure` (HTTPS-only). We force it on
// when COOKIE_SECURE=1, force it off when COOKIE_SECURE=0, and otherwise
// auto-detect: a reverse proxy terminating TLS (Caddy, nginx, …) forwards the
// original scheme in X-Forwarded-Proto. So HTTPS deployments get Secure cookies
// even if the env var was never set, while plain-HTTP localhost dev still works.
function secureFor(req) {
  if (process.env.COOKIE_SECURE === '1') return true;
  if (process.env.COOKIE_SECURE === '0') return false;
  const proto = req && req.headers['x-forwarded-proto'];
  return String(proto || '').split(',')[0].trim().toLowerCase() === 'https';
}

export function sessionCookie(uid, req) {
  const secure = secureFor(req) ? '; Secure' : '';
  return `${COOKIE}=${sign(uid)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${MAX_AGE}${secure}`;
}
export function clearCookie(req) {
  const secure = secureFor(req) ? '; Secure' : '';
  return `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`;
}

// ---- Google ID token verification -------------------------------------------
let jwks = { keys: [], at: 0 };
async function googleKeys() {
  if (jwks.keys.length && Date.now() - jwks.at < 3600e3) return jwks.keys;
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  const json = await res.json();
  jwks = { keys: json.keys || [], at: Date.now() };
  return jwks.keys;
}

/** Verify a Google Identity Services credential (JWT). Returns the payload. */
export async function verifyGoogleIdToken(credential, clientId) {
  const parts = String(credential || '').split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [h, p, s] = parts;
  const header = JSON.parse(fromB64url(h).toString());
  const jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown signing key');
  const pub = createPublicKey({ key: jwk, format: 'jwk' });
  const ok = cryptoVerify('RS256', Buffer.from(`${h}.${p}`), pub, fromB64url(s));
  if (!ok) throw new Error('bad signature');
  const payload = JSON.parse(fromB64url(p).toString());
  if (payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com') throw new Error('bad issuer');
  if (clientId && payload.aud !== clientId) throw new Error('token not for this app');
  if (payload.exp * 1000 < Date.now()) throw new Error('token expired');
  return payload; // { sub, name, email, picture, ... }
}
