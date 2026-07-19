// Sessions (signed cookies) and Google ID-token verification — no dependencies.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHmac, randomBytes, createPublicKey, verify as cryptoVerify, timingSafeEqual } from 'node:crypto';

import { DATA_DIR } from "./paths.js";
import { join } from "node:path";
const SECRET_FILE = join(DATA_DIR, '.session-secret');
const COOKIE = 'pc_session';
const MAX_AGE = 60 * 60 * 24 * 365; // 1 year

let SECRET = '';
export function initAuth() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(SECRET_FILE)) SECRET = readFileSync(SECRET_FILE, 'utf8').trim();
  if (!SECRET) { SECRET = randomBytes(32).toString('hex'); writeFileSync(SECRET_FILE, SECRET, { mode: 0o600 }); }
}

/** @param {string} buf */
const b64url = (buf) => Buffer.from(buf).toString('base64url');
/** @param {string} s */
const fromB64url = (s) => Buffer.from(s, 'base64url');
/** @param {string} body */
const hmac = (body) => createHmac('sha256', SECRET).update(body).digest('base64url');

/** @param {string} uid @returns {string} */
function sign(uid) {
  const body = b64url(JSON.stringify({ uid, iat: Date.now() }));
  return body + '.' + hmac(body);
}
/** @param {string | undefined} token @returns {string | null} */
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

/** @param {{ headers: { cookie?: string } }} req @returns {Record<string, string>} */
export function parseCookies(req) {
  /** @type {Record<string, string>} */
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

/** User id from the request's session cookie, or null.
 * @param {{ headers: { cookie?: string } }} req @returns {string | null} */
export function sessionUid(req) {
  return read(parseCookies(req)[COOKIE]);
}

// Decide whether to mark the session cookie `Secure` (HTTPS-only). We force it on
// when COOKIE_SECURE=1, force it off when COOKIE_SECURE=0, and otherwise
// auto-detect: a reverse proxy terminating TLS (Caddy, nginx, …) forwards the
// original scheme in X-Forwarded-Proto. So HTTPS deployments get Secure cookies
// even if the env var was never set, while plain-HTTP localhost dev still works.
/** @param {{ headers: any }} req @returns {boolean} */
function secureFor(req) {
  if (process.env.COOKIE_SECURE === '1') return true;
  if (process.env.COOKIE_SECURE === '0') return false;
  // Works whether headers is a Fetch `Headers` (SvelteKit Request) or a plain object.
  const h = req && req.headers;
  const proto = h && (typeof h.get === 'function' ? h.get('x-forwarded-proto') : h['x-forwarded-proto']);
  return String(proto || '').split(',')[0].trim().toLowerCase() === 'https';
}

/** @param {string} uid @param {{ headers: any }} req @returns {string} */
export function sessionCookie(uid, req) {
  const secure = secureFor(req) ? '; Secure' : '';
  return `${COOKIE}=${sign(uid)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${MAX_AGE}${secure}`;
}
/** @param {{ headers: any }} req @returns {string} */
export function clearCookie(req) {
  const secure = secureFor(req) ? '; Secure' : '';
  return `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`;
}

// ---- Anonymous host tokens ---------------------------------------------------
// An anonymous game has no account behind it, so "are you the host?" can't lean
// on a session. Instead the creator gets a token derived from the game id and
// the server secret — unguessable and not stored in (or derivable from) the
// publicly-served game body, unlike the old plaintext hostId. The holder of the
// token is the host; everyone else with the code is just a player.
/** @param {string} gameId @returns {string} */
export function signGameToken(gameId) {
  return hmac('host:' + gameId);
}
/** @param {string | null | undefined} token @param {string} gameId @returns {boolean} */
export function verifyGameToken(token, gameId) {
  if (!token) return false;
  const expected = Buffer.from(signGameToken(gameId));
  const provided = Buffer.from(String(token));
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

// Seat token: a signed proof that a device holds a SPECIFIC seat. Issued to the
// device that self-joined the seat, so it can later link that seat to an account
// with NO host approval (same device that played = it really is their seat). Any
// other account claiming a seat has to go through the host — this token is the
// only thing that skips that. Never exposed in the served game body.
/** @param {string} gameId @param {string} playerId @returns {string} */
export function signSeatToken(gameId, playerId) {
  return hmac('seat:' + gameId + ':' + playerId);
}
/** @param {string | null | undefined} token @param {string} gameId @param {string} playerId @returns {boolean} */
export function verifySeatToken(token, gameId, playerId) {
  if (!token) return false;
  const expected = Buffer.from(signSeatToken(gameId, playerId));
  const provided = Buffer.from(String(token));
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

// ---- Email unsubscribe tokens ------------------------------------------------
// A one-click unsubscribe link in an email can't lean on a session cookie. We
// sign the userId with the server secret so the link works while logged out, yet
// can't be forged to unsubscribe someone else's account.
/** @param {string} userId @returns {string} */
export function signUnsubToken(userId) {
  return hmac('unsub:' + userId);
}
/** @param {string} userId @param {string | null | undefined} token @returns {boolean} */
export function verifyUnsubToken(userId, token) {
  if (!userId || !token) return false;
  const expected = Buffer.from(signUnsubToken(userId));
  const provided = Buffer.from(String(token));
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

// ---- Google ID token verification -------------------------------------------
/** @type {{ keys: any[], at: number }} */
let jwks = { keys: [], at: 0 };
async function googleKeys() {
  if (jwks.keys.length && Date.now() - jwks.at < 3600e3) return jwks.keys;
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  const json = await res.json();
  jwks = { keys: json.keys || [], at: Date.now() };
  return jwks.keys;
}

/** Verify a Google Identity Services credential (JWT). Returns the payload.
 * @param {string} credential @param {string | null} clientId @returns {Promise<any>} */
export async function verifyGoogleIdToken(credential, clientId) {
  const parts = String(credential || '').split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [h, p, s] = parts;
  const header = JSON.parse(fromB64url(h).toString());
  const jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown signing key');
  const pub = createPublicKey({ key: jwk, format: 'jwk' });
  // 'sha256' is the OpenSSL digest name for RS256 (RSASSA-PKCS1-v1.5 + SHA-256).
  // Passing 'RS256' here throws "Invalid digest: RS256".
  const ok = cryptoVerify('sha256', Buffer.from(`${h}.${p}`), pub, fromB64url(s));
  if (!ok) throw new Error('bad signature');
  const payload = JSON.parse(fromB64url(p).toString());
  if (payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com') throw new Error('bad issuer');
  if (clientId && payload.aud !== clientId) throw new Error('token not for this app');
  if (payload.exp * 1000 < Date.now()) throw new Error('token expired');
  // Replay guard: a freshly-minted sign-in token is seconds old, so reject any
  // that's more than a few minutes old (clock-skew tolerant) — shrinks the
  // window in which a captured token could be replayed from ~1h to minutes.
  if (payload.iat && Date.now() - payload.iat * 1000 > 10 * 60_000) throw new Error('stale token');
  return payload; // { sub, name, email, picture, ... }
}

// ---- Apple ID token verification --------------------------------------------
// Same shape as Google: the browser's Sign in with Apple JS popup returns an
// identity token (a JWT) we verify against Apple's public keys. No private key
// or rotating client secret is needed for verify-only sign-in.
/** @type {{ keys: any[], at: number }} */
let appleJwks = { keys: [], at: 0 };
async function appleKeys() {
  if (appleJwks.keys.length && Date.now() - appleJwks.at < 3600e3) return appleJwks.keys;
  const res = await fetch('https://appleid.apple.com/auth/keys');
  const json = await res.json();
  appleJwks = { keys: json.keys || [], at: Date.now() };
  return appleJwks.keys;
}

/** Verify a Sign in with Apple identity token (JWT). Returns the payload.
 * @param {string} idToken @param {string | null} clientId @returns {Promise<any>} */
export async function verifyAppleIdToken(idToken, clientId) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [h, p, s] = parts;
  const header = JSON.parse(fromB64url(h).toString());
  const jwk = (await appleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown signing key');
  const pub = createPublicKey({ key: jwk, format: 'jwk' });
  // 'sha256' is the OpenSSL digest name for RS256 (RSASSA-PKCS1-v1.5 + SHA-256).
  // Passing 'RS256' here throws "Invalid digest: RS256".
  const ok = cryptoVerify('sha256', Buffer.from(`${h}.${p}`), pub, fromB64url(s));
  if (!ok) throw new Error('bad signature');
  const payload = JSON.parse(fromB64url(p).toString());
  if (payload.iss !== 'https://appleid.apple.com') throw new Error('bad issuer');
  // aud is normally the Services ID string, but can be an array.
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (clientId && !aud.includes(clientId)) throw new Error('token not for this app');
  if (payload.exp * 1000 < Date.now()) throw new Error('token expired');
  // Replay guard: a freshly-minted sign-in token is seconds old, so reject any
  // that's more than a few minutes old (clock-skew tolerant) — shrinks the
  // window in which a captured token could be replayed from ~1h to minutes.
  if (payload.iat && Date.now() - payload.iat * 1000 > 10 * 60_000) throw new Error('stale token');
  return payload; // { sub, email, ... }  (no name — that arrives separately on first sign-in)
}
