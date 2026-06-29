// Comments on feed results. Same file-backed pattern as reactions/social: an
// in-memory Map written through to one JSON file. Keyed by `${gameId}:${playerId}`
// → ordered array of { id, userId, text, at }.

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { DATA_DIR } from './paths.js';
import { writeFileDurable } from './fsutil.js';
import { join } from 'node:path';

const FILE = join(DATA_DIR, 'comments.json');
const MAX_LEN = 280;

/** @typedef {{ id: string, userId: string, text: string, at: string }} Comment */
/** @type {Map<string, Comment[]>} */
const comments = new Map();

/** @param {string} gameId @param {string} playerId */
const keyOf = (gameId, playerId) => `${gameId}:${playerId}`;
const cid = () => randomBytes(6).toString('hex');

function persist() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  /** @type {Record<string, Comment[]>} */
  const obj = {};
  for (const [k, arr] of comments) if (arr.length) obj[k] = arr;
  writeFileDurable(FILE, JSON.stringify(obj, null, 2));
}

export function init() {
  if (!existsSync(FILE)) return 0;
  try {
    const data = JSON.parse(readFileSync(FILE, 'utf8'));
    for (const [k, arr] of Object.entries(data)) if (Array.isArray(arr)) comments.set(k, arr);
  } catch (err) {
    throw new Error(`[comments] refusing to start: ${FILE} is unreadable (${err instanceof Error ? err.message : err}). Restore or remove it.`);
  }
  return comments.size;
}

/** Add a comment. Returns it, or null if the text is empty.
 *  @param {string} gameId @param {string} playerId @param {string} userId @param {string} text
 *  @returns {Comment | null} */
export function addComment(gameId, playerId, userId, text) {
  const t = String(text || '').trim().slice(0, MAX_LEN);
  if (!t) return null;
  const k = keyOf(gameId, playerId);
  let arr = comments.get(k);
  if (!arr) { arr = []; comments.set(k, arr); }
  /** @type {Comment} */
  const c = { id: cid(), userId, text: t, at: new Date().toISOString() };
  arr.push(c);
  persist();
  return c;
}

/** @param {string} gameId @param {string} playerId @returns {Comment[]} */
export function getComments(gameId, playerId) {
  return comments.get(keyOf(gameId, playerId)) || [];
}

/** Remove every comment a (deleted) account authored, across all results.
 *  @param {string} userId @returns {boolean} whether anything changed */
export function removeUser(userId) {
  let changed = false;
  for (const [k, arr] of comments) {
    const kept = arr.filter((c) => c.userId !== userId);
    if (kept.length === arr.length) continue;
    if (kept.length) comments.set(k, kept); else comments.delete(k);
    changed = true;
  }
  if (changed) persist();
  return changed;
}
