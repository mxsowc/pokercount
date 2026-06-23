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
  const finishedResults = []; // {at, net, hours} for finished games, for curve/streak/hourly

  for (const g of games) {
    const seat = (g.players || []).find((p) => p.userId === userId);
    if (!seat) continue;
    totalGames++;

    const finished = g.status === 'ended' || g.status === 'settled';
    // Your result is locked the moment YOU cash out — net = your cash-out minus
    // your buy-in, independent of who's still playing or your podium place — so
    // it counts immediately, even while the game runs on. A seat with no final
    // stack yet (still in) has no result and stays "in progress".
    const cashedOut = !!seat && g.finalStacks != null && g.finalStacks[seat.id] != null;
    if (!finished && !cashedOut) {
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
    const hrs = g.hours && seat ? g.hours[seat.id] : null;
    finishedResults.push({ at: g.updatedAt, net, hours: typeof hrs === 'number' ? hrs : null });
  }

  recent.sort((a, b) => (a.at < b.at ? 1 : -1));

  // Oldest → newest for the running curve / streaks.
  finishedResults.sort((a, b) => (a.at < b.at ? -1 : 1));

  // Cumulative profit over time (a bankroll sparkline), accumulated in cents.
  let cumC = 0;
  const curve = finishedResults.map((r) => { cumC += Math.round(r.net * 100); return { at: r.at, cum: cumC / 100 }; });

  // Win/loss streaks. net 0 (break-even) is neutral and breaks a streak.
  const streak = streakOf(finishedResults.map((r) => r.net));

  // €/hr — ONLY from games where this user entered their hours. No hours = the
  // game isn't counted (we never assume a duration). null when none entered.
  let hNetC = 0, hHours = 0, hGames = 0;
  for (const r of finishedResults) {
    if (typeof r.hours === 'number' && r.hours > 0) { hNetC += Math.round(r.net * 100); hHours += r.hours; hGames++; }
  }
  const hourly = hHours > 0 ? { rate: round2((hNetC / 100) / hHours), hours: Math.round(hHours * 100) / 100, games: hGames } : null;

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
    curve,
    streak,
    hourly,
    recent: recent.slice(0, 30),
  };
}

/** Win/loss streaks from finished nets in chronological order.
 *  @param {number[]} nets @returns {{current:number, kind:'win'|'loss'|'none', longestWin:number, longestLoss:number}} */
function streakOf(nets) {
  let longestWin = 0, longestLoss = 0, runW = 0, runL = 0;
  for (const n of nets) {
    if (n > 0) { runW++; runL = 0; } else if (n < 0) { runL++; runW = 0; } else { runW = 0; runL = 0; }
    if (runW > longestWin) longestWin = runW;
    if (runL > longestLoss) longestLoss = runL;
  }
  let current = 0;
  /** @type {'win'|'loss'|'none'} */ let kind = 'none';
  for (let i = nets.length - 1; i >= 0; i--) {
    const n = nets[i];
    if (i === nets.length - 1) {
      if (n > 0) kind = 'win'; else if (n < 0) kind = 'loss'; else break;
      current = 1; continue;
    }
    if ((kind === 'win' && n > 0) || (kind === 'loss' && n < 0)) current++; else break;
  }
  return { current, kind, longestWin, longestLoss };
}
