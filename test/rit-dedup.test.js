// Run-it-twice: cards dealt after the shared street come off one deck, so they
// can't repeat between runs. resolve() must reject a hand-typed deal that reuses
// a turn/river across runs (which would otherwise settle from an impossible board).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from '../src/lib/engine/resolve.js';

const game = (runs) => ({
  game: 'holdem',
  players: [
    { id: 'a', hole: 'Ah Ad', contributed: 100 },
    { id: 'b', hole: 'Kh Kd', contributed: 100 },
  ],
  runs,
});

test('valid run-it-twice (shared flop, distinct turn/river) resolves', () => {
  const r = resolve(game(['Qh 7c 2d 3s 9h', 'Qh 7c 2d 5s Tc']));
  assert.ok(r && r.awards);
});

test('valid run-it-twice from the turn (shared flop+turn, distinct rivers) resolves', () => {
  const r = resolve(game(['Qh 7c 2d 3s 9h', 'Qh 7c 2d 3s Tc']));
  assert.ok(r && r.awards);
});

test('a card reused across runs is rejected as an impossible deal', () => {
  // 9h is the river of BOTH runs — impossible from one deck.
  assert.throws(
    () => resolve(game(['Qh 7c 2d 3s 9h', 'Qh 7c 2d 5s 9h'])),
    /repeats across run-it-twice/,
  );
});

test('a card reused in a different position across runs is rejected', () => {
  // 5s is run-1's turn and run-2's river.
  assert.throws(
    () => resolve(game(['Qh 7c 2d 5s 9h', 'Qh 7c 2d 8c 5s'])),
    /repeats across run-it-twice/,
  );
});
