// File-backed user accounts. Like the game store: one JSON file, held in memory,
// written through on change. Supports local (handle + PIN) accounts and OAuth
// accounts (Google now, Apple slot reserved) keyed by provider + subject id.

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

import { DATA_DIR } from "./paths.js";
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
  const tmp = FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify([...byId.values()], null, 2));
  renameSync(tmp, FILE);
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
}

/** @param {string | null | undefined} id @returns {User | null} */
export function getUser(id) { return id ? byId.get(id) || null : null; }
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
    needsHandle: !!u.needsHandle, // true until an OAuth user has chosen their name
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
/** @param {{ handle?: string, displayName?: string, pin?: string }} input @returns {User} */
export function createLocal({ handle, displayName, pin }) {
  const h = normalizeHandle(handle);
  if (!HANDLE_RE.test(h)) fail('name must be 3–20 letters, numbers or _', 400);
  if (handleIndex.has(h)) fail('that name is taken', 409);
  if (String(pin || '').length < 4) fail('Passcode must be at least 4 characters', 400);
  const u = {
    id: uid(),
    handle: h,
    displayName: String(displayName || h).trim().slice(0, 40) || h,
    provider: 'local',
    providerSub: null,
    pinHash: hashPin(pin),
    avatar: null,
    createdAt: now(),
  };
  index(u);
  persist();
  return u;
}

/** @param {{ handle?: string, pin?: string }} input @returns {User} */
export function loginLocal({ handle, pin }) {
  const u = getByHandle(handle);
  if (!u || u.provider !== 'local' || !checkPin(pin, u.pinHash)) fail('Wrong name or passcode', 401);
  return u;
}

// Find or create an OAuth-backed account.
/** @param {{ provider: string, sub: string, displayName?: string, avatar?: string|null, handleHint?: string }} input @returns {User} */
export function upsertOAuth({ provider, sub, displayName, avatar, handleHint }) {
  let u = getByProvider(provider, sub);
  if (u) {
    if (avatar && avatar !== u.avatar) { u.avatar = avatar; persist(); }
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
    needsHandle: true, // they get a suggested handle but choose their own on first sign-in
    createdAt: now(),
  };
  index(u);
  persist();
  return u;
}

// Change a user's name. The single name is both their display name and their
// (normalized, unique) handle — consistent with local signup. Editable any time.
/** @param {string} userId @param {{ name?: string }} input @returns {User} */
export function updateProfile(userId, { name }) {
  const u = byId.get(userId);
  if (!u) fail('not signed in', 401);
  const h = normalizeHandle(name);
  if (!HANDLE_RE.test(h)) fail('name must be 3–20 letters, numbers or _', 400);
  const owner = handleIndex.get(h);
  if (owner && owner !== userId) fail('that name is taken', 409);
  handleIndex.delete(u.handle.toLowerCase());
  u.handle = h;
  u.displayName = String(name).trim().slice(0, 40) || h;
  u.needsHandle = false;
  handleIndex.set(h, userId);
  persist();
  return u;
}
