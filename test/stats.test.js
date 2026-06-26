// Tests for user-profile stats (engine/stats.js) and the leaderboard/insights
// aggregation (server/insights.js). Pure functions over a games array.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeUserStats } from '../src/lib/engine/stats.js';
import { userResults, computeLeaderboard } from '../src/lib/server/insights.js';

// Build a game where `seatNets` maps userId -> {buyin, final}. Each player buys in
// once and cashes out `final`; status defaults to ended.
let seq = 0;
/** @param {Record<string, {buyin:number, final:number|null, hours?:number}>} seatNets */
function game(seatNets, { status = 'ended', frozen = false } = {}) {
  const id = 'G' + (++seq);
  const players = Object.keys(seatNets).map((uid, i) => ({ id: 'p' + i, name: uid, userId: uid }));
  const transactions = players.map((p) => ({ id: 't' + p.id, playerId: p.id, amount: seatNets[p.userId].buyin, type: 'buyin' }));
  const finalStacks = /** @type {Record<string, number>} */ ({});
  const hours = /** @type {Record<string, number>} */ ({});
  for (const p of players) {
    // final === null/undefined means "still in" — no final stack recorded yet.
    const fin = seatNets[p.userId].final;
    if (fin != null) finalStacks[p.id] = fin;
    const h = seatNets[p.userId].hours;
    if (h != null) hours[p.id] = h;
  }
  /** @type {any} */
  const g = { id, name: id, status, updatedAt: '2024-01-' + String(10 + seq).padStart(2, '0'), players, transactions, finalStacks };
  if (Object.keys(hours).length) g.hours = hours;
  if (frozen) {
    g.settlement = { lines: players.filter((p) => seatNets[p.userId].final != null).map((p) => ({ playerId: p.id, net: (seatNets[p.userId].final ?? 0) - seatNets[p.userId].buyin })) };
  }
  return g;
}

test('empty / no games', () => {
  const s = computeUserStats([], 'u');
  assert.equal(s.totalGames, 0);
  assert.equal(s.gamesPlayed, 0);
  assert.equal(s.totalProfit, 0);
  assert.equal(s.avgProfit, 0);
  assert.equal(s.profitablePct, 0);
  assert.equal(s.best, null);
  assert.equal(s.worst, null);
});

test('active real game with no cash-out yet: counts as a game but no result', () => {
  // a real table (2 seats, buy-ins in) that is still running — no one cashed out
  const games = [game({ u: { buyin: 20, final: null }, opp: { buyin: 20, final: null } }, { status: 'active' })];
  const s = computeUserStats(games, 'u');
  assert.equal(s.totalGames, 1);
  assert.equal(s.gamesPlayed, 0, 'still in → no locked result');
  assert.equal(s.avgProfit, 0);
  assert.equal(s.recent[0].net, null, 'shows in-progress (null net)');
});

test('abandoned tables never count: single-seat or no-buy-in games are excluded', () => {
  // A single seat is not a real game — even with a buy-in (settlement would be
  // meaningless against no opponent). Excluded entirely, even when "finished".
  const solo = computeUserStats([game({ u: { buyin: 20, final: 20 } })], 'u');
  assert.equal(solo.totalGames, 0, 'one seat → not a counted game');
  assert.equal(solo.gamesPlayed, 0);
  assert.equal(solo.recent.length, 0);

  // 2+ seats but ZERO buy-ins — e.g. an empty table the reaper auto-closed before
  // the abandoned-game delete ran, or any close path. No money ever moved, so it
  // must not pollute games-played, win-rate, streaks, or the leaderboard.
  const emptyEnded = {
    id: 'GX', name: 'empty', status: 'ended', updatedAt: '2024-02-01',
    players: [{ id: 'p0', name: 'u', userId: 'u' }, { id: 'p1', name: 'o', userId: 'o' }],
    transactions: [], finalStacks: {},
  };
  const s = computeUserStats([emptyEnded], 'u');
  assert.equal(s.totalGames, 0, 'no buy-ins → not a played game');
  assert.equal(s.gamesPlayed, 0);
  assert.equal(s.recent.length, 0);
  assert.equal(userResults([emptyEnded], 'u').length, 0, 'no result for a no-money game');
  assert.equal(computeLeaderboard([emptyEnded], ['u', 'o']).length, 0, 'no leaderboard rows from a no-money game');
});

test('a lone single buy-in is not a real game (needs 2+ buy-ins to have played)', () => {
  // 3 seats but only ONE buy-in ever went in — you need at least two people to put
  // money in for a hand to play, so this never counts (stats, leaderboard, results).
  const oneBuyIn = {
    id: 'GY', name: 'one-buyin', status: 'ended', updatedAt: '2024-02-02',
    players: [
      { id: 'p0', name: 'u', userId: 'u' },
      { id: 'p1', name: 'o', userId: 'o' },
      { id: 'p2', name: 'q', userId: 'q' },
    ],
    transactions: [{ id: 't0', playerId: 'p0', amount: 20, type: 'buyin' }],
    finalStacks: {},
  };
  const s = computeUserStats([oneBuyIn], 'u');
  assert.equal(s.totalGames, 0, 'a single buy-in → not a counted game');
  assert.equal(s.gamesPlayed, 0);
  assert.equal(s.recent.length, 0);
  assert.equal(userResults([oneBuyIn], 'u').length, 0);
  assert.equal(computeLeaderboard([oneBuyIn], ['u', 'o', 'q']).length, 0);

  // sanity: a second buy-in makes it a real, counted game
  const twoBuyIns = { ...oneBuyIn, transactions: [...oneBuyIn.transactions, { id: 't1', playerId: 'p1', amount: 20, type: 'buyin' }] };
  assert.equal(computeUserStats([twoBuyIns], 'u').totalGames, 1, 'two buy-ins → real game');
});

test('active game counts the moment YOU cash out (locked result)', () => {
  // live table: you cashed out +50, an opponent is still in
  const g = game({ u: { buyin: 100, final: 150 }, still: { buyin: 100, final: null } }, { status: 'active' });
  const you = computeUserStats([g], 'u');
  assert.equal(you.gamesPlayed, 1, 'your cashed-out result counts even while the game runs on');
  assert.equal(you.totalProfit, 50);
  assert.equal(you.recent[0].net, 50, 'shows your net, not in-progress');
  const opp = computeUserStats([g], 'still');
  assert.equal(opp.gamesPlayed, 0, 'a player still in has no locked result yet');
  assert.equal(opp.recent[0].net, null);
});

test('wins / losses / break-even aggregate correctly', () => {
  const games = [
    game({ u: { buyin: 100, final: 150 }, opp: { buyin: 100, final: 50 } }), // +50
    game({ u: { buyin: 100, final: 80 }, opp: { buyin: 100, final: 120 } }),  // -20
    game({ u: { buyin: 100, final: 100 }, opp: { buyin: 100, final: 100 } }), // 0 (break-even)
  ];
  const s = computeUserStats(games, 'u');
  assert.equal(s.gamesPlayed, 3);
  assert.equal(s.totalProfit, 30);
  assert.equal(s.avgProfit, 10);
  assert.equal(s.profitable, 1, 'break-even is NOT profitable');
  assert.equal(s.profitablePct, 33, 'round(1/3*100)');
  assert.equal(s.best?.net, 50);
  assert.equal(s.worst?.net, -20);
});

test('integer-cent accumulation — no float drift over 100 games', () => {
  const games = Array.from({ length: 100 }, () => game({ u: { buyin: 0, final: 0.07 }, opp: { buyin: 0.07, final: 0 } }));
  const s = computeUserStats(games, 'u');
  assert.equal(s.totalProfit, 7, '100 × 0.07 === 7.00 exactly');
  assert.equal(s.avgProfit, 0.07);
});

test('frozen snapshot and live-compute give the same net', () => {
  const live = computeUserStats([game({ u: { buyin: 100, final: 137.5 }, opp: { buyin: 100, final: 62.5 } })], 'u');
  const froz = computeUserStats([game({ u: { buyin: 100, final: 137.5 }, opp: { buyin: 100, final: 62.5 } }, { frozen: true })], 'u');
  assert.equal(live.totalProfit, 37.5);
  assert.equal(froz.totalProfit, 37.5);
});

test('profitablePct + avg guarded at zero games', () => {
  const s = computeUserStats([game({ u: { buyin: 10, final: null } }, { status: 'active' })], 'u');
  assert.equal(s.profitablePct, 0);
  assert.equal(s.avgProfit, 0);
});

test('recent is newest-first and capped at 30', () => {
  const games = Array.from({ length: 40 }, () => game({ u: { buyin: 10, final: 12 }, opp: { buyin: 10, final: 8 } }));
  const s = computeUserStats(games, 'u');
  assert.equal(s.recent.length, 30, 'capped at 30');
  for (let i = 1; i < s.recent.length; i++) assert.ok(s.recent[i - 1].at >= s.recent[i].at, 'newest first');
});

test('leaderboard: integer-cent totals, sorted by net, drops no-result players', () => {
  const games = [
    game({ a: { buyin: 100, final: 130 }, b: { buyin: 100, final: 70 } }), // a +30, b -30
    game({ a: { buyin: 100, final: 90 }, b: { buyin: 100, final: 110 } }),  // a -10, b +10
  ];
  const lb = computeLeaderboard(games, ['a', 'b', 'c']);
  assert.equal(lb.length, 2, 'c (no games) dropped');
  assert.equal(lb[0].id, 'a');
  assert.equal(lb[0].net, 20); // +30 -10
  assert.equal(lb[1].net, -20);
  assert.equal(lb[0].avg, 10);
  // zero-sum sanity between the two: their nets cancel
  assert.equal(lb[0].net + lb[1].net, 0);
});

test('cumulative profit curve runs oldest→newest, summing to total', () => {
  const games = [
    game({ u: { buyin: 100, final: 130 }, o: { buyin: 100, final: 70 } }),  // +30
    game({ u: { buyin: 100, final: 90 }, o: { buyin: 100, final: 110 } }),   // -10
    game({ u: { buyin: 100, final: 125 }, o: { buyin: 100, final: 75 } }),   // +25
  ];
  const s = computeUserStats(games, 'u');
  assert.deepEqual(s.curve.map((p) => p.cum), [30, 20, 45], 'running cumulative');
  assert.equal(s.curve[s.curve.length - 1].cum, s.totalProfit, 'curve ends at total profit');
});

test('win/loss streak: current run + longest, break-even resets', () => {
  // chronological nets: +,+,+,-,-  → current loss 2, longest win 3, longest loss 2
  const games = [
    game({ u: { buyin: 10, final: 12 }, o: { buyin: 10, final: 8 } }),  // +2
    game({ u: { buyin: 10, final: 11 }, o: { buyin: 10, final: 9 } }),  // +1
    game({ u: { buyin: 10, final: 15 }, o: { buyin: 10, final: 5 } }),  // +5
    game({ u: { buyin: 10, final: 7 }, o: { buyin: 10, final: 13 } }),  // -3
    game({ u: { buyin: 10, final: 6 }, o: { buyin: 10, final: 14 } }),  // -4
  ];
  const s = computeUserStats(games, 'u');
  assert.equal(s.streak.kind, 'loss');
  assert.equal(s.streak.current, 2);
  assert.equal(s.streak.longestWin, 3);
  assert.equal(s.streak.longestLoss, 2);
  // a break-even most-recent game → neutral, no current streak
  const s2 = computeUserStats([...games, game({ u: { buyin: 10, final: 10 }, o: { buyin: 10, final: 10 } })], 'u');
  assert.equal(s2.streak.kind, 'none');
  assert.equal(s2.streak.current, 0);
});

test('hourly rate: only counts games with hours entered; null if none', () => {
  const noHours = computeUserStats([game({ u: { buyin: 100, final: 150 }, o: { buyin: 100, final: 50 } })], 'u');
  assert.equal(noHours.hourly, null, 'no hours entered → no hourly stat');

  // game A: +50 over 5h ; game B: -20 over 2h ; game C: +30 but NO hours (excluded)
  const games = [
    game({ u: { buyin: 100, final: 150, hours: 5 }, o: { buyin: 100, final: 50 } }),
    game({ u: { buyin: 100, final: 80, hours: 2 }, o: { buyin: 100, final: 120 } }),
    game({ u: { buyin: 100, final: 130 }, o: { buyin: 100, final: 70 } }), // no hours
  ];
  const s = computeUserStats(games, 'u');
  assert.equal(s.hourly?.games, 2, 'only the 2 games with hours');
  assert.equal(s.hourly?.hours, 7);
  assert.equal(s.hourly?.rate, round2((50 - 20) / 7)); // 30 / 7h ≈ 4.29
  assert.equal(s.totalProfit, 60, 'totalProfit still counts ALL games (incl. the no-hours one)');
});
function round2(/** @type {number} */ n) { return Math.round(n * 100) / 100; }

test('userResults: finished + cashed-out count, still-in excluded; oldest→newest', () => {
  const games = [
    game({ u: { buyin: 10, final: 15 }, o: { buyin: 10, final: 5 } }),                          // finished → +5
    game({ u: { buyin: 10, final: null }, o: { buyin: 10, final: 5 } }, { status: 'active' }),   // still in → excluded
    game({ u: { buyin: 10, final: 8 }, o: { buyin: 10, final: null } }, { status: 'active' }),   // cashed out live → -2
  ];
  const r = userResults(games, 'u');
  assert.equal(r.length, 2, 'finished + cashed-out-live, not the still-in one');
  assert.deepEqual(r.map((x) => x.net), [5, -2], 'oldest → newest');
});
