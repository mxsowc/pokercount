// Engine-side fixes: equity duplicate-card validation (H11), the side-pot orphan
// branch no longer polluting `returned` (M7), and a clean error when a player
// can't form a hand at showdown instead of a cryptic null-deref (M8).

import test from 'node:test';
import assert from 'node:assert/strict';
import { equityAt } from '../src/equity.js';
import { buildPots } from '../src/sidepots.js';
import { resolve } from '../src/resolve.js';

test('equityAt rejects a card used twice across holes (H11)', () => {
  assert.throws(
    () => equityAt({
      game: 'holdem',
      players: [{ id: 'a', hole: 'As Ah' }, { id: 'b', hole: 'As Kd' }], // As twice
      board: '2c 7d 9h',
    }),
    /duplicate/i,
  );
});

test('equityAt rejects a hole card that also appears on the board (H11)', () => {
  assert.throws(
    () => equityAt({
      game: 'holdem',
      players: [{ id: 'a', hole: 'As Kd' }, { id: 'b', hole: 'Qh Qc' }],
      board: '2c 7d As', // As collides with player a
    }),
    /duplicate/i,
  );
});

test('equityAt still works on valid, distinct cards (regression)', () => {
  const r = equityAt({
    game: 'holdem',
    players: [{ id: 'a', hole: 'Ah Ad' }, { id: 'b', hole: 'Kh Kd' }],
    board: '2c 7d 9s',
  });
  const sum = r.equity.reduce((s, e) => s + e.equity, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `equity should sum to 1, got ${sum}`);
  assert.equal(r.runouts > 0, true);
});

test('buildPots: an all-folded layer makes a zero-eligible pot and leaves returned null (M7)', () => {
  const { pots, returned } = buildPots([
    { id: 'A', contributed: 30, folded: true },
    { id: 'B', contributed: 30, folded: true },
  ]);
  assert.equal(returned, null, 'no uncalled bet → returned must stay null');
  assert.equal(pots.length, 1);
  assert.equal(pots[0].amount, 60);
  assert.equal(pots[0].eligible.length, 0);
  assert.deepEqual(pots[0].orphanContributors, ['A', 'B']);
});

test('resolve throws a clear error when a player has too few cards to make a hand (M8)', () => {
  assert.throws(
    () => resolve({
      game: 'holdem',
      players: [
        { id: 'p1', hole: 'As Kd', contributed: 10 },
        { id: 'p2', hole: 'Qh', contributed: 10 }, // only one hole card
      ],
      board: '2c 7d 9h', // 3 board + 1 hole = 4 cards < 5
    }),
    /cannot form a hand/i,
  );
});
