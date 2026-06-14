// Shared helpers for API routes.
import { sessionUid, verifyGameToken } from './auth.js';
import { getUser } from './users.js';
import { uid } from './store.js';
import { isFollowing } from './social.js';

/** @typedef {import('../types').Game} Game */
/** @typedef {import('../types').User} User */
/** @typedef {import('../types').Actor} Actor */
/** @typedef {import('../types').LogEntry} LogEntry */

/** Extract the logged-in user from the request, or null.
 * @param {Request} request @returns {User | null} */
export function sessionUser(request) {
  const cookie = request.headers.get('cookie') || '';
  const uidVal = sessionUid({ headers: { cookie } });
  return uidVal ? getUser(uidVal) : null;
}

/** Build an actor object from the request — signed-in user or anonymous device.
 * @param {Request} request @returns {Actor} */
export function actorOf(request) {
  const name = request.headers.get('x-actor-name');
  return {
    id: request.headers.get('x-actor-id') || 'anon',
    name: name ? decodeURIComponent(name).slice(0, 40) : 'Someone',
  };
}

/** Build actor from either session user or headers.
 * @param {Request} request @returns {Actor} */
export function getActor(request) {
  const su = sessionUser(request);
  if (su) return { id: 'user:' + su.id, name: su.displayName };
  return actorOf(request);
}

/** Create a log entry for the game's audit trail.
 * @param {Actor} actor @param {string} action @param {Record<string, unknown>} [extra] @returns {LogEntry} */
export function logEntry(actor, action, extra = {}) {
  return { id: uid(8), at: new Date().toISOString(), actorId: actor.id, actorName: actor.name, action, ...extra };
}

/** Are two users connected — i.e. does either follow the other? Used to gate
 *  auto-linking a seat to someone's account: a host can only attach the account
 *  of a person they have a follow relationship with.
 * @param {string} a @param {string} b @returns {boolean} */
export function areConnected(a, b) {
  if (!a || !b || a === b) return false;
  return isFollowing(a, b) || isFollowing(b, a);
}

/** Attach public profile info (handle) to seated players who have linked an
 *  account, so the client can highlight them and link straight to their profile.
 *  Returns a shallow copy — never mutates the stored game. Passes through a
 *  null/non-game value unchanged (callers may hand us a `mutate()` result).
 * @param {Game | null} game @returns {Game | null} */
export function withProfiles(game) {
  if (!game || !Array.isArray(game.players)) return game;
  return {
    ...game,
    players: game.players.map((p) => {
      if (!p.userId) return p;
      const u = getUser(p.userId);
      return u ? { ...p, handle: u.handle, displayName: u.displayName } : p;
    }),
  };
}

const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
/** A client-supplied id safe to use as an object key (no prototype pollution).
 * @param {unknown} v @returns {boolean} */
export const isSafeId = (v) => typeof v === 'string' && v.length > 0 && !RESERVED_KEYS.has(v);
/** @param {unknown} v @returns {number} */
export const num = (v) => (typeof v === 'number' ? v : Number(v));
/** Valid money: finite, ≥0, and either exactly 0 or ≥1 cent (rejects e.g. 0.003).
 * @param {unknown} v @returns {boolean} */
export const isMoney = (v) => { const n = num(v); return Number.isFinite(n) && n >= 0 && (n === 0 || Math.round(n * 100) >= 1); };

/** Is the requester the host of this game? Account owner, a valid signed host
 *  token, or — for legacy (pre-token) games only — the device that opened it.
 *  Never trusts a spoofable hostId/header for token-protected games.
 * @param {Game} g0 @param {Request} request @returns {boolean} */
export function isGameHost(g0, request) {
  if (!g0.hostId) return true;
  const su = sessionUser(request);
  if (su && g0.ownerId && g0.ownerId === su.id) return true;
  const hostToken = request.headers.get('x-host-token');
  if (hostToken && verifyGameToken(hostToken, g0.id)) return true;
  if (!g0.tokenedHost && g0.hostId === actorOf(request).id) return true;
  return false;
}
