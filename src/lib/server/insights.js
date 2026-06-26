// Derived feed insights — the leaderboard. Pure reads over the games list (no
// storage), so it recomputes live on each request.

import { computeSettlement } from '../engine/settle.js';
import { isRealGame } from '../engine/stats.js';

/** @typedef {import('../types').Game} Game */
/** @typedef {{ gameId: string, name: string, net: number, unit: string, at: string }} Result */

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
    if (!isRealGame(g)) continue; // abandoned/no-money tables never count (leaderboard + net math)
    const finished = g.status === 'ended' || g.status === 'settled';
    // Locked result: the game finished OR this seat already cashed out (its net
    // no longer depends on who's still in). Matches computeUserStats.
    const cashedOut = g.finalStacks != null && g.finalStacks[seat.id] != null;
    if (!finished && !cashedOut) continue;
    out.push({ gameId: g.id, name: g.name, net: netFor(g, seat.id), unit: g.unit || '€', at: g.settlement?.computedAt || g.updatedAt });
  }
  out.sort((a, b) => (a.at < b.at ? -1 : 1));
  return out;
}

/** All-time standings among `ids` — total profit and profit-per-game, ranked
 *  across everyone, so all nets are converted to a common currency (EUR). Games
 *  in a non-convertible unit (chips / big blinds / Bitcoin / custom) are left out
 *  of the ranking. Omitting `convert` falls back to 1:1 (the original behaviour).
 *  @param {Game[]} games @param {Iterable<string>} ids
 *  @param {(amount: number, from: string, to: string) => number | null} [convert]
 *  @returns {Array<{ id: string, net: number, games: number, avg: number }>} */
export function computeLeaderboard(games, ids, convert) {
  const conv = typeof convert === 'function' ? convert : (/** @type {number} */ amt) => amt;
  return [...ids]
    .map((id) => {
      const results = userResults(games, id);
      let netC = 0, n = 0;
      for (const r of results) {
        const eur = conv(r.net, r.unit, '€');
        if (eur == null) continue; // non-convertible game — can't rank it against others
        netC += Math.round(eur * 100);
        n++;
      }
      return { id, net: netC / 100, games: n, avg: n ? Math.round(netC / n) / 100 : 0 };
    })
    .filter((r) => r.games > 0)
    .sort((a, b) => b.net - a.net);
}
