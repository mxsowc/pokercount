// Aggregate a user's results across all their games. Pure and dependency-free.
//
// A "result" only counts once a game is ended/settled (final stacks are in and
// the books are frozen) or the moment YOU cash out. Active games still count
// toward "games you have".
//
// Games can be played in different currencies, so money stats are reported in the
// player's most-used *convertible* currency: every game's net is converted into
// it via the injected `convert` callback. Units with no exchange rate (chips, big
// blinds, Bitcoin, custom text) can't be folded into a money total — they're
// counted as `otherGames` and still listed (in their own unit), just left out of
// profit/avg/streak/curve. Omitting `convert` falls back to 1:1 (every unit
// convertible), preserving the original single-currency behaviour.

import { computeSettlement } from './settle.js';

const round2 = (/** @type {number} */ n) => Math.round(n * 100) / 100;

/** The one definition of a game that counts: a real table has at least two
 *  players AND at least one buy-in. Single-seat or no-money tables are abandoned
 *  setups / tests — they never count toward anyone's stats or the leaderboard,
 *  and the reaper deletes them after 24h (the exact complement of this rule). The
 *  stats engine, insights/leaderboard, the reaper, and the admin aggregates all
 *  share this predicate so "counted" never drifts between surfaces.
 * @param {{ players?: unknown[], transactions?: unknown[] }} g */
export function isRealGame(g) {
  return (g?.players?.length || 0) >= 2 && (g?.transactions?.length || 0) >= 1;
}

/**
 * @param {Array<import('../types').Game>} games  every game in the system
 * @param {string} userId
 * @param {(amount: number, from: string, to: string) => number | null} [convert]
 *        Convert `amount` from one unit symbol to another; null = not convertible.
 */
export function computeUserStats(games, userId, convert) {
  const conv = typeof convert === 'function' ? convert : (/** @type {number} */ amt) => amt;
  // A unit is "money" if it can convert to itself (i.e. we have a rate for it).
  const convertible = (/** @type {string} */ unit) => conv(1, unit, unit) != null;

  let totalGames = 0;
  /** @type {Array<{id:string,name:string,net:number|null,unit:string,at:string,status:string}>} */
  const recent = [];
  /** @type {Array<{id:string,name:string,unit:string,net:number,at:string,hours:number|null,status:string}>} */
  const finishedAll = [];

  for (const g of games) {
    const seat = (g.players || []).find((p) => p.userId === userId);
    if (!seat) continue;
    if (!isRealGame(g)) continue; // abandoned/no-money tables never count
    totalGames++;
    const unit = g.unit || '€';

    const finished = g.status === 'ended' || g.status === 'settled';
    // Your result is locked the moment YOU cash out — net = your cash-out minus
    // your buy-in, independent of who's still playing — so it counts immediately,
    // even while the game runs on. A seat with no final stack yet has no result.
    const cashedOut = !!seat && g.finalStacks != null && g.finalStacks[seat.id] != null;
    if (!finished && !cashedOut) {
      recent.push({ id: g.id, name: g.name, net: null, unit, at: g.updatedAt, status: g.status });
      continue;
    }

    // Net in the game's OWN unit: frozen snapshot if present, else live compute.
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
    const hrs = g.hours && seat ? g.hours[seat.id] : null;
    finishedAll.push({ id: g.id, name: g.name, unit, net, at: g.updatedAt, hours: typeof hrs === 'number' ? hrs : null, status: g.status });
  }

  // Report in the player's most-used convertible currency (default €).
  const displayUnit = pickDisplayUnit(finishedAll, convertible);

  let totalProfitC = 0; // integer cents so many games can't drift a fractional cent
  let profitable = 0, gamesPlayed = 0, otherGames = 0;
  let best = null, worst = null;
  /** @type {Array<{at:string, net:number, hours:number|null}>} */
  const moneyResults = []; // converted into displayUnit, for curve/streak/hourly

  for (const r of finishedAll) {
    const converted = conv(r.net, r.unit, displayUnit);
    if (converted == null) {
      // No exchange rate (chips / big blinds / Bitcoin / custom) — surfaced in the
      // games list in its own unit, but never mixed into the money total.
      otherGames++;
      recent.push({ id: r.id, name: r.name, net: round2(r.net), unit: r.unit, at: r.at, status: r.status });
      continue;
    }
    gamesPlayed++;
    totalProfitC += Math.round(converted * 100);
    if (converted > 0) profitable++;
    if (!best || converted > best.net) best = { id: r.id, name: r.name, net: round2(converted) };
    if (!worst || converted < worst.net) worst = { id: r.id, name: r.name, net: round2(converted) };
    recent.push({ id: r.id, name: r.name, net: round2(converted), unit: displayUnit, at: r.at, status: r.status });
    moneyResults.push({ at: r.at, net: converted, hours: r.hours });
  }

  recent.sort((a, b) => (a.at < b.at ? 1 : -1));
  // Oldest → newest for the running curve / streaks.
  moneyResults.sort((a, b) => (a.at < b.at ? -1 : 1));

  // Cumulative profit over time (a bankroll sparkline), accumulated in cents.
  let cumC = 0;
  const curve = moneyResults.map((r) => { cumC += Math.round(r.net * 100); return { at: r.at, cum: cumC / 100 }; });

  // Win/loss streaks. net 0 (break-even) is neutral and breaks a streak.
  const streak = streakOf(moneyResults.map((r) => r.net));

  // currency/hr — ONLY from games where this user entered their hours. No hours =
  // the game isn't counted (we never assume a duration). null when none entered.
  let hNetC = 0, hHours = 0, hGames = 0;
  for (const r of moneyResults) {
    if (typeof r.hours === 'number' && r.hours > 0) { hNetC += Math.round(r.net * 100); hHours += r.hours; hGames++; }
  }
  const hourly = hHours > 0 ? { rate: round2((hNetC / 100) / hHours), hours: Math.round(hHours * 100) / 100, games: hGames } : null;

  const totalProfit = totalProfitC / 100;
  return {
    unit: displayUnit,
    totalGames,
    gamesPlayed,
    otherGames,
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

/** The currency to report stats in: the most-used convertible unit (ties broken
 *  by most recent), defaulting to € when the player has no money games.
 *  @param {Array<{unit:string, at:string}>} results
 *  @param {(unit:string)=>boolean} convertible @returns {string} */
function pickDisplayUnit(results, convertible) {
  /** @type {Map<string, number>} */ const counts = new Map();
  /** @type {Map<string, string>} */ const lastAt = new Map();
  for (const r of results) {
    if (!convertible(r.unit)) continue;
    counts.set(r.unit, (counts.get(r.unit) || 0) + 1);
    const prev = lastAt.get(r.unit);
    if (prev == null || r.at > prev) lastAt.set(r.unit, r.at);
  }
  let bestUnit = '€', bestCount = -1, bestAt = '';
  for (const [unit, count] of counts) {
    const at = lastAt.get(unit) || '';
    if (count > bestCount || (count === bestCount && at > bestAt)) { bestUnit = unit; bestCount = count; bestAt = at; }
  }
  return bestUnit;
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
