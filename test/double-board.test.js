// Confirms the Omaha "exactly two hole cards" rule applies PER BOARD on a
// double board — and that it genuinely changes outcomes vs Hold'em rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from '../src/lib/engine/resolve.js';
import { bestHigh } from '../src/lib/engine/select.js';
import { HIGH } from '../src/lib/engine/evaluate.js';
import { parseCards } from '../src/lib/engine/cards.js';

// Board 1 has FOUR hearts (Ah Kh Qh 2h). P1 holds exactly ONE heart (Jh);
// P2 holds TWO hearts (Th 8h).
const board1 = parseCards('Ah Kh Qh 2h 3c');
const p1 = parseCards('Jh 9s 4c 5d');
const p2 = parseCards('Th 8h 4s 5s');

test('Omaha needs two hole cards of a suit to flush — one is not enough', () => {
  const p1Omaha = bestHigh(p1, board1, 'omaha');
  const p2Omaha = bestHigh(p2, board1, 'omaha');

  // P1 (one heart) CANNOT make a flush in Omaha, even with four hearts on board.
  assert.notEqual(p1Omaha[0], HIGH.FLUSH, 'P1 must not have a flush under Omaha rules');
  // (P1's best is actually the wheel A-2-3-4-5 using 4c 5d + Ah 2h 3c.)
  assert.equal(p1Omaha[0], HIGH.STRAIGHT);

  // P2 (two hearts) DOES make the flush: Th 8h + Ah Kh Qh.
  assert.equal(p2Omaha[0], HIGH.FLUSH);
});

test('same cards under Hold’em rules WOULD flush — proving the rule matters', () => {
  // With no two-card restriction, P1's single Jh + four board hearts = a flush.
  const p1Holdem = bestHigh(p1, board1, 'holdem');
  assert.equal(p1Holdem[0], HIGH.FLUSH, 'under Hold’em the one heart flushes');
  // So Omaha (straight) vs Hold’em (flush) on the IDENTICAL hand — the 2-card
  // rule is real and the engine applies it.
});

test('double board PLO applies the rule on each board, then splits', () => {
  // Board 2: P1 makes two pair (9s+9c, 7c+7d); P2 only a pair of sevens.
  const r = resolve({
    game: 'omaha',
    players: [
      { id: 'P1', hole: 'Jh 9s 4c 5d', contributed: 100 },
      { id: 'P2', hole: 'Th 8h 4s 5s', contributed: 100 },
    ],
    boards: [
      'Ah Kh Qh 2h 3c', // board 1 → P2's flush beats P1's straight
      '7c 7d 2s 3d 9c', // board 2 → P1's two pair beats P2's pair
    ],
  });

  // Each board is its own half; the 2-card rule decided board 1 for P2.
  assert.equal(r.awards.P1, 100); // wins board 2
  assert.equal(r.awards.P2, 100); // wins board 1 with the flush
  assert.equal(r.total, 200);

  const b1 = r.breakdown.find((s) => s.board === 0);
  assert.deepEqual(b1.highWinners, ['P2']);
  assert.equal(b1.highHand, 'flush, ace high');
});
