// Security regression tests — auth, sessions, password (PIN) hashing, OAuth token
// rejection, access control, account-link takeover, and input-injection guards.
//
// These exercise the REAL server modules (no mocks of our own code). To keep them
// off your actual accounts/games, we point the file-backed stores at a throwaway
// temp dir BEFORE importing anything that reads DATA_DIR at load time — so the env
// var has to be set first, and the security modules are pulled in via dynamic
// import() below rather than static imports (which would be hoisted above this).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PC_DATA_DIR = mkdtempSync(join(tmpdir(), 'pc-sec-'));
delete process.env.COOKIE_SECURE; // let secureFor() auto-detect from x-forwarded-proto

const auth = await import('../src/lib/server/auth.js');
const users = await import('../src/lib/server/users.js');
const helpers = await import('../src/lib/server/helpers.js');

auth.initAuth(); // mint a session secret in the temp dir
users.init();    // empty store (no users.json in temp dir)

const COOKIE = 'pc_session';
/** A Fetch Request whose headers.get() the request-facing helpers read
 *  (sessionUser / privacyBlock / secureFor all use .get()). */
const reqWith = (headers = {}) => new Request('http://test.local/', { headers });
const cookieHeader = (cookie) => reqWith({ cookie });
/** auth.sessionUid()/parseCookies() read `req.headers.cookie` as a PLAIN property
 *  (not .get()), so direct calls to them need a plain object, not a Fetch Request. */
const plainCookie = (cookie) => ({ headers: { cookie } });
/** Pull the bare token out of a Set-Cookie string. */
const tokenOf = (setCookie) => setCookie.split(';')[0].slice(COOKIE.length + 1);

// ---------------------------------------------------------------------------
// Password (PIN) storage — hashed at rest, never plaintext, salted per user.
// ---------------------------------------------------------------------------
test('PIN is stored as a salted scrypt hash, never plaintext', () => {
  const u = users.createLocal({ handle: 'alice', pin: 'hunter2', displayName: 'Alice' });
  assert.ok(u.pinHash, 'pinHash should be set');
  assert.ok(!String(u.pinHash).includes('hunter2'), 'hash must not contain the plaintext PIN');
  assert.match(u.pinHash, /^[0-9a-f]{32}:[0-9a-f]{64}$/, 'salt(16B hex):hash(32B hex)');
});

test('same PIN for two users yields different hashes (unique salt)', () => {
  const a = users.createLocal({ handle: 'samepin1', pin: 'identical', displayName: 'A' });
  const b = users.createLocal({ handle: 'samepin2', pin: 'identical', displayName: 'B' });
  assert.notEqual(a.pinHash, b.pinHash, 'per-user salt must make identical PINs hash differently');
});

test('login succeeds with the right PIN and fails with the wrong one', () => {
  users.createLocal({ handle: 'bob', pin: 'correct-horse', displayName: 'Bob' });
  const ok = users.loginLocal({ handle: 'bob', pin: 'correct-horse' });
  assert.equal(ok.handle, 'bob');
  assert.throws(() => users.loginLocal({ handle: 'bob', pin: 'wrong' }), /Wrong name or passcode/);
});

test('login does not let you enumerate accounts (same error for bad user vs bad pin)', () => {
  users.createLocal({ handle: 'carol', pin: 'sekret-pass', displayName: 'Carol' });
  let badUser, badPin;
  try { users.loginLocal({ handle: 'nobody-here', pin: 'x' }); } catch (e) { badUser = e; }
  try { users.loginLocal({ handle: 'carol', pin: 'nope' }); } catch (e) { badPin = e; }
  assert.equal(badUser.message, badPin.message, 'identical message prevents user enumeration');
  assert.equal(badUser.status, 401);
});

test('publicUser() never leaks pinHash or email', () => {
  const u = users.createLocal({ handle: 'dave', pin: 'passcode1', email: 'dave@example.com' });
  const pub = users.publicUser(u);
  assert.equal(pub.pinHash, undefined);
  assert.equal(pub.email, undefined);
  assert.equal(pub.handle, 'dave');
});

test('weak/short PINs and bad handles are rejected', () => {
  assert.throws(() => users.createLocal({ handle: 'shortpin', pin: '123' }), /at least 4/);
  assert.throws(() => users.createLocal({ handle: 'no', pin: 'longenough' }), /3.20/); // handle too short
  users.createLocal({ handle: 'dupe', pin: 'longenough' });
  assert.throws(() => users.createLocal({ handle: 'dupe', pin: 'longenough' }), /taken/);
});

// ---------------------------------------------------------------------------
// Sessions — signed, tamper-evident, HttpOnly cookies.
// ---------------------------------------------------------------------------
test('a valid session cookie round-trips to the user id', () => {
  const u = users.createLocal({ handle: 'erin', pin: 'passcode1' });
  const token = tokenOf(auth.sessionCookie(u.id, reqWith({ 'x-forwarded-proto': 'https' })));
  assert.equal(auth.sessionUid(plainCookie(`${COOKIE}=${token}`)), u.id);
});

test('cookie flags: HttpOnly + SameSite=Lax always; Secure only over https', () => {
  const u = users.createLocal({ handle: 'flags', pin: 'passcode1' });
  const https = auth.sessionCookie(u.id, reqWith({ 'x-forwarded-proto': 'https' }));
  const http = auth.sessionCookie(u.id, reqWith({}));
  for (const c of [https, http]) {
    assert.match(c, /HttpOnly/);
    assert.match(c, /SameSite=Lax/);
  }
  assert.match(https, /Secure/, 'https request → Secure cookie');
  assert.ok(!/Secure/.test(http), 'plain http → no Secure flag');
});

test('a tampered session token is rejected (forged identity)', () => {
  const u = users.createLocal({ handle: 'frank', pin: 'passcode1' });
  const token = tokenOf(auth.sessionCookie(u.id, reqWith({})));
  const [body, sig] = token.split('.');
  // Sanity: the untampered token DOES resolve, so the rejections below are meaningful.
  assert.equal(auth.sessionUid(plainCookie(`${COOKIE}=${token}`)), u.id);
  // Flip the signature → reject.
  assert.equal(auth.sessionUid(plainCookie(`${COOKIE}=${body}.${sig.slice(0, -2)}AA`)), null);
  // Swap the body for a different uid but keep the old sig → reject (HMAC won't match).
  const forged = Buffer.from(JSON.stringify({ uid: 'someone-else', iat: Date.now() })).toString('base64url');
  assert.equal(auth.sessionUid(plainCookie(`${COOKIE}=${forged}.${sig}`)), null);
  // Garbage / empty → null, never a throw.
  assert.equal(auth.sessionUid(plainCookie(`${COOKIE}=not-a-token`)), null);
  assert.equal(auth.sessionUid(plainCookie('')), null);
});

test('clearCookie expires the session immediately', () => {
  assert.match(auth.clearCookie(reqWith({})), /pc_session=;[^]*Max-Age=0/);
});

// ---------------------------------------------------------------------------
// OAuth (Google / Apple) — malformed tokens are rejected before any network call.
// (Full signature/issuer/aud/exp checks live in auth.js and need a real provider
// key; here we lock in that obviously-bad tokens never sneak through.)
// ---------------------------------------------------------------------------
test('Google/Apple verify reject malformed (non-JWT) tokens', async () => {
  await assert.rejects(auth.verifyGoogleIdToken('not.a.jwt.token', 'client-id'), /malformed|signing key|bad/i);
  await assert.rejects(auth.verifyGoogleIdToken('', 'client-id'), /malformed/);
  await assert.rejects(auth.verifyAppleIdToken('only-one-part', 'client-id'), /malformed/);
  await assert.rejects(auth.verifyAppleIdToken('', 'client-id'), /malformed/);
});

// ---------------------------------------------------------------------------
// Access control — privacy gate for profile details.
// ---------------------------------------------------------------------------
test('privacyBlock: public is open; members needs a session; private is owner-only', () => {
  const owner = users.createLocal({ handle: 'grace', pin: 'passcode1' });
  const ownerCookie = auth.sessionCookie(owner.id, reqWith({})).split(';')[0].slice(COOKIE.length + 1);
  const asOwner = () => cookieHeader(`${COOKIE}=${ownerCookie}`);
  const anon = () => reqWith({});

  assert.equal(helpers.privacyBlock({ ...owner, privacy: 'public' }, anon()), null);

  assert.equal(helpers.privacyBlock({ ...owner, privacy: 'members' }, anon())?.status, 403);
  assert.equal(helpers.privacyBlock({ ...owner, privacy: 'members' }, asOwner()), null);

  assert.equal(helpers.privacyBlock({ ...owner, privacy: 'private' }, anon())?.status, 403);
  assert.equal(helpers.privacyBlock({ ...owner, privacy: 'private' }, asOwner()), null, 'owner can see own private profile');
  // A different signed-in user cannot see a private profile.
  const other = users.createLocal({ handle: 'heidi', pin: 'passcode1' });
  const otherCookie = auth.sessionCookie(other.id, reqWith({})).split(';')[0].slice(COOKIE.length + 1);
  assert.equal(helpers.privacyBlock({ ...owner, privacy: 'private' }, cookieHeader(`${COOKIE}=${otherCookie}`))?.status, 403);
});

// ---------------------------------------------------------------------------
// Account-link takeover — a verified OAuth identity can belong to only one account,
// and an account's original sign-in method can never be unlinked (no lock-out).
// ---------------------------------------------------------------------------
test('linking an OAuth identity already owned by another account is refused (409)', () => {
  const a = users.upsertOAuth({ provider: 'google', sub: 'goog-123', displayName: 'A', email: 'a@x.com' });
  const b = users.createLocal({ handle: 'ivan', pin: 'passcode1' });
  assert.throws(
    () => users.linkProvider(b.id, { provider: 'google', sub: 'goog-123' }),
    (e) => e.status === 409,
    'must not let B claim A\'s Google identity',
  );
  // The identity still resolves to A.
  assert.equal(users.getByProvider('google', 'goog-123').id, a.id);
});

test('cannot unlink the primary provider (prevents account lock-out)', () => {
  const g = users.upsertOAuth({ provider: 'google', sub: 'goog-primary', displayName: 'P' });
  assert.throws(() => users.unlinkProvider(g.id, 'google'), (e) => e.status === 404);
  // Still signs in via the primary identity afterwards.
  assert.equal(users.getByProvider('google', 'goog-primary').id, g.id);
});

// ---------------------------------------------------------------------------
// Input-injection guards.
// ---------------------------------------------------------------------------
test('isSafeId blocks prototype-pollution keys', () => {
  for (const bad of ['__proto__', 'prototype', 'constructor', '', 0, null, undefined, {}]) {
    assert.equal(helpers.isSafeId(bad), false, `must reject ${JSON.stringify(bad)}`);
  }
  assert.equal(helpers.isSafeId('p7Xk29'), true);
});

test('isMoney rejects negative, NaN, sub-cent and non-numeric values', () => {
  for (const bad of [-1, -0.01, NaN, Infinity, '', null, undefined, true, {}, '1e9999', 0.005, 'abc']) {
    assert.equal(helpers.isMoney(bad), false, `must reject ${JSON.stringify(bad)}`);
  }
  for (const good of [0, 1, 20, 12.5, '40', '0.07']) {
    assert.equal(helpers.isMoney(good), true, `must accept ${JSON.stringify(good)}`);
  }
});

// ---------------------------------------------------------------------------
// Host authorization tokens — unguessable, bound to the exact game.
// ---------------------------------------------------------------------------
test('game host token verifies only for its own game and rejects forgeries', () => {
  const t = auth.signGameToken('GAME-ALPHA');
  assert.equal(auth.verifyGameToken(t, 'GAME-ALPHA'), true);
  assert.equal(auth.verifyGameToken(t, 'GAME-BETA'), false, 'token is bound to one game');
  assert.equal(auth.verifyGameToken('forged-token', 'GAME-ALPHA'), false);
  assert.equal(auth.verifyGameToken(null, 'GAME-ALPHA'), false);
  assert.equal(auth.verifyGameToken('', 'GAME-ALPHA'), false);
});
