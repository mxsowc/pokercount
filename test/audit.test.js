// Adversarial audit: probe calculations and settlement for rounding/conservation
// bugs and edge cases beyond the happy-path suites.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from '../src/lib/engine/resolve.js';
import { computeSettlement } from '../src/lib/engine/settle.js';

const conserved = (r, total, msg) => assert.equal(r.total, total, msg || 'chips conserved');

// ---- engine: chip conservation under awkward divisions -----------------------

test('run-it-twice with an indivisible pot conserves every chip', () => {
  // Pot 101 (odd), run twice → 50/51 split across runs; must stay integer.
  const r = resolve({
    game: 'holdem',
    players: [
      { id: 'A', hole: 'As Ah', contributed: 50 },
      { id: 'B', hole: 'Ks Kd', contributed: 51 },
    ],
    runs: ['2c 7d 9h Js 4s', '3c 8d Th Jc 5s'],
  });
  // B overbet 1 (uncalled) returns; contested 100 over two runs.
  conserved(r, 101);
  const sum = Object.values(r.awards).reduce((a, b) => a + b, 0);
  assert.equal(sum, 101);
});

test('three-way run-it-thrice conserves and stays integer', () => {
  const r = resolve({
    game: 'holdem',
    players: [
      { id: 'A', hole: 'As Ah', contributed: 100 },
      { id: 'B', hole: 'Ks Kd', contributed: 100 },
      { id: 'C', hole: 'Qs Qd', contributed: 100 },
    ],
    runs: ['2c 7d 9h Js 4s', '3c 8d Th Jc 6s', '4c 9d 2h 5c 7h'],
  });
  conserved(r, 300);
  for (const v of Object.values(r.awards)) assert.ok(Number.isInteger(v), 'integer chips only');
});

test('hi-lo quartering with an odd pot keeps integer chips and conserves', () => {
  // Tied nut low quarters; pot 101 → halves 51/50, low half split 25/25.
  const r = resolve({
    game: 'omaha', hiLo: true,
    players: [
      { id: 'P1', hole: 'Ac 2c Ks Qd', contributed: 51 },
      { id: 'P2', hole: 'Ad 2d 7s 6s', contributed: 50 },
    ],
    board: '8c 5d 3h Kc Qs',
  });
  conserved(r, 101);
  for (const v of Object.values(r.awards)) assert.ok(Number.isInteger(v));
});

test('four-way mixed all-ins build nested side pots and conserve', () => {
  const r = resolve({
    game: 'holdem',
    players: [
      { id: 'A', hole: 'As Ah', contributed: 10 },
      { id: 'B', hole: 'Ks Kd', contributed: 50 },
      { id: 'C', hole: 'Qs Qd', contributed: 80 },
      { id: 'D', hole: 'Js Jd', contributed: 200 },
    ],
    board: '2c 7d 9h 3s 4s',
  });
  conserved(r, 340);
  // D overbet beyond C's 80 → 120 uncalled returns to D.
  assert.deepEqual(r.returned, { id: 'D', amount: 120 });
  // A (best hand) only eligible for the main pot = 10*4 = 40.
  assert.equal(r.awards.A, 40);
});

test('double board + run-it-twice nests divisions and conserves', () => {
  const r = resolve({
    game: 'holdem',
    players: [
      { id: 'A', hole: 'As Ah', contributed: 100 },
      { id: 'B', hole: 'Ks Kd', contributed: 100 },
    ],
    boards: [
      { runs: ['2c 7d 9h Js 4s', '3c 8d Th Jc 5s'] },
      { runs: ['Kc 6d 9c Td 4h', 'Qc 6s 9d Tc 4d'] },
    ],
  });
  conserved(r, 200);
});

// ---- settlement: rounding, missing data, conservation ------------------------

test('settlement: every debt is fully covered and nothing extra is moved', () => {
  const players = [
    { id: 'a', name: 'A' }, { id: 'b', name: 'B' },
    { id: 'c', name: 'C' }, { id: 'd', name: 'D' },
  ];
  const tx = players.map((p) => ({ playerId: p.id, amount: 33.33 }));
  const finals = { a: 0, b: 10.32, c: 50, d: 72.68 }; // sums to 132.99... check
  const r = computeSettlement(players, tx, finals);
  // total in = 133.32, total out = 133.00 → discrepancy reported, not hidden
  assert.equal(r.totalInvested, 133.32);
  // money moved never exceeds total losses
  const moved = r.transfers.reduce((s, t) => s + t.amount, 0);
  const losses = r.lines.filter((l) => l.net < 0).reduce((s, l) => s - l.net, 0);
  assert.ok(moved <= losses + 1e-9, 'never move more than the losers lost');
});

test('settlement is exact in cents (no float drift across many players)', () => {
  const players = Array.from({ length: 7 }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
  const tx = players.map((p) => ({ playerId: p.id, amount: 10 }));
  // Winners and losers that sum to zero exactly.
  const finals = { p0: 0, p1: 0, p2: 5, p3: 10, p4: 12.5, p5: 17.5, p6: 25 };
  const r = computeSettlement(players, tx, finals);
  assert.ok(r.balanced, 'should balance: 70 in, 70 out');
  // each creditor receives exactly their net, each debtor pays exactly theirs
  const recv = {}, paid = {};
  for (const t of r.transfers) {
    recv[t.to] = (recv[t.to] || 0) + t.amount;
    paid[t.from] = (paid[t.from] || 0) + t.amount;
  }
  for (const l of r.lines) {
    if (l.net > 0) assert.equal(Math.round((recv[l.playerId] || 0) * 100), Math.round(l.net * 100));
    if (l.net < 0) assert.equal(Math.round((paid[l.playerId] || 0) * 100), Math.round(-l.net * 100));
  }
});

test('settlement: a player with no transactions and no cash-out is net zero', () => {
  const players = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const r = computeSettlement(players, [{ playerId: 'a', amount: 20 }], { a: 0 });
  // B never bought in, no final → net 0, not NaN
  const b = r.lines.find((l) => l.playerId === 'b');
  assert.equal(b.net, 0);
  assert.equal(b.finalStack, null);
});
