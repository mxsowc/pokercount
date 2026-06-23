// Derived feed insights — the leaderboard. Pure reads over the games list (no
// storage), so it recomputes live on each request.

import { computeSettlement } from '../engine/settle.js';

/** @typedef {import('../types').Game} Game */
/** @typedef {{ gameId: string, name: string, net: number, at: string }} Result */

/** Net for a seat in a finished game (frozen snapshot, else computed live).
 *  @param {Game} g @param {string} seatId @returns {number} */
export function netFor(g, seatId) {
  if (g.settlement?.lines) {
    const ln = g.settlement.lines.find((l) => l.playerId === seatId);
    if (ln && ln.net != null) return ln.net;
  }
  const s = computeSettlement(g.players, g.transactions, g.finalStacks);
  const ln = s.lines.find((l) => l.playerId === seatId);
  return ln ? ln.net : 0;
}

/** A user's finished results, oldest → newest.
 *  @param {Game[]} games @param {string} userId @returns {Result[]} */
export function userResults(games, userId) {
  /** @type {Result[]} */
  const out = [];
  for (const g of games) {
    const seat = (g.players || []).find((p) => p.userId === userId);
    if (!seat) continue;
    const finished = g.status === 'ended' || g.status === 'settled';
    // Locked result: the game finished OR this seat already cashed out (its net
    // no longer depends on who's still in). Matches computeUserStats.
    const cashedOut = g.finalStacks != null && g.finalStacks[seat.id] != null;
    if (!finished && !cashedOut) continue;
    out.push({ gameId: g.id, name: g.name, net: netFor(g, seat.id), at: g.settlement?.computedAt || g.updatedAt });
  }
  out.sort((a, b) => (a.at < b.at ? -1 : 1));
  return out;
}

/** All-time standings among `ids` — total profit and profit-per-game. Sorted by
 *  total (the client can re-sort by average).
 *  @param {Game[]} games @param {Iterable<string>} ids
 *  @returns {Array<{ id: string, net: number, games: number, avg: number }>} */
export function computeLeaderboard(games, ids) {
  return [...ids]
    .map((id) => {
      const results = userResults(games, id);
      const netC = results.reduce((s, r) => s + Math.round(r.net * 100), 0);
      const n = results.length;
      return { id, net: netC / 100, games: n, avg: n ? Math.round(netC / n) / 100 : 0 };
    })
    .filter((r) => r.games > 0)
    .sort((a, b) => b.net - a.net);
}
