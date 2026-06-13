// Verifying the flop-equity math. The method is exhaustive enumeration, so each
// of these has an answer provable by hand — we check the engine matches it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { flopEquity, equityAt } from '../src/equity.js';

const eqOf = (r, id) => r.equity.find((e) => e.id === id).equity;
const sum = (r) => r.equity.reduce((a, e) => a + e.equity, 0);

test('equities always sum to exactly 100% (conservation)', () => {
  const r = flopEquity({
    game: 'holdem',
    players: [{ id: 'a', hole: 'As Ah' }, { id: 'b', hole: 'Kd Kc' }, { id: 'c', hole: 'Qs Jh' }],
    flop: '2c 7d 9h',
  });
  assert.ok(Math.abs(sum(r) - 1) < 1e-9, `sum was ${sum(r)}`);
});

test('runout count equals C(remaining, 2)', () => {
  // Heads-up Hold'em: 52 − 4 hole − 3 flop = 45 unknown → C(45,2) = 990.
  const r = flopEquity({
    game: 'holdem',
    players: [{ id: 'a', hole: 'As Ks' }, { id: 'b', hole: '2c 2d' }],
    flop: '7h 8d Tc',
  });
  assert.equal(r.runouts, 990);
});

test('two hands that can only ever chop are EXACTLY 50/50', () => {
  // 6c6d vs 6h6s on Ac Kd Qh: all four sixes are dead, no flush is possible for
  // anyone (each suit maxes at 4 cards), and any straight/pair forms on the
  // shared board — so every single runout is a tie. Equity must be exactly 0.5.
  const r = flopEquity({
    game: 'holdem',
    players: [{ id: 'a', hole: '6c 6d' }, { id: 'b', hole: '6h 6s' }],
    flop: 'Ac Kd Qh',
  });
  assert.equal(eqOf(r, 'a'), 0.5);
  assert.equal(eqOf(r, 'b'), 0.5);
});

test('the unbeatable nuts on the flop is exactly 100%', () => {
  // Quad aces (Ac Ad + Ah As) — turn/river cannot change it; no straight flush
  // is reachable. Hero 100%, villain 0%.
  const r = flopEquity({
    game: 'holdem',
    players: [{ id: 'a', hole: 'Ac Ad' }, { id: 'b', hole: '2c 3d' }],
    flop: 'Ah As Kh',
  });
  assert.equal(eqOf(r, 'a'), 1);
  assert.equal(eqOf(r, 'b'), 0);
});

test('overpair vs underpair on a dry flop ≈ 91% / 9% (known poker odds)', () => {
  // AA vs KK, no king and no straight/flush help. Standard calculators put this
  // around 91% for the overpair (KK needs to spike a 2-out set). Conservation +
  // a wide-but-meaningful band.
  const r = flopEquity({
    game: 'holdem',
    players: [{ id: 'aa', hole: 'As Ah' }, { id: 'kk', hole: 'Kd Kc' }],
    flop: '2c 7d 9h',
  });
  const aa = eqOf(r, 'aa');
  assert.ok(aa > 0.88 && aa < 0.93, `AA flop equity was ${(aa * 100).toFixed(2)}%`);
  assert.ok(Math.abs(sum(r) - 1) < 1e-9);
});

test('a flopped nut-flush draw vs top set lands in the known ~25% band', () => {
  // Set of queens vs nut-flush draw: the set is a big favourite (~75/25). The
  // flush draw has 9 outs (≈36% to complete) but the set fills up on many of
  // those runouts, dragging equity down. Sanity band, not an exact assert.
  const r = flopEquity({
    game: 'holdem',
    players: [{ id: 'set', hole: 'Qs Qd' }, { id: 'fd', hole: 'Ah Kh' }],
    flop: 'Qh 7h 2c',
  });
  const fd = eqOf(r, 'fd');
  assert.ok(fd > 0.18 && fd < 0.34, `flush-draw equity was ${(fd * 100).toFixed(2)}%`);
});

test('Omaha uses exactly two hole cards (equity still sums to 100%)', () => {
  const r = flopEquity({
    game: 'omaha',
    players: [{ id: 'a', hole: 'Ah Kh Qh Jh' }, { id: 'b', hole: 'As Ks 2c 3d' }],
    flop: 'Th 9h 4c',
  });
  assert.ok(Math.abs(sum(r) - 1) < 1e-9);
});

// ---- turn equity (4 known cards, enumerate just the river) ------------------
test('turn equity enumerates exactly the remaining rivers (52−4−4 = 44)', () => {
  const r = equityAt({
    game: 'holdem',
    players: [{ id: 'a', hole: 'As Ks' }, { id: 'b', hole: '2c 2d' }],
    board: '7h 8d Tc Jc', // 4 cards
  });
  assert.equal(r.runouts, 44);
  assert.equal(r.cardsToCome, 1);
  assert.equal(r.street, 'turn');
  assert.ok(Math.abs(sum(r) - 1) < 1e-9);
});

test('turn nuts is exactly 100%', () => {
  const r = equityAt({
    game: 'holdem',
    players: [{ id: 'a', hole: 'Ac Ad' }, { id: 'b', hole: '2c 3d' }],
    board: 'Ah As Kh 7d', // hero already has quad aces; river cannot matter
  });
  assert.equal(eqOf(r, 'a'), 1);
  assert.equal(eqOf(r, 'b'), 0);
});

// ---- hi-lo (8-or-better) ----------------------------------------------------
test('hi-lo pot shares still sum to 100% (whole pot is always awarded)', () => {
  const r = equityAt({
    game: 'omaha', hiLo: true,
    players: [{ id: 'a', hole: 'Ac 2c Ks Qd' }, { id: 'b', hole: 'Ad 2d 7s 6s' }],
    board: '8c 5d 3h', // flop with a live low
  });
  assert.ok(Math.abs(sum(r) - 1) < 1e-9);
});

test('hi-lo with no possible low → high scoops (acts like high-only)', () => {
  // Full board all high cards: no 8-or-better low can exist, so the best high
  // takes the entire pot and nobody wins a low.
  const r = equityAt({
    game: 'omaha', hiLo: true,
    players: [{ id: 'hi', hole: 'As Ah Ks Kd' }, { id: 'lo', hole: '9s 9d 4c 5c' }],
    board: 'Kc Kh Qs Qd Jd', // river already out
  });
  const hi = r.equity.find((e) => e.id === 'hi');
  assert.equal(hi.equity, 1);   // scoops the whole pot
  assert.equal(hi.scoop, 1);
  assert.equal(hi.winLow, 0);   // no low awarded to anyone
  assert.equal(r.equity.find((e) => e.id === 'lo').winLow, 0);
});

test('hi-lo: tying the nut low quarters the pot (¼ share)', () => {
  // Both hold A-2 → both make the same nut low on this board; one wins the high.
  // P1 wins high (½) + shares low (¼) = ¾; P2 shares low only = ¼.
  const r = equityAt({
    game: 'omaha', hiLo: true,
    players: [{ id: 'p1', hole: 'Ac 2c Ks Qd' }, { id: 'p2', hole: 'Ad 2d 7s 6s' }],
    board: '8c 5d 3h Kc Qs', // river out
  });
  assert.equal(eqOf(r, 'p1'), 0.75);
  assert.equal(eqOf(r, 'p2'), 0.25);
});
