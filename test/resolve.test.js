import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from '../src/resolve.js';
import { HIGH } from '../src/evaluate.js';
import { bestHigh } from '../src/select.js';
import { parseCards } from '../src/cards.js';

// Helper: every resolution must distribute exactly the chips that went in.
function assertConserved(result, contributed) {
  assert.equal(result.total, contributed, 'chips must be conserved');
}

test('Hold’em play-the-board → chop, odd chip to first seat', () => {
  // Royal flush on the board; both players play it. Pot 101 → 51 / 50.
  const r = resolve({
    game: 'holdem',
    players: [
      { id: 'P1', hole: '2c 3d', contributed: 50 }, // index 0, acts first
      { id: 'P2', hole: '4h 5c', contributed: 50 },
      { id: 'P3', hole: '6c 6d', contributed: 1, folded: true }, // dead chip → odd pot
    ],
    board: 'As Ks Qs Js Ts',
  });
  assert.equal(r.returned, null);
  assert.equal(r.awards.P1, 51); // odd chip to worst position (first to act)
  assert.equal(r.awards.P2, 50);
  assertConserved(r, 101);
});

test('Omaha cannot play the board (exactly two hole cards)', () => {
  // Same royal board, but Omaha forbids using it outright.
  const score = bestHigh(parseCards('2c 3d 4h 5c'), parseCards('As Ks Qs Js Ts'), 'omaha');
  assert.ok(score[0] < HIGH.STRAIGHT_FLUSH, 'Omaha hand must not be the board royal');
});

test('Omaha high: only the player using two hole cards makes the flush', () => {
  const r = resolve({
    game: 'omaha',
    players: [
      { id: 'P1', hole: 'Jh Th 3s 4s', contributed: 100 }, // Jh Th + Ah Kh Qh = royal
      { id: 'P2', hole: 'Ac Ad Kc Kd', contributed: 100 }, // trip aces at best
    ],
    board: 'Ah Kh Qh 2c 7d',
  });
  assert.equal(r.awards.P1, 200);
  assert.equal(r.awards.P2, 0);
  assertConserved(r, 200);
});

test('multiway side pots: short stack wins only the main pot', () => {
  // A 25 (AA), B 60 (KK), C 100 (QQ). A scoops main; B takes the side; C overage back.
  const r = resolve({
    game: 'holdem',
    players: [
      { id: 'A', hole: 'As Ah', contributed: 25 },
      { id: 'B', hole: 'Kc Kd', contributed: 60 },
      { id: 'C', hole: 'Qc Qd', contributed: 100 },
    ],
    board: '2c 7d 9h Js 4s',
  });
  assert.deepEqual(r.returned, { id: 'C', amount: 40 });
  assert.equal(r.awards.A, 75); // main pot 25*3
  assert.equal(r.awards.B, 70); // side pot 35*2
  assert.equal(r.awards.C, 40); // only the returned overage
  assertConserved(r, 185);
});

test('Omaha hi-lo: tied low quarters the pot', () => {
  // Board forces the low to 8-5-3; both players hold A-2 → identical nut-ish low.
  // P1 also wins the high with two pair → P1 = 3/4, P2 = 1/4.
  const r = resolve({
    game: 'omaha',
    hiLo: true,
    players: [
      { id: 'P1', hole: 'Ac 2c Ks Qd', contributed: 100 },
      { id: 'P2', hole: 'Ad 2d 7s 6s', contributed: 100 },
    ],
    board: '8c 5d 3h Kc Qs',
  });
  assert.equal(r.awards.P1, 150); // 100 high + 50 low quarter
  assert.equal(r.awards.P2, 50); // 50 low quarter
  assertConserved(r, 200);
});

test('Omaha hi-lo: no qualifying low → high scoops', () => {
  const r = resolve({
    game: 'omaha',
    hiLo: true,
    players: [
      { id: 'P1', hole: 'As Ah 2c 3c', contributed: 50 }, // kings full of aces
      { id: 'P2', hole: '9s 9d 4c 5c', contributed: 50 }, // kings full of nines
    ],
    board: 'Kc Kd Kh Qs Qd', // no card 8-or-lower → no low possible
  });
  assert.equal(r.awards.P1, 100);
  assert.equal(r.awards.P2, 0);
  assert.equal(r.breakdown[0].scoop, true);
  assertConserved(r, 100);
});

test('run it twice: split a run, win a run', () => {
  // Pot 100, run twice (50 each). Run 1 P1 wins; run 2 both play a board straight.
  const r = resolve({
    game: 'holdem',
    players: [
      { id: 'P1', hole: 'As Ah', contributed: 50 },
      { id: 'P2', hole: 'Ks Kd', contributed: 50 },
    ],
    runs: [
      '2c 7d 9h Js 4s', // P1 pair of aces wins
      '5c 6d 7h 8s 9c', // 9-high straight on board → chop
    ],
  });
  assert.equal(r.awards.P1, 75); // 50 (run1) + 25 (run2 chop)
  assert.equal(r.awards.P2, 25); // 25 (run2 chop)
  assertConserved(r, 100);
});

test('double board: each board is its own showdown', () => {
  const r = resolve({
    game: 'holdem',
    players: [
      { id: 'P1', hole: 'As Ah', contributed: 50 },
      { id: 'P2', hole: 'Ks Kd', contributed: 50 },
    ],
    boards: [
      '2c 7d 9h Js 4s', // board 1: P1 pair of aces wins
      'Kc 6d 9c Td 4h', // board 2: P2 makes trip kings
    ],
  });
  assert.equal(r.awards.P1, 50);
  assert.equal(r.awards.P2, 50);
  assertConserved(r, 100);
});

test('double board scoop: one player wins both halves', () => {
  const r = resolve({
    game: 'holdem',
    players: [
      { id: 'P1', hole: 'As Ah', contributed: 50 },
      { id: 'P2', hole: '7c 2d', contributed: 50 },
    ],
    boards: ['3s 8d 9h Js 4c', 'Ac 6d Td Qd 4h'],
  });
  assert.equal(r.awards.P1, 100); // AA wins board 1; trip aces wins board 2
  assert.equal(r.awards.P2, 0);
  assertConserved(r, 100);
});

test('walkover: everyone folds to one player, no cards needed', () => {
  const r = resolve({
    game: 'holdem',
    players: [
      { id: 'A', contributed: 30, folded: true },
      { id: 'B', contributed: 30 }, // last player standing
    ],
    board: '2c 7d 9h Js 4s',
  });
  assert.equal(r.awards.B, 60);
  assert.equal(r.awards.A, 0);
  assertConserved(r, 60);
});
