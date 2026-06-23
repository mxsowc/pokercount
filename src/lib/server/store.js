// File-backed game store. Each game is one JSON file under data/. Games are
// held in memory as the source of truth (Node's single thread makes each
// request handler's mutation atomic) and written through to disk after every
// change. Plenty for home-game scale; no database to operate.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// Overridable so tests (and alternate deployments) can point at an isolated dir.
import { DATA_DIR } from "./paths.js";
import { join } from "node:path";
import { computeSettlement } from '$lib/engine/settle.js';

/** @typedef {import('../types').Game} Game */
/** @typedef {import('../types').NewGameInput} NewGameInput */
/** @typedef {import('../types').HttpError} HttpError */

// Internal ids (players, transactions, log lines) use this alphabet.
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** @type {Map<string, Game>} */
const games = new Map();
/** @type {Set<(game: Game) => void>} */
const listeners = new Set(); // fired after every change

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
/** @param {string} code */
function isCodeTaken(code) {
  const g = games.get(code);
  return g != null && g.status === 'active';
}

function gameCode() {
  for (const len of [4, 5, 6]) {
    const min = 10 ** (len - 1);
    const span = 9 * min;
    for (let i = 0; i < 400; i++) {
      const code = String(min + (randomBytes(4).readUInt32BE(0) % span));
      if (!isCodeTaken(code)) return code;
    }
  }
  let code;
  do {
    code = String(randomBytes(4).readUInt32BE(0));
  } while (isCodeTaken(code));
  return code;
}

// A custom code must be 3–6 digits and unused. Returns the normalized code or
// throws a tagged error the API layer turns into 409.
/** @param {string} raw @returns {string} */
export function normalizeCustomCode(raw) {
  const code = String(raw).replace(/[^0-9]/g, '');
  if (code.length < 3 || code.length > 6) {
    /** @type {HttpError} */ const e = new Error('code must be 3–6 digits');
    e.status = 400;
    throw e;
  }
  if (isCodeTaken(code)) {
    /** @type {HttpError} */ const e = new Error('that code is already taken');
    e.status = 409;
    throw e;
  }
  return code;
}

/** @param {string} id @returns {string} */
function filePath(id) {
  return join(DATA_DIR, `${id}.json`);
}

/** @param {Game} game */
function persist(game) {
  const tmp = filePath(game.id) + '.tmp';
  writeFileSync(tmp, JSON.stringify(game, null, 2));
  renameSync(tmp, filePath(game.id));
}

export function init() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  for (const f of readdirSync(DATA_DIR)) {
    if (!f.endsWith('.json') || f === 'users.json' || f === 'follows.json') continue;
    try {
      const game = JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8'));
      if (!Array.isArray(game.log)) game.log = []; // backfill older saves
      games.set(game.id, game);
    } catch (err) {
      // Skip a corrupt file rather than crash — but log it so an operator can
      // find and recover the game instead of it just vanishing silently.
      console.error(`[store] skipping unreadable game file ${f}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return games.size;
}

/** @param {(game: Game) => void} fn @returns {() => void} */
export function onChange(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** @param {Game} game @returns {Game} */
function touched(game) {
  game.updatedAt = now();
  game.version = (game.version || 0) + 1;
  persist(game);
  for (const fn of listeners) fn(game);
  return game;
}

/** @param {string} id @returns {Game | null} */
export function getGame(id) {
  return games.get(id) || null;
}

/** @returns {Game[]} */
export function allGames() {
  return [...games.values()];
}

/** @param {NewGameInput} input @returns {Game} */
export function createGame({ name, unit, players, code }) {
  const id = code ? normalizeCustomCode(code) : gameCode();
  /** @type {Game} */
  const game = {
    id,
    name: (name || 'Home Game').toString().slice(0, 80),
    unit: (unit || '€').toString().slice(0, 16), // allow words like "chips" / "big blinds"
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
    const nm = p && p.name != null ? String(p.name).trim() : '';
    if (nm) game.players.push({ id: uid(6), name: nm.slice(0, 40) });
  }
  games.set(id, game);
  persist(game);
  for (const fn of listeners) fn(game);
  return game;
}

/** Apply a mutation to a game, then version/persist/broadcast. Returns the game.
 * @param {string} id @param {(game: Game) => void} fn @returns {Game | null} */
export function mutate(id, fn) {
  const game = games.get(id);
  if (!game) return null;
  fn(game);
  return touched(game);
}

const STALE_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Close any active game whose createdAt is older than 24 hours.
 *  @returns {number} count of games auto-closed */
export function reapStaleGames() {
  const cutoff = Date.now() - STALE_MS;
  let closed = 0;
  for (const g of games.values()) {
    if (g.status !== 'active') continue;
    if (new Date(g.createdAt).getTime() > cutoff) continue;

    const s = computeSettlement(g.players, g.transactions, g.finalStacks);
    g.settlement = {
      computedAt: new Date().toISOString(),
      lines: s.lines,
      transfers: s.transfers.map(t => ({ id: uid(8), ...t, paid: false, paidAt: null, paidBy: null })),
      totalInvested: s.totalInvested, totalFinal: s.totalFinal,
      discrepancy: s.discrepancy, balanced: s.balanced,
    };
    g.status = (s.balanced && s.transfers.length === 0) ? 'settled' : 'ended';
    g.log.push({
      id: uid(8), at: new Date().toISOString(),
      actorId: 'system', actorName: 'potcount',
      action: 'auto_close', detail: {},
    });
    touched(g);
    closed++;
  }
  if (closed > 0) console.log(`[store] auto-closed ${closed} stale game(s)`);
  return closed;
}

export { uid };
