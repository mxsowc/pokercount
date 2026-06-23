// Tests for user-profile stats (engine/stats.js) and the leaderboard/insights
// aggregation (server/insights.js). Pure functions over a games array.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeUserStats } from '../src/lib/engine/stats.js';
import { userResults, computeLeaderboard } from '../src/lib/server/insights.js';

// Build a game where `seatNets` maps userId -> {buyin, final}. Each player buys in
// once and cashes out `final`; status defaults to ended.
let seq = 0;
/** @param {Record<string, {buyin:number, final:number, hours?:number}>} seatNets */
function game(seatNets, { status = 'ended', frozen = false } = {}) {
  const id = 'G' + (++seq);
  const players = Object.keys(seatNets).map((uid, i) => ({ id: 'p' + i, name: uid, userId: uid }));
  const transactions = players.map((p) => ({ id: 't' + p.id, playerId: p.id, amount: seatNets[p.userId].buyin, type: 'buyin' }));
  const finalStacks = /** @type {Record<string, number>} */ ({});
  const hours = /** @type {Record<string, number>} */ ({});
  for (const p of players) {
    finalStacks[p.id] = seatNets[p.userId].final;
    const h = seatNets[p.userId].hours;
    if (h != null) hours[p.id] = h;
  }
  /** @type {any} */
  const g = { id, name: id, status, updatedAt: '2024-01-' + String(10 + seq).padStart(2, '0'), players, transactions, finalStacks };
  if (Object.keys(hours).length) g.hours = hours;
  if (frozen) {
    g.settlement = { lines: players.map((p) => ({ playerId: p.id, net: seatNets[p.userId].final - seatNets[p.userId].buyin })) };
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

test('active games count toward totalGames but not gamesPlayed', () => {
  const games = [game({ u: { buyin: 20, final: 0 } }, { status: 'active' })];
  const s = computeUserStats(games, 'u');
  assert.equal(s.totalGames, 1);
  assert.equal(s.gamesPlayed, 0);
  assert.equal(s.avgProfit, 0);
  assert.equal(s.recent[0].net, null, 'active game shows null net');
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
  const s = computeUserStats([game({ u: { buyin: 10, final: 0 } }, { status: 'active' })], 'u');
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

test('userResults excludes active games and orders oldest→newest', () => {
  const games = [
    game({ u: { buyin: 10, final: 15 }, o: { buyin: 10, final: 5 } }),
    game({ u: { buyin: 10, final: 5 }, o: { buyin: 10, final: 15 } }, { status: 'active' }),
  ];
  const r = userResults(games, 'u');
  assert.equal(r.length, 1, 'only the finished game');
  assert.equal(r[0].net, 5);
});
