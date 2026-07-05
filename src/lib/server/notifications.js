// Per-account in-app notifications (follows, reactions, comments, awards). Same
// file-backed pattern as reactions.js/social.js: an in-memory Map written through
// to one JSON file. Keyed by recipient userId → newest-first list, capped.

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { DATA_DIR } from './paths.js';
import { writeFileDurable } from './fsutil.js';
import { join } from 'node:path';

const FILE = join(DATA_DIR, 'notifications.json');
const CAP = 50; // keep the most recent N per user

/** @type {Map<string, any[]>} recipient userId -> notifications (newest first) */
const byUser = new Map();

function nid() { return randomBytes(6).toString('hex'); }

function persist() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  /** @type {Record<string, any[]>} */
  const obj = {};
  for (const [k, list] of byUser) if (list.length) obj[k] = list;
  writeFileDurable(FILE, JSON.stringify(obj, null, 2));
}

export function init() {
  if (!existsSync(FILE)) return 0;
  try {
    const data = JSON.parse(readFileSync(FILE, 'utf8'));
    for (const [k, list] of Object.entries(data)) if (Array.isArray(list)) byUser.set(k, list);
  } catch (err) {
    throw new Error(`[notifications] refusing to start: ${FILE} is unreadable (${err instanceof Error ? err.message : err}). Restore or remove it.`);
  }
  return byUser.size;
}

/** Add a notification for a recipient account. No-op if there's no recipient or
 *  the actor IS the recipient (don't notify yourself).
 * @param {string} userId recipient account id (unprefixed)
 * @param {{ type: string, actorId?: string, actorName?: string, actorHandle?: string|null, gameId?: string|null, gameCode?: string|null, text?: string }} n */
export function notify(userId, n) {
  if (!userId) return;
  const actorUserId = n.actorId?.startsWith('user:') ? n.actorId.slice(5) : null;
  if (actorUserId && actorUserId === userId) return;
  const list = byUser.get(userId) || [];
  list.unshift({
    id: nid(), type: n.type,
    actorName: n.actorName || 'Someone', actorHandle: n.actorHandle || null,
    gameId: n.gameId || null, gameCode: n.gameCode || null,
    text: n.text || '', at: new Date().toISOString(), read: false,
  });
  if (list.length > CAP) list.length = CAP;
  byUser.set(userId, list);
  persist();
}

/** @param {string} userId */
export function listNotifications(userId) { return byUser.get(userId) || []; }

/** @param {string} userId */
export function unreadCount(userId) { return (byUser.get(userId) || []).reduce((c, n) => c + (n.read ? 0 : 1), 0); }

/** Mark some (or all) of a user's notifications read. @param {string} userId @param {string[]} [ids] */
export function markRead(userId, ids) {
  const list = byUser.get(userId);
  if (!list) return;
  const only = ids && ids.length ? new Set(ids) : null;
  let changed = false;
  for (const n of list) if ((!only || only.has(n.id)) && !n.read) { n.read = true; changed = true; }
  if (changed) persist();
}

/** Drop a deleted account's notifications. @param {string} userId */
export function removeUser(userId) {
  if (byUser.delete(userId)) persist();
}
