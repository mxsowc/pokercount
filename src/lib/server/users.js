// File-backed user accounts. Like the game store: one JSON file, held in memory,
// written through on change. Supports local (handle + PIN) accounts and OAuth
// accounts (Google now, Apple slot reserved) keyed by provider + subject id.

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

import { DATA_DIR } from "./paths.js";
import { writeFileDurable } from "./fsutil.js";
import { citySlug, cityLabel } from "../cities.js";
import { join } from "node:path";
const FILE = join(DATA_DIR, 'users.json');

/** @typedef {import('../types').User} User */
/** @typedef {import('../types').PublicUser} PublicUser */

/** @type {Map<string, User>} */
const byId = new Map();
/** @type {Map<string, string>} */
const handleIndex = new Map(); // lower(handle) -> id
/** @type {Map<string, string>} */
const providerIndex = new Map(); // `${provider}:${sub}` -> id

function now() { return new Date().toISOString(); }
/** @param {number} [n] @returns {string} */
function uid(n = 10) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const b = randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += A[b[i] % A.length];
  return s;
}

function persist() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileDurable(FILE, JSON.stringify([...byId.values()], null, 2));
}

export function init() {
  if (!existsSync(FILE)) return 0;
  try {
    for (const u of JSON.parse(readFileSync(FILE, 'utf8'))) index(u);
  } catch (err) {
    // A single shared file holds every account. Silently starting with an empty
    // store would log everyone out and quietly break ownership checks — far worse
    // than refusing to start. Fail fast so an operator notices and recovers it.
    throw new Error(`[users] refusing to start: ${FILE} is unreadable (${err instanceof Error ? err.message : err}). Restore or remove it.`);
  }
  return byId.size;
}

/** @param {User} u */
function index(u) {
  byId.set(u.id, u);
  handleIndex.set(u.handle.toLowerCase(), u.id);
  if (u.provider && u.providerSub) providerIndex.set(`${u.provider}:${u.providerSub}`, u.id);
  // Linked OAuth identities resolve to this same account on sign-in, too.
  for (const lp of u.linkedProviders || []) providerIndex.set(`${lp.provider}:${lp.sub}`, u.id);
}

/** @param {string | null | undefined} id @returns {User | null} */
export function getUser(id) { return id ? byId.get(id) || null : null; }
/** @returns {User[]} Every user (raw — callers must strip sensitive fields like pinHash). */
export function allUsers() { return [...byId.values()]; }

/** Record that a signed-in user is active, at most once an hour (for the
 *  active-users metric). Cheap no-op when called more often.
 *  @param {string | null | undefined} userId */
export function touchLastSeen(userId) {
  if (!userId) return;
  const u = byId.get(userId);
  if (!u) return;
  const last = u.lastSeenAt ? Date.parse(u.lastSeenAt) : 0;
  if (Date.now() - last < 3600_000) return; // throttle disk writes to ≤ 1/hour/user
  u.lastSeenAt = now();
  persist();
}
/** @param {string | null | undefined} handle @returns {User | null} */
export function getByHandle(handle) {
  return handle ? byId.get(handleIndex.get(normalizeHandle(handle)) || '') || null : null;
}
/** @param {string} provider @param {string} sub @returns {User | null} */
export function getByProvider(provider, sub) {
  return byId.get(providerIndex.get(`${provider}:${sub}`) || '') || null;
}

// Public-safe view (never leak pinHash).
/** @param {User | null | undefined} u @returns {PublicUser | null} */
export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    handle: u.handle,
    displayName: u.displayName,
    avatar: u.avatar || null,
    provider: u.provider,
    privacy: u.privacy || 'public', // who can see this profile/stats: public | members | private
    city: u.city || null,          // home city — for the by-city leaderboard + finding locals
    needsHandle: !!u.needsHandle, // true until an OAuth user has chosen their name
    onboarded: !!u.onboardedAt,   // whether to prompt the one-time onboarding questions
  };
}

/** @param {string} query @param {string} [excludeId] @param {number} [limit] @returns {User[]} */
export function searchUsers(query, excludeId, limit = 20) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 1) return [];
  /** @type {User[]} */
  const results = [];
  for (const u of byId.values()) {
    if (results.length >= limit) break;
    if (excludeId && u.id === excludeId) continue;
    if (u.handle.includes(q) || u.displayName.toLowerCase().includes(q)) {
      results.push(u);
    }
  }
  return results;
}

// ---- public city directory (SEO) --------------------------------------------

/** Self-declared minor (onboarding "Under 18"). Excluded from every public,
 *  search-indexed surface: publishing a minor's name/photo/city in a
 *  gambling-adjacent context is a hard no (GDPR/AVG + gambling age rules).
 *  @param {User} u @returns {boolean} */
function isMinor(u) {
  return (u.ageRange || '').trim().toLowerCase() === 'under 18';
}

/** Public players in a city, addressed by canonical slug (see $lib/cities). Only
 *  privacy:'public' profiles (minors excluded). DATA-MINIMISED on purpose: this
 *  feeds the unauthenticated, search-indexed directory, so it returns ONLY each
 *  player's self-chosen handle — never the real display name or avatar. That
 *  low-impact, pseudonymous surface is what keeps the opt-out directory defensible
 *  under GDPR legitimate interest. The richer profile (name/photo/stats) lives one
 *  click deeper at /u/[handle], gated by the same privacy setting.
 *  `label` is the nicest free-text casing we saw for that city, for the title.
 *  @param {string} slug @returns {{ users: { handle: string }[], label: string }} */
export function publicUsersByCity(slug) {
  const key = String(slug || '');
  if (!key) return { users: [], label: '' };
  /** @type {{ handle: string }[]} */
  const users = [];
  let label = '';
  for (const u of byId.values()) {
    if (!u.city || citySlug(u.city) !== key) continue;
    if (!label) label = String(u.city).trim(); // remember a real-world casing
    if ((u.privacy || 'public') !== 'public' || isMinor(u)) continue;
    users.push({ handle: u.handle });
  }
  users.sort((a, b) => a.handle.localeCompare(b.handle));
  return { users, label };
}

/** The city directory: every city with ≥1 PUBLIC player, with counts. Curated
 *  cities keep their nice labels; others use the nicest free-text casing seen.
 *  Sorted busiest-first. @returns {{ slug: string, label: string, count: number }[]} */
export function cityDirectory() {
  /** @type {Map<string,{label:string,count:number}>} */
  const map = new Map();
  for (const u of byId.values()) {
    if (!u.city || (u.privacy || 'public') !== 'public' || isMinor(u)) continue;
    const slug = citySlug(u.city);
    if (!slug) continue;
    const cur = map.get(slug) || { label: String(u.city).trim(), count: 0 };
    cur.count++;
    map.set(slug, cur);
  }
  const out = [];
  for (const [slug, v] of map) out.push({ slug, label: cityLabel(slug, v.label), count: v.count });
  out.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return out;
}

/** Normalize/validate an email; returns a clean lowercase address or null.
 * @param {string | null | undefined} raw @returns {string | null} */
function cleanEmail(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? s.slice(0, 200) : null;
}

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
/** @param {string | null | undefined} raw @returns {string} */
export function normalizeHandle(raw) {
  return String(raw || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
}
/** @param {string} base @returns {string} */
function uniqueHandle(base) {
  let h = normalizeHandle(base) || 'player';
  if (h.length < 3) h = (h + 'player').slice(0, 8);
  let candidate = h;
  let n = 0;
  while (handleIndex.has(candidate)) candidate = h + ++n;
  return candidate;
}

// ---- PIN hashing (scrypt) ----------------------------------------------------
/** @param {string | undefined} pin @returns {string} */
function hashPin(pin) {
  const salt = randomBytes(16);
  const h = scryptSync(String(pin), salt, 32);
  return salt.toString('hex') + ':' + h.toString('hex');
}
/** @param {string | undefined} pin @param {string | null} stored @returns {boolean} */
function checkPin(pin, stored) {
  if (!stored) return false;
  const [s, h] = stored.split(':');
  const hb = Buffer.from(h, 'hex');
  const calc = scryptSync(String(pin), Buffer.from(s, 'hex'), 32);
  return calc.length === hb.length && timingSafeEqual(calc, hb);
}

// Throw an Error carrying an HTTP status the API layer maps to a response code.
/** @param {string} message @param {number} status @returns {never} */
function fail(message, status) { throw Object.assign(new Error(message), { status }); }

// ---- account creation / auth -------------------------------------------------
/** @param {{ handle?: string, displayName?: string, pin?: string, email?: string, newsletter?: boolean }} input @returns {User} */
export function createLocal({ handle, displayName, pin, email, newsletter }) {
  const h = normalizeHandle(handle);
  if (!HANDLE_RE.test(h)) fail('name must be 3–20 letters, numbers or _', 400);
  if (handleIndex.has(h)) fail('that name is taken', 409);
  if (String(pin || '').length < 4) fail('Passcode must be at least 4 characters', 400);
  const mail = cleanEmail(email);
  const u = {
    id: uid(),
    handle: h,
    displayName: String(displayName || h).trim().slice(0, 40) || h,
    provider: 'local',
    providerSub: null,
    pinHash: hashPin(pin),
    avatar: null,
    avatarCustom: false,
    oauthAvatar: null,
    privacy: 'public',
    email: mail,
    // Monthly summary is OPT-IN: enrol only when the user actively ticked the box
    // at signup AND we have an address to send to. No pre-ticked consent.
    newsletter: !!newsletter && !!mail,
    // Stamp now so the first monthly summary lands ~30 days after signup, not on
    // the next scheduler tick.
    lastSummaryEmailAt: now(),
    lastSeenAt: now(),
    createdAt: now(),
  };
  index(u);
  persist();
  console.log(`[user] new local account @${u.handle} — ${byId.size} total`);
  return u;
}

/** @param {{ handle?: string, pin?: string }} input @returns {User} */
export function loginLocal({ handle, pin }) {
  const u = getByHandle(handle);
  if (!u || u.provider !== 'local' || !checkPin(pin, u.pinHash)) fail('Wrong name or passcode', 401);
  u.lastSeenAt = now();
  persist();
  return u;
}

// Find or create an OAuth-backed account.
/** @param {{ provider: string, sub: string, displayName?: string, avatar?: string|null, handleHint?: string, email?: string, newsletter?: boolean }} input @returns {User} */
export function upsertOAuth({ provider, sub, displayName, avatar, handleHint, email, newsletter }) {
  const mail = cleanEmail(email);
  let u = getByProvider(provider, sub);
  if (u) {
    // Returning user: refresh email and the cached OAuth photo, but NEVER clobber
    // a picture the user uploaded themselves (avatarCustom). Preserve their stored
    // newsletter choice (the opt-in checkbox only applies at first sign-up).
    if (avatar && avatar !== u.oauthAvatar) u.oauthAvatar = avatar;
    if (avatar && !u.avatarCustom && avatar !== u.avatar) u.avatar = avatar;
    if (mail && mail !== u.email) u.email = mail;
    u.lastSeenAt = now(); // sign-in event — always persist
    persist();
    return u;
  }
  u = {
    id: uid(),
    handle: uniqueHandle(handleHint || displayName || provider),
    displayName: String(displayName || 'Player').trim().slice(0, 40),
    provider,
    providerSub: sub,
    pinHash: null,
    avatar: avatar || null,
    avatarCustom: false,
    oauthAvatar: avatar || null,
    privacy: 'public',
    email: mail,
    newsletter: !!newsletter && !!mail, // opt-IN only (consent checkbox at sign-in)
    lastSummaryEmailAt: now(), // first summary ~30 days out, not on the next tick
    needsHandle: true, // they get a suggested handle but choose their own on first sign-in
    lastSeenAt: now(),
    createdAt: now(),
  };
  index(u);
  persist();
  console.log(`[user] new ${provider} account @${u.handle} — ${byId.size} total`);
  return u;
}

// Save (optional) onboarding answers and mark onboarding done so it isn't shown
// again. All fields are optional — a "skip" just sets onboardedAt with no data.
/** @param {string} userId @param {{ ageRange?: string, country?: string, heardFrom?: string }} input @returns {User} */
export function saveOnboarding(userId, { ageRange, country, heardFrom }) {
  const u = byId.get(userId);
  if (!u) fail('not signed in', 401);
  const clip = (/** @type {unknown} */ s) => { const v = String(s == null ? '' : s).trim().slice(0, 60); return v || null; };
  if (ageRange !== undefined) u.ageRange = clip(ageRange);
  if (country !== undefined) u.country = clip(country);
  if (heardFrom !== undefined) u.heardFrom = clip(heardFrom);
  u.onboardedAt = now();
  persist();
  return u;
}

const PRIVACY_LEVELS = new Set(['public', 'members', 'private']);
const MAX_AVATAR_BYTES = 200 * 1024; // cap inline data-URL avatars to keep users.json small

// Update a user's profile. `name` is both their display name and their
// (normalized, unique) handle. `avatar` is a data:image/* URL (custom upload) or
// null/'' to reset to their OAuth photo. `privacy` is one of PRIVACY_LEVELS.
// Each field is optional — only provided ones change. Editable any time.
/** @param {string} userId @param {{ name?: string, avatar?: string|null, privacy?: string, newsletter?: boolean, email?: string|null, city?: string|null }} input @returns {User} */
export function updateProfile(userId, { name, avatar, privacy, newsletter, email, city } = {}) {
  const u = byId.get(userId);
  if (!u) fail('not signed in', 401);

  if (city !== undefined) {
    // Home city — powers the by-city leaderboard and finding local players. Free
    // text (people know their own city best); empty clears it.
    u.city = String(city || '').trim().replace(/\s+/g, ' ').slice(0, 60) || null;
  }

  if (email !== undefined) {
    // Optional, UNVERIFIED contact email — a PIN user can add one so the account
    // isn't tied to a single forgettable passcode (Google/Apple linking is the
    // verified path). Empty clears it (and any newsletter opt-in, which needs one).
    if (email === null || String(email).trim() === '') {
      u.email = null;
      u.newsletter = false;
    } else {
      const mail = cleanEmail(email);
      if (!mail) fail("that doesn't look like an email address", 400);
      u.email = mail;
      // Adding an email does NOT auto-subscribe — enrolment is always an explicit
      // opt-in (the signup checkbox, or the toggle in account settings).
    }
  }

  if (name !== undefined) {
    const h = normalizeHandle(name);
    if (!HANDLE_RE.test(h)) fail('name must be 3–20 letters, numbers or _', 400);
    const owner = handleIndex.get(h);
    if (owner && owner !== userId) fail('that name is taken', 409);
    handleIndex.delete(u.handle.toLowerCase());
    u.handle = h;
    u.displayName = String(name).trim().slice(0, 40) || h;
    u.needsHandle = false;
    handleIndex.set(h, userId);
  }

  if (avatar !== undefined) {
    if (avatar) {
      const s = String(avatar);
      if (!s.startsWith('data:image/')) fail('avatar must be an image', 400);
      if (s.length > MAX_AVATAR_BYTES) fail('image too large — pick a smaller one', 413);
      u.avatar = s;
      u.avatarCustom = true;
    } else {
      // reset to the OAuth photo (or nothing → initial badge)
      u.avatar = u.oauthAvatar || null;
      u.avatarCustom = false;
    }
  }

  if (privacy !== undefined) {
    if (!PRIVACY_LEVELS.has(privacy)) fail('invalid privacy setting', 400);
    u.privacy = privacy;
  }

  if (newsletter !== undefined) {
    u.newsletter = !!newsletter && !!u.email; // opt-in only counts with an email on file
  }

  persist();
  return u;
}

// ---- account linking & deletion ---------------------------------------------

/** The OAuth providers this account can currently sign in with (its original
 *  provider, if not a local PIN account, plus any later-linked ones).
 *  @param {User} u @returns {string[]} */
export function connectedProviders(u) {
  const set = new Set();
  if (u.provider && u.provider !== 'local') set.add(u.provider);
  for (const lp of u.linkedProviders || []) set.add(lp.provider);
  return [...set];
}

/** Attach a verified OAuth identity (Google/Apple) to an EXISTING account, as an
 *  additional way to sign in — never destructive: the original login (PIN and/or
 *  the primary provider) keeps working. Adopts the provider's email/photo only to
 *  fill gaps. Throws 409 if that identity already belongs to a different account.
 *  @param {string} userId
 *  @param {{ provider: string, sub: string, email?: string|null, avatar?: string|null }} input
 *  @returns {User} */
export function linkProvider(userId, { provider, sub, email, avatar }) {
  const u = byId.get(userId);
  if (!u) fail('not signed in', 401);
  if (!provider || !sub) fail('missing provider identity', 400);
  const key = `${provider}:${sub}`;
  const owner = providerIndex.get(key);
  if (owner && owner !== userId) {
    fail(`That ${provider === 'apple' ? 'Apple' : 'Google'} account is already linked to another profile`, 409);
  }
  const isPrimary = u.provider === provider && u.providerSub === sub;
  const already = isPrimary || (u.linkedProviders || []).some((lp) => lp.provider === provider && lp.sub === sub);
  if (!already) {
    if (!u.linkedProviders) u.linkedProviders = [];
    u.linkedProviders.push({ provider, sub, linkedAt: now() });
    providerIndex.set(key, userId);
  }
  // Fill in a verified email if the account had none (gives PIN users a contact).
  // Linking never auto-subscribes — the monthly summary is always an explicit opt-in.
  const mail = cleanEmail(email);
  if (mail && !u.email) u.email = mail;
  // Adopt the provider photo only if the user has no avatar of their own.
  if (avatar && !u.avatar && !u.avatarCustom) { u.avatar = avatar; u.oauthAvatar = avatar; }
  persist();
  console.log(`[user] linked ${provider} to @${u.handle}`);
  return u;
}

/** Disconnect a LATER-linked OAuth provider. Only touches linkedProviders, so an
 *  account's original sign-in method can never be removed (no lock-out). No-op
 *  error if that provider wasn't a linked extra. @param {string} userId
 *  @param {string} provider @returns {User} */
export function unlinkProvider(userId, provider) {
  const u = byId.get(userId);
  if (!u) fail('not signed in', 401);
  const list = u.linkedProviders || [];
  const keep = list.filter((lp) => lp.provider !== provider);
  if (keep.length === list.length) fail('that account is not linked', 404);
  for (const lp of list) {
    if (lp.provider !== provider) continue;
    const key = `${lp.provider}:${lp.sub}`;
    // Don't drop the index if the primary identity still uses this exact key.
    const stillPrimary = u.provider === lp.provider && u.providerSub === lp.sub;
    if (!stillPrimary && providerIndex.get(key) === userId) providerIndex.delete(key);
  }
  if (keep.length) u.linkedProviders = keep; else delete u.linkedProviders;
  persist();
  return u;
}

/** Set a user's monthly-summary subscription. Used by the one-click unsubscribe
 *  link (logged-out) and the account toggle. Enabling only sticks if there's an
 *  email to send to. @param {string} userId @param {boolean} on @returns {boolean} */
export function setNewsletter(userId, on) {
  const u = byId.get(userId);
  if (!u) return false;
  u.newsletter = !!on && !!u.email;
  persist();
  return true;
}

/** Record that we just sent this user their monthly summary (rolling 30-day
 *  cadence, idempotent across restarts). @param {string} userId @param {number} [atMs] */
export function markSummarySent(userId, atMs = Date.now()) {
  const u = byId.get(userId);
  if (!u) return;
  u.lastSummaryEmailAt = new Date(atMs).toISOString();
  persist();
}

/** Verify a local account's PIN (for re-confirming a sensitive action like
 *  deletion). False for OAuth-only accounts with no PIN. @param {string} userId
 *  @param {string} [pin] @returns {boolean} */
export function verifyPin(userId, pin) {
  const u = byId.get(userId);
  return !!u && checkPin(pin, u.pinHash);
}

/** Permanently remove an account: drop it from memory and every index, then
 *  persist. The caller is responsible for scrubbing the user's id out of games
 *  (unlink seats), follows, comments and reactions FIRST — this only deletes the
 *  account record itself. @param {string} userId @returns {boolean} */
export function deleteUser(userId) {
  const u = byId.get(userId);
  if (!u) return false;
  byId.delete(userId);
  if (handleIndex.get(u.handle.toLowerCase()) === userId) handleIndex.delete(u.handle.toLowerCase());
  if (u.provider && u.providerSub && providerIndex.get(`${u.provider}:${u.providerSub}`) === userId) {
    providerIndex.delete(`${u.provider}:${u.providerSub}`);
  }
  for (const lp of u.linkedProviders || []) {
    if (providerIndex.get(`${lp.provider}:${lp.sub}`) === userId) providerIndex.delete(`${lp.provider}:${lp.sub}`);
  }
  persist();
  console.log(`[user] deleted account @${u.handle} — ${byId.size} total`);
  return true;
}
