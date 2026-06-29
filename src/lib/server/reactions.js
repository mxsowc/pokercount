// Reactions on feed results ("send a congratz"). Same file-backed pattern as
// social.js: in-memory Map, written through to one JSON file on every change.
//
// Keyed by `${gameId}:${playerId}` (a single player's result in one game) →
// { [reactorUserId]: emoji }. One reaction per user per result (toggle/switch).

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { DATA_DIR } from './paths.js';
import { writeFileDurable } from './fsutil.js';
import { join } from 'node:path';

const FILE = join(DATA_DIR, 'reactions.json');

/** @type {Map<string, Record<string, string>>} */
const reactions = new Map();

/** @param {string} gameId @param {string} playerId @returns {string} */
const keyOf = (gameId, playerId) => `${gameId}:${playerId}`;

function persist() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  /** @type {Record<string, Record<string, string>>} */
  const obj = {};
  for (const [k, m] of reactions) if (Object.keys(m).length) obj[k] = m;
  writeFileDurable(FILE, JSON.stringify(obj, null, 2));
}

export function init() {
  if (!existsSync(FILE)) return 0;
  try {
    const data = JSON.parse(readFileSync(FILE, 'utf8'));
    for (const [k, m] of Object.entries(data)) if (m && typeof m === 'object') reactions.set(k, m);
  } catch (err) {
    throw new Error(`[reactions] refusing to start: ${FILE} is unreadable (${err instanceof Error ? err.message : err}). Restore or remove it.`);
  }
  return reactions.size;
}

/** Toggle a user's reaction on a result: same emoji removes it, a different one
 *  switches it. @param {string} gameId @param {string} playerId @param {string} reactorId @param {string} emoji */
export function toggleReaction(gameId, playerId, reactorId, emoji) {
  const k = keyOf(gameId, playerId);
  let m = reactions.get(k);
  if (!m) { m = {}; reactions.set(k, m); }
  if (m[reactorId] === emoji) delete m[reactorId];
  else m[reactorId] = emoji;
  if (Object.keys(m).length === 0) reactions.delete(k);
  persist();
}

/** Counts per emoji for a result, plus the viewer's own reaction (or null).
 *  @param {string} gameId @param {string} playerId @param {string} [viewerId]
 *  @returns {{ counts: Record<string, number>, mine: string | null }} */
export function reactionSummary(gameId, playerId, viewerId) {
  const m = reactions.get(keyOf(gameId, playerId)) || {};
  /** @type {Record<string, number>} */
  const counts = {};
  for (const e of Object.values(m)) counts[e] = (counts[e] || 0) + 1;
  return { counts, mine: viewerId ? (m[viewerId] || null) : null };
}

/** Remove every reaction a (deleted) account left, across all results.
 *  @param {string} userId @returns {boolean} whether anything changed */
export function removeUser(userId) {
  let changed = false;
  for (const [k, m] of reactions) {
    if (m[userId] === undefined) continue;
    delete m[userId];
    if (Object.keys(m).length === 0) reactions.delete(k);
    changed = true;
  }
  if (changed) persist();
  return changed;
}
