// Shared helpers for API routes.
import { sessionUid, verifyGameToken } from './auth.js';
import { getUser, publicUser } from './users.js';
import { uid, allGames } from './store.js';
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

/** Privacy gate for a user's *detailed* profile data — stats and the
 *  follower/following lists. Like an Instagram private account: the profile is
 *  still findable in search and its follower COUNT stays visible (see the
 *  `social` endpoint), but the details are hidden. 'public' = anyone, 'members'
 *  = any signed-in user, 'private' = owner only.
 * @param {User} target @param {Request} request
 * @returns {{ status: number, error: string } | null} null when allowed */
export function privacyBlock(target, request) {
  const privacy = (target && target.privacy) || 'public';
  if (privacy === 'public') return null;
  const me = sessionUser(request);
  if (privacy === 'private' && me?.id !== target.id) return { status: 403, error: 'This profile is private.' };
  if (privacy === 'members' && !me) return { status: 403, error: 'Sign in to view this profile.' };
  return null;
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

/** A tagged error whose `status` the API layer maps to an HTTP code. Throw it
 *  from inside a mutate() closure to reject the mutation atomically — the store
 *  won't persist/broadcast a closure that throws, so re-checking invariants
 *  there (instead of before the await) closes the check-then-act race.
 * @param {number} status @param {string} message @returns {Error & {status:number}} */
export function httpError(status, message) {
  /** @type {any} */ const e = new Error(message); e.status = status; return e;
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

/** Everyone (by account id) who has shared a table with `userId` across all games. */
function coPlayers(userId) {
  const set = new Set();
  for (const g of allGames()) {
    const seats = g.players || [];
    if (!seats.some((p) => p.userId === userId)) continue;
    for (const p of seats) if (p.userId && p.userId !== userId) set.add(p.userId);
  }
  return set;
}

/** Social proof for a host deciding a join request: the people the REQUESTER has
 *  played with that the HOST has ALSO played with — i.e. mutual poker
 *  acquaintances. Only returned when the two have NEVER shared a table themselves
 *  (that's when the host needs a reason to trust a stranger); null otherwise, so
 *  the UI shows nothing. Requires both to be signed-in accounts.
 * @param {string} hostId @param {string} requesterId
 * @returns {{ count: number, users: Array<{handle:string, displayName:string}> } | null} */
export function mutualCoPlayers(hostId, requesterId) {
  if (!hostId || !requesterId || hostId === requesterId) return null;
  const hostCo = coPlayers(hostId);
  if (hostCo.has(requesterId)) return null; // they've already played together — no message
  const reqCo = coPlayers(requesterId);
  const users = [...reqCo]
    .filter((id) => id !== hostId && hostCo.has(id))
    .map((id) => publicUser(getUser(id)))
    .filter(Boolean)
    .map((u) => ({ handle: u.handle, displayName: u.displayName }));
  return users.length ? { count: users.length, users } : null;
}

/** Attach public profile info (handle) to seated players who have linked an
 *  account, so the client can highlight them and link straight to their profile.
 *  Returns a shallow copy — never mutates the stored game. Passes through a
 *  null/non-game value unchanged (callers may hand us a `mutate()` result).
 * @param {Game | null} game @returns {Game | null} */
export function withProfiles(game) {
  if (!game || !Array.isArray(game.players)) return game;
  // `acquisition` is the creator's private first-touch source (campaign tag /
  // referrer host / landing path) — for the admin dashboard only, never the
  // player-facing body. `joinRequests` is the host's private queue (it carries
  // other people's account ids + notes) — only the host sees it, via the
  // dedicated host-only endpoint. Strip both from everything served to
  // joiners/SSE. `visibility`/`city`/`maxPlayers` stay (they're not sensitive).
  const { acquisition, joinRequests, votes, ...safe } = game;
  // A public directory game's payload is served unauthenticated (its id is
  // published on /homegames), so never expose the coordination thread on one —
  // it's only written on private games, but strip defensively here too.
  if (safe.visibility === 'public') delete safe.messages;
  // Collapse votes from { category: { voterId: playerId } } to anonymous tallies
  // { category: { playerId: count } } so voter identities never leave the server.
  let voteTallies = undefined;
  if (votes && typeof votes === 'object') {
    voteTallies = {};
    for (const [cat, map] of Object.entries(votes)) {
      const tally = {};
      for (const pid of Object.values(/** @type {Record<string,string>} */ (map))) {
        tally[pid] = (tally[pid] || 0) + 1;
      }
      voteTallies[cat] = tally;
    }
  }
  const owner = safe.ownerId ? getUser(safe.ownerId) : null;
  return {
    ...safe,
    ...(voteTallies ? { voteTallies } : {}),
    ...(owner ? { ownerHandle: owner.handle, ownerName: owner.displayName, ownerAvatar: owner.avatar || null } : {}),
    players: safe.players.map((p) => {
      if (!p.userId) return p;
      const u = getUser(p.userId);
      return u ? { ...p, handle: u.handle, displayName: u.displayName } : p;
    }),
  };
}

/** May the requester see a game's full internals (money, audit log, chat)? True
 *  for a seated account, the game's owner, or a valid host-token holder. Used to
 *  gate PUBLIC games, whose id is published on /homegames — a private game's id is
 *  itself the secret, so this gate isn't applied there.
 * @param {any} game @param {Request} request @returns {boolean} */
export function isParticipant(game, request) {
  if (!game) return false;
  const su = sessionUser(request);
  if (su) {
    if ((game.players || []).some((p) => p.userId === su.id)) return true;
    if (game.ownerId && game.ownerId === su.id) return true;
  }
  const hostToken = request.headers.get('x-host-token');
  if (hostToken && verifyGameToken(hostToken, game.id)) return true;
  return false;
}

/** The discovery-only view of a PUBLIC game for a NON-participant: enough to decide
 *  whether to request a seat (name, city, blinds, seat count, roster) with the
 *  money and behavioural internals removed — no transactions, settlement, final
 *  stacks, audit log, receipts, or chat. This is what an anonymous visitor who
 *  found the game on /homegames is allowed to see.
 * @param {any} game @returns {any} */
export function publicPreview(game) {
  // withProfiles already strips joinRequests/acquisition, collapses votes, and
  // (for public games) removes chat messages.
  const g = withProfiles(game);
  const { transactions, finalStacks, settlement, receipts, log, ...safe } = g;
  return safe;
}

const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
/** A client-supplied id safe to use as an object key (no prototype pollution).
 * @param {unknown} v @returns {boolean} */
export const isSafeId = (v) => typeof v === 'string' && v.length > 0 && !RESERVED_KEYS.has(v);
/** @param {unknown} v @returns {number} */
export const num = (v) => (typeof v === 'number' ? v : Number(v));
/** Valid money: a number (or numeric string) that is finite, ≥0, and an exact
 *  number of whole cents — either 0 or ≥1 cent. Rejects sub-cent precision
 *  (e.g. 0.005, which would display as one cent but settle as another), plus
 *  empties/booleans/objects that `Number()` would silently coerce to 0.
 * @param {unknown} v @returns {boolean} */
export const isMoney = (v) => {
  if (v === '' || v == null || typeof v === 'boolean' || typeof v === 'object') return false;
  const n = num(v);
  if (!Number.isFinite(n) || n < 0) return false;
  // Domain cap: keep every accepted amount well inside exact integer-cent
  // precision (n*100 must stay < 2^53). 1e12 units is absurdly above any home
  // game yet leaves the cent math exact, so settlement sums never drift.
  if (n > 1e12) return false;
  const cents = n * 100;
  return Math.abs(cents - Math.round(cents)) < 1e-6 && (n === 0 || Math.round(cents) >= 1);
};

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
