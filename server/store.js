// File-backed game store. Each game is one JSON file under data/. Games are
// held in memory as the source of truth (Node's single thread makes each
// request handler's mutation atomic) and written through to disk after every
// change. Plenty for home-game scale; no database to operate.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

// Internal ids (players, transactions, log lines) use this alphabet.
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const games = new Map();
const listeners = new Set(); // (game) => void, fired after every change

function now() {
  return new Date().toISOString();
}

function uid(n = 8) {
  const bytes = randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return s;
}

// Human-friendly numeric game codes, e.g. "2137". Grows from 4 to 6 digits if
// the space ever gets crowded (far beyond any home-game need).
function gameCode() {
  for (const len of [4, 5, 6]) {
    const min = 10 ** (len - 1);
    const span = 9 * min;
    for (let i = 0; i < 400; i++) {
      const code = String(min + (randomBytes(4).readUInt32BE(0) % span));
      if (!games.has(code)) return code;
    }
  }
  let code;
  do {
    code = String(randomBytes(4).readUInt32BE(0));
  } while (games.has(code));
  return code;
}

// A custom code must be 3–6 digits and unused. Returns the normalized code or
// throws a tagged error the API layer turns into 409.
export function normalizeCustomCode(raw) {
  const code = String(raw).replace(/[^0-9]/g, '');
  if (code.length < 3 || code.length > 6) {
    const e = new Error('code must be 3–6 digits');
    e.status = 400;
    throw e;
  }
  if (games.has(code)) {
    const e = new Error('that code is already taken');
    e.status = 409;
    throw e;
  }
  return code;
}

function filePath(id) {
  return join(DATA_DIR, `${id}.json`);
}

function persist(game) {
  const tmp = filePath(game.id) + '.tmp';
  writeFileSync(tmp, JSON.stringify(game, null, 2));
  renameSync(tmp, filePath(game.id));
}

export function init() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  for (const f of readdirSync(DATA_DIR)) {
    if (!f.endsWith('.json') || f === 'users.json') continue;
    try {
      const game = JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8'));
      if (!Array.isArray(game.log)) game.log = []; // backfill older saves
      games.set(game.id, game);
    } catch (err) {
      // Skip a corrupt file rather than crash — but log it so an operator can
      // find and recover the game instead of it just vanishing silently.
      console.error(`[store] skipping unreadable game file ${f}: ${err.message}`);
    }
  }
  return games.size;
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function touched(game) {
  game.updatedAt = now();
  game.version = (game.version || 0) + 1;
  persist(game);
  for (const fn of listeners) fn(game);
  return game;
}

export function getGame(id) {
  return games.get(id) || null;
}

export function allGames() {
  return [...games.values()];
}

export function createGame({ name, unit, players, code }) {
  const id = code ? normalizeCustomCode(code) : gameCode();
  const game = {
    id,
    name: (name || 'Home Game').toString().slice(0, 80),
    unit: (unit || '€').toString().slice(0, 4),
    status: 'active',
    createdAt: now(),
    updatedAt: now(),
    version: 1,
    players: [],
    transactions: [],
    finalStacks: {},
    log: [],
  };
  for (const p of players || []) {
    if (p && p.name) game.players.push({ id: uid(6), name: String(p.name).slice(0, 40) });
  }
  games.set(id, game);
  persist(game);
  for (const fn of listeners) fn(game);
  return game;
}

/** Apply a mutation to a game, then version/persist/broadcast. Returns the game. */
export function mutate(id, fn) {
  const game = games.get(id);
  if (!game) return null;
  fn(game);
  return touched(game);
}

export { uid };
