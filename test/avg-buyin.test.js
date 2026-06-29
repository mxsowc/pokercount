// avgBuyIn — average total a user invests per game (buy-ins + top-ups), over
// their money games, reported in the display currency.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeUserStats } from '../src/lib/engine/stats.js';

const U = 'u1';
// txns = the signed-in user's transaction amounts (first = buy-in, rest = top-ups).
function game(id, txns, finalStack, at) {
  return {
    id, name: id, status: 'ended', updatedAt: at, unit: '€',
    players: [{ id: 'p1', name: 'me', userId: U }, { id: 'p2', name: 'opp' }],
    transactions: [
      ...txns.map((amt, i) => ({ id: id + 'a' + i, playerId: 'p1', amount: amt, type: i === 0 ? 'buyin' : 'topup' })),
      { id: id + 'b', playerId: 'p2', amount: 100, type: 'buyin' },
    ],
    finalStacks: { p1: finalStack, p2: 100 },
  };
}

test('avgBuyIn averages total invested per game, including top-ups', () => {
  // G1: buy-in 100 + top-up 50 = 150 invested.  G2: buy-in 100 = 100 invested.
  const stats = computeUserStats(
    [game('G1', [100, 50], 120, '2024-01-10'), game('G2', [100], 80, '2024-01-11')],
    U,
  );
  assert.equal(stats.gamesPlayed, 2);
  assert.equal(stats.avgBuyIn, 125); // (150 + 100) / 2
});

test('avgBuyIn is 0 with no money games', () => {
  const stats = computeUserStats([], U);
  assert.equal(stats.avgBuyIn, 0);
});
