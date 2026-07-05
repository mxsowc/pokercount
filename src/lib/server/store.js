// File-backed game store. Each game is one JSON file under data/. Games are
// held in memory as the source of truth (Node's single thread makes each
// request handler's mutation atomic) and written through to disk after every
// change. Plenty for home-game scale; no database to operate.

import { readFileSync, readdirSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// Overridable so tests (and alternate deployments) can point at an isolated dir.
import { DATA_DIR } from "./paths.js";
import { writeFileDurable } from "./fsutil.js";
import { join } from "node:path";
// Relative (not $lib) so this module loads under plain `node --test` too — the
// engine modules use relative imports for the same reason. Vite resolves both.
import { computeSettlement } from '../engine/settle.js';
import { isRealGame } from '../engine/stats.js';

/** @typedef {import('../types').Game} Game */
/** @typedef {import('../types').NewGameInput} NewGameInput */
/** @typedef {import('../types').HttpError} HttpError */

// Internal ids (players, transactions, log lines) use this alphabet.
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Games are keyed by an IMMUTABLE internal id (never shown to users). The
// human-facing 4–6 digit `code` is a separate, REUSABLE index: only one active
// game holds a given code at a time, and the code is released the moment the
// game closes — so a brand-new game can take #2137 again without touching the
// old one. A shared link carries the internal id, so a weeks-old link always
// resolves to its own game even after its code was recycled.
/** @type {Map<string, Game>} internalId -> game */
const games = new Map();
/** @type {Map<string, string>} active human code -> internalId */
const codeToId = new Map();
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
/** A code is taken only while an ACTIVE game holds it. Finished games release
 *  their code (the game itself lives on under its internal id), so the code is
 *  free to reuse without clobbering anything.
 * @param {string} code */
function isCodeTaken(code) {
  return codeToId.has(code);
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
  writeFileDurable(filePath(game.id), JSON.stringify(game, null, 2));
}

// Sidecar JSON files that live alongside the per-game files in DATA_DIR but are
// NOT games. They must never be parsed as games (doing so created a "ghost" game
// with id=undefined that couldn't be opened or deleted, re-stamped every boot).
const NON_GAME_FILES = new Set(['users.json', 'follows.json', 'reactions.json', 'comments.json', 'fx-rates.json', 'interest.json', 'series-meta.json', 'last-backup.json']);

export function init() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  for (const f of readdirSync(DATA_DIR)) {
    if (!f.endsWith('.json') || NON_GAME_FILES.has(f)) continue;
    try {
      const game = JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8'));
      // Only ingest objects that are actually games. A sidecar file, an empty {},
      // or a half-written/corrupt file must never surface as a blank ghost game —
      // a real game always has a string id, a players array, and a known status.
      if (!game || typeof game.id !== 'string' || !Array.isArray(game.players) ||
          !['active', 'ended', 'settled'].includes(game.status)) {
        console.error(`[store] skipping non-game/malformed file ${f}`);
        continue;
      }
      if (!Array.isArray(game.log)) game.log = []; // backfill older saves
      // Legacy games predate the id/code split — their id WAS the human code.
      if (!game.code) game.code = game.id;
      // Reaping is age-based AND now destructive (deletes abandoned games), so a
      // file missing createdAt must not read as age=NaN (→ treated as infinitely
      // old → reaped). Fall back to updatedAt, else treat it as new.
      if (!game.createdAt) game.createdAt = game.updatedAt || now();
      // …and a file missing updatedAt must not sort as "newest" in recency lists
      // (e.g. profile "your games"). Fall back to createdAt.
      if (!game.updatedAt) game.updatedAt = game.createdAt;
      games.set(game.id, game);
      // Only an active game owns its code (for join-by-code + uniqueness).
      if (game.status === 'active' && !codeToId.has(game.code)) codeToId.set(game.code, game.id);
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

/** Keep the code index in sync with the game's status: an active game owns its
 *  code; a closed one releases it (so it can be reused). On reopen, if the code
 *  is still free it's reclaimed; if a newer game grabbed it meanwhile, a fresh
 *  unique code is minted so the reopened game stays reachable by code. */
/** @param {Game} game */
function syncCodeIndex(game) {
  if (!game.code) return;
  if (game.status === 'active') {
    const owner = codeToId.get(game.code);
    if (owner === game.id) return;                  // already owns its code
    if (owner === undefined) { codeToId.set(game.code, game.id); return; } // free → claim
    // Conflict: while this game was closed its (reusable) code was taken by a
    // different active game. Reopening as-is would leave it unreachable by code
    // (two active games sharing one code). Mint a fresh unique code instead.
    game.code = gameCode();
    codeToId.set(game.code, game.id);
  } else if (codeToId.get(game.code) === game.id) {
    codeToId.delete(game.code);
  }
}

/** Cap the per-game audit log: it's rewritten in full on every mutation (and sent
 *  to every SSE subscriber), so an unbounded log makes each write/frame grow
 *  without limit. Keep a generous recent window — far more than any real night. */
const MAX_LOG = 1000;

/** @param {Game} game @returns {Game} */
function touched(game) {
  game.updatedAt = now();
  game.version = (game.version || 0) + 1;
  if (Array.isArray(game.log) && game.log.length > MAX_LOG) game.log = game.log.slice(-MAX_LOG);
  syncCodeIndex(game);
  persist(game);
  for (const fn of listeners) { try { fn(game); } catch (err) { console.error('[store] listener error:', err); } }
  return game;
}

/** Permanently remove a game: drop it from memory, release its code, delete the
 *  file, and notify listeners (so open SSE streams can bounce viewers home).
 *  Used to clean up empty/abandoned games — see the DELETE route's guard.
 * @param {string} idOrCode @returns {boolean} whether a game was deleted */
export function deleteGame(idOrCode) {
  const game = getGame(idOrCode);
  if (!game) return false;
  games.delete(game.id);
  if (codeToId.get(game.code) === game.id) codeToId.delete(game.code);
  try { rmSync(filePath(game.id), { force: true }); }
  catch (err) { console.error('[store] failed to delete game file:', err); }
  for (const fn of listeners) {
    try { fn({ id: game.id, _deleted: true }); } catch (err) { console.error('[store] listener error:', err); }
  }
  return true;
}

/** Sever a (deleted) account from every game without destroying any history: the
 *  seats they held keep their name, buy-ins and results — they just lose their
 *  `userId`, so there's no longer a profile to click through to from the game.
 *  Also clears their ownership marker and any "hardest to read" votes they cast.
 *  Games other people played are untouched. @param {string} userId
 *  @returns {number} games changed */
export function unlinkUser(userId) {
  if (!userId) return 0;
  let changed = 0;
  for (const g of games.values()) {
    let dirty = false;
    for (const p of g.players || []) {
      if (p.userId === userId) { delete p.userId; dirty = true; }
    }
    if (g.ownerId === userId) { delete g.ownerId; dirty = true; }
    // Drop any award votes this user cast, across every category.
    for (const map of Object.values(g.votes || {})) {
      if (map && map[userId] !== undefined) { delete map[userId]; dirty = true; }
    }
    if (dirty) { touched(g); changed++; }
  }
  if (changed > 0) console.log(`[store] unlinked deleted user from ${changed} game(s)`);
  return changed;
}

/** Look up by internal id (e.g. a shared link) OR by human code (e.g. typed to
 *  join). A code resolves to the game CURRENTLY holding it; if none is active
 *  (the game closed and released its code), it falls back to the most-recent
 *  game that held that code — so a shared code link to a FINISHED game still
 *  opens instead of 404ing. The active map always wins, so a recycled code can
 *  never shadow the live game. The fallback scan runs only on that miss path.
 * @param {string} idOrCode @returns {Game | null} */
export function getGame(idOrCode) {
  if (!idOrCode) return null;
  const direct = games.get(idOrCode);
  if (direct) return direct;
  const activeId = codeToId.get(idOrCode);
  if (activeId) return games.get(activeId) || null;
  let best = null;
  for (const g of games.values()) {
    if (g.code === idOrCode && (!best || String(g.updatedAt) > String(best.updatedAt))) best = g;
  }
  return best;
}

/** @returns {Game[]} */
export function allGames() {
  return [...games.values()];
}

/** @param {NewGameInput} input @returns {Game} */
export function createGame({ name, unit, players, code, defaultBuyIn, series }) {
  const humanCode = code ? normalizeCustomCode(code) : gameCode();
  // Internal id: unguessable, immutable, never shown. Shared links use this, so
  // they keep pointing at THIS game even after `humanCode` is recycled later.
  // Uppercase 'G' + uppercase-alphabet uid, so the routes' params.id.toUpperCase()
  // is a no-op and the key always matches. Letter prefix marks it as an internal
  // id (vs a numeric human code).
  let id;
  do { id = 'G' + uid(11); } while (games.has(id));
  /** @type {Game} */
  const game = {
    id,
    code: humanCode,
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
  const db = Number(defaultBuyIn);
  if (Number.isFinite(db) && db > 0) game.defaultBuyIn = Math.round(db * 100) / 100;
  if (series != null && String(series).trim()) game.series = String(series).trim().slice(0, 60);
  for (const p of players || []) {
    const nm = p && p.name != null ? String(p.name).trim() : '';
    if (nm) game.players.push({ id: uid(6), name: nm.slice(0, 40) });
  }
  games.set(id, game);
  codeToId.set(humanCode, id);
  persist(game);
  for (const fn of listeners) { try { fn(game); } catch (err) { console.error('[store] listener error:', err); } }
  return game;
}

/** Apply a mutation to a game, then version/persist/broadcast. Returns the game.
 * @param {string} idOrCode @param {(game: Game) => void} fn @returns {Game | null} */
export function mutate(idOrCode, fn) {
  const game = getGame(idOrCode); // resolve internal id OR human code (e.g. join-by-code)
  if (!game) return null;
  fn(game);
  return touched(game);
}

const STALE_MS = 24 * 60 * 60 * 1000;     // 24h — abandoned-game DELETION window (by createdAt)
const INACTIVE_MS = 12 * 60 * 60 * 1000;  // 12h — auto-CLOSE an active game after this much silence

/** Compute and freeze a game's settlement, flip it to ended/settled, and append a
 *  log line. Mutates `g` in place; the CALLER persists (via mutate()/touched()).
 *  Shared by the all-cashed-out auto-close (the /final route) and the inactivity
 *  reaper, so both produce exactly the settlement the manual "Lock in" does.
 *  @param {Game} g @param {{ actorId?: string, actorName?: string, action?: string }} [by]
 *  @returns {Game} */
export function settleAndClose(g, by = {}) {
  const s = computeSettlement(g.players, g.transactions, g.finalStacks);
  g.settlement = {
    computedAt: now(),
    lines: s.lines,
    transfers: s.transfers.map((t) => ({ id: uid(8), ...t, paid: false, paidAt: null, paidBy: null })),
    totalInvested: s.totalInvested, totalFinal: s.totalFinal,
    discrepancy: s.discrepancy, balanced: s.balanced,
  };
  g.status = (s.balanced && s.transfers.length === 0) ? 'settled' : 'ended';
  g.log.push({
    id: uid(8), at: now(),
    actorId: by.actorId || 'system', actorName: by.actorName || 'potcount',
    action: by.action || 'auto_close', detail: {},
  });
  return g;
}

/** Auto-close any active game that's gone SILENT for over 12 hours — a table
 *  someone opened and forgot to lock in. Any activity (buy-in, cash-out, edit)
 *  bumps updatedAt and resets the clock, so a live game is never closed under
 *  anyone. @returns {number} count of games auto-closed */
export function reapStaleGames() {
  const cutoff = Date.now() - INACTIVE_MS;
  let closed = 0;
  for (const g of games.values()) {
    if (g.status !== 'active') continue;
    if (new Date(g.updatedAt || g.createdAt).getTime() > cutoff) continue; // active recently
    settleAndClose(g, { action: 'auto_close' });
    touched(g);
    closed++;
  }
  if (closed > 0) console.log(`[store] auto-closed ${closed} inactive game(s)`);
  return closed;
}

/** Hard-delete games that never became real and are now stale: created over 24
 *  hours ago and NOT a real table (fewer than 2 players, or fewer than 2 buy-ins) —
 *  exactly the complement of isRealGame, the same games the stats engine refuses
 *  to count. These are abandoned setups / test tables with no settlement history
 *  worth keeping — the same "empty game is disposable" rule the DELETE route
 *  enforces by hand, applied automatically once they've aged out. A real game
 *  (2+ players AND 2+ buy-ins) is left alone; reapStaleGames just closes it.
 *  @returns {number} count of games deleted */
export function reapAbandonedGames() {
  const cutoff = Date.now() - STALE_MS;
  let deleted = 0;
  // Snapshot first: deleteGame() mutates the games map as we go.
  for (const g of [...games.values()]) {
    if (new Date(g.createdAt).getTime() > cutoff) continue; // not old enough yet
    if (isRealGame(g)) continue; // a real table has history — never auto-delete it
    if (deleteGame(g.id)) deleted++;
  }
  if (deleted > 0) console.log(`[store] deleted ${deleted} abandoned game(s)`);
  return deleted;
}

export { uid };
