// File-backed user accounts. Like the game store: one JSON file, held in memory,
// written through on change. Supports local (handle + PIN) accounts and OAuth
// accounts (Google now, Apple slot reserved) keyed by provider + subject id.

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const FILE = join(DATA_DIR, 'users.json');

const byId = new Map();
const handleIndex = new Map(); // lower(handle) -> id
const providerIndex = new Map(); // `${provider}:${sub}` -> id

function now() { return new Date().toISOString(); }
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
    console.error('[users] failed to load users.json:', err.message);
  }
  return byId.size;
}

function index(u) {
  byId.set(u.id, u);
  handleIndex.set(u.handle.toLowerCase(), u.id);
  if (u.provider && u.providerSub) providerIndex.set(`${u.provider}:${u.providerSub}`, u.id);
}

export function getUser(id) { return id ? byId.get(id) || null : null; }
export function getByHandle(handle) {
  return handle ? byId.get(handleIndex.get(normalizeHandle(handle))) || null : null;
}
export function getByProvider(provider, sub) {
  return byId.get(providerIndex.get(`${provider}:${sub}`)) || null;
}

// Public-safe view (never leak pinHash).
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

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
export function normalizeHandle(raw) {
  return String(raw || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
}
function uniqueHandle(base) {
  let h = normalizeHandle(base) || 'player';
  if (h.length < 3) h = (h + 'player').slice(0, 8);
  let candidate = h;
  let n = 0;
  while (handleIndex.has(candidate)) candidate = h + ++n;
  return candidate;
}

// ---- PIN hashing (scrypt) ----------------------------------------------------
function hashPin(pin) {
  const salt = randomBytes(16);
  const h = scryptSync(String(pin), salt, 32);
  return salt.toString('hex') + ':' + h.toString('hex');
}
function checkPin(pin, stored) {
  if (!stored) return false;
  const [s, h] = stored.split(':');
  const hb = Buffer.from(h, 'hex');
  const calc = scryptSync(String(pin), Buffer.from(s, 'hex'), 32);
  return calc.length === hb.length && timingSafeEqual(calc, hb);
}

// ---- account creation / auth -------------------------------------------------
export function createLocal({ handle, displayName, pin }) {
  const h = normalizeHandle(handle);
  if (!HANDLE_RE.test(h)) { const e = new Error('name must be 3–20 letters, numbers or _'); e.status = 400; throw e; }
  if (handleIndex.has(h)) { const e = new Error('that name is taken'); e.status = 409; throw e; }
  if (String(pin || '').length < 4) { const e = new Error('Passcode must be at least 4 characters'); e.status = 400; throw e; }
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

export function loginLocal({ handle, pin }) {
  const u = getByHandle(handle);
  if (!u || u.provider !== 'local' || !checkPin(pin, u.pinHash)) {
    const e = new Error('Wrong name or passcode'); e.status = 401; throw e;
  }
  return u;
}

// Find or create an OAuth-backed account.
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
export function updateProfile(userId, { name }) {
  const u = byId.get(userId);
  if (!u) { const e = new Error('not signed in'); e.status = 401; throw e; }
  const h = normalizeHandle(name);
  if (!HANDLE_RE.test(h)) { const e = new Error('name must be 3–20 letters, numbers or _'); e.status = 400; throw e; }
  const owner = handleIndex.get(h);
  if (owner && owner !== userId) { const e = new Error('that name is taken'); e.status = 409; throw e; }
  handleIndex.delete(u.handle.toLowerCase());
  u.handle = h;
  u.displayName = String(name).trim().slice(0, 40) || h;
  u.needsHandle = false;
  handleIndex.set(h, userId);
  persist();
  return u;
}
