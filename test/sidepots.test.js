import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPots } from '../src/lib/engine/sidepots.js';

test('three-way all-in builds a main and one side pot, returns uncalled top', () => {
  // A all-in 25, B all-in 60, C all-in 100.
  const { pots, returned } = buildPots([
    { id: 'A', contributed: 25 },
    { id: 'B', contributed: 60 },
    { id: 'C', contributed: 100 },
  ]);
  assert.deepEqual(returned, { id: 'C', amount: 40 }); // 100 - 60 unmatched
  assert.equal(pots.length, 2);
  assert.deepEqual(pots[0], { amount: 75, eligible: ['A', 'B', 'C'] }); // 25*3
  assert.deepEqual(pots[1], { amount: 70, eligible: ['B', 'C'] }); // 35*2
  // Invariant: returned + pots == total contributed.
  const total = pots.reduce((s, p) => s + p.amount, 0) + returned.amount;
  assert.equal(total, 25 + 60 + 100);
});

test('folded player funds a pot they cannot win', () => {
  // A all-in 25, B 100, C 100, D folded after putting in 25.
  const { pots, returned } = buildPots([
    { id: 'A', contributed: 25 },
    { id: 'B', contributed: 100 },
    { id: 'C', contributed: 100 },
    { id: 'D', contributed: 25, folded: true },
  ]);
  assert.equal(returned, null); // B and C tie for the top → nothing uncalled
  assert.equal(pots[0].amount, 100); // 25 * 4 contributors
  assert.deepEqual(pots[0].eligible, ['A', 'B', 'C']); // D's chips are here but D can't win
  assert.deepEqual(pots[1], { amount: 150, eligible: ['B', 'C'] }); // 75 * 2
});

test('heads-up uncalled bet returns the overage', () => {
  const { pots, returned } = buildPots([
    { id: 'A', contributed: 100 },
    { id: 'B', contributed: 60 },
  ]);
  assert.deepEqual(returned, { id: 'A', amount: 40 });
  assert.deepEqual(pots, [{ amount: 120, eligible: ['A', 'B'] }]);
});

test('equal contributions make a single pot, nothing returned', () => {
  const { pots, returned } = buildPots([
    { id: 'A', contributed: 50 },
    { id: 'B', contributed: 50 },
    { id: 'C', contributed: 50 },
  ]);
  assert.equal(returned, null);
  assert.deepEqual(pots, [{ amount: 150, eligible: ['A', 'B', 'C'] }]);
});
