// Aggregate a user's results across all their games. Pure and dependency-free.
//
// A "result" only counts once a game is ended/settled (final stacks are in and
// the books are frozen). Active games still count toward "games you have".

import { computeSettlement } from './settle.js';

const round2 = (/** @type {number} */ n) => Math.round(n * 100) / 100;

/**
 * @param {Array<import('../types').Game>} games  every game in the system
 * @param {string} userId
 */
export function computeUserStats(games, userId) {
  let totalGames = 0;
  let gamesPlayed = 0; // finished games
  let totalProfitC = 0; // accumulate in integer cents so many games can't drift a fractional cent
  let profitable = 0;
  let best = null;
  let worst = null;
  const recent = [];

  for (const g of games) {
    const seat = (g.players || []).find((p) => p.userId === userId);
    if (!seat) continue;
    totalGames++;

    const finished = g.status === 'ended' || g.status === 'settled';
    if (!finished) {
      // Still counts as a "home game" — show it as in-progress (no result yet).
      recent.push({ id: g.id, name: g.name, net: null, at: g.updatedAt, status: g.status });
      continue;
    }

    // Prefer the frozen snapshot taken when the game closed; else compute live.
    let net = null;
    if (g.settlement && Array.isArray(g.settlement.lines)) {
      const ln = g.settlement.lines.find((l) => l.playerId === seat.id);
      if (ln && ln.net != null) net = ln.net;
    }
    if (net == null) {
      const s = computeSettlement(g.players, g.transactions, g.finalStacks);
      const ln = s.lines.find((l) => l.playerId === seat.id);
      net = ln ? ln.net : 0;
    }

    gamesPlayed++;
    totalProfitC += Math.round(net * 100);
    if (net > 0) profitable++;
    if (!best || net > best.net) best = { id: g.id, name: g.name, net: round2(net) };
    if (!worst || net < worst.net) worst = { id: g.id, name: g.name, net: round2(net) };
    recent.push({ id: g.id, name: g.name, net: round2(net), at: g.updatedAt, status: g.status });
  }

  recent.sort((a, b) => (a.at < b.at ? 1 : -1));

  const totalProfit = totalProfitC / 100;
  return {
    totalGames,
    gamesPlayed,
    totalProfit: round2(totalProfit),
    avgProfit: gamesPlayed ? round2(totalProfit / gamesPlayed) : 0,
    profitable,
    profitablePct: gamesPlayed ? Math.round((profitable / gamesPlayed) * 100) : 0,
    best,
    worst,
    recent: recent.slice(0, 12),
  };
}
