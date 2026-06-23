// Property / invariant tests for the money math. These throw thousands of
// randomised scenarios at the engine and assert the conservation laws that must
// never break — a regression net for settlement, pot resolution, odd-chip
// division and the "even-out" reconcile. Deterministic (seeded) so CI is stable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSettlement, divide, resolve } from '../src/lib/engine/index.js';

// mulberry32 — deterministic PRNG so failures are reproducible.
function mkrng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rint = (rnd, a, b) => a + Math.floor(rnd() * (b - a + 1));
const cents = (c) => c / 100;

test('settlement: balanced books conserve and settle exactly (20k trials)', () => {
  const rnd = mkrng(1);
  for (let t = 0; t < 20000; t++) {
    const n = rint(rnd, 2, 9);
    const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
    const invC = players.map(() => rint(rnd, 0, 50000));
    const total = invC.reduce((a, b) => a + b, 0);
    const cuts = Array.from({ length: n - 1 }, () => rint(rnd, 0, total)).sort((a, b) => a - b);
    const finC = []; let prev = 0;
    for (const c of cuts) { finC.push(c - prev); prev = c; } finC.push(total - prev);
    const txns = players.map((p, i) => ({ playerId: p.id, amount: cents(invC[i]), type: 'buyin' }));
    const finals = Object.fromEntries(players.map((p, i) => [p.id, cents(finC[i])]));
    const s = computeSettlement(players, txns, finals);

    assert.equal(s.balanced, true, 'balanced');
    assert.ok(s.transfers.length <= n - 1, '<= n-1 transfers');
    assert.ok(s.transfers.every((x) => x.amount > 0), 'positive transfers');
    const recv = {}, paid = {};
    for (const x of s.transfers) {
      recv[x.to] = (recv[x.to] || 0) + Math.round(x.amount * 100);
      paid[x.from] = (paid[x.from] || 0) + Math.round(x.amount * 100);
    }
    for (const l of s.lines) {
      const netC = Math.round(l.net * 100);
      if (netC > 0) assert.equal(recv[l.playerId] || 0, netC, 'creditor exact');
      if (netC < 0) assert.equal(paid[l.playerId] || 0, -netC, 'debtor exact');
    }
  }
});

test('settlement: discrepancy reported exactly when books do not balance (5k)', () => {
  const rnd = mkrng(2);
  for (let t = 0; t < 5000; t++) {
    const n = rint(rnd, 2, 6);
    const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
    const invC = players.map(() => rint(rnd, 100, 20000));
    const finC = players.map(() => rint(rnd, 0, 20000));
    const txns = players.map((p, i) => ({ playerId: p.id, amount: cents(invC[i]), type: 'buyin' }));
    const finals = Object.fromEntries(players.map((p, i) => [p.id, cents(finC[i])]));
    const s = computeSettlement(players, txns, finals);
    const expC = finC.reduce((a, b) => a + b, 0) - invC.reduce((a, b) => a + b, 0);
    assert.equal(Math.round(s.discrepancy * 100), expC);
    assert.equal(s.balanced, expC === 0);
  }
});

test('divide: sum-exact, ≤1 spread, seat priority (50k)', () => {
  const rnd = mkrng(3);
  for (let t = 0; t < 50000; t++) {
    const amount = rint(rnd, 0, 100000), n = rint(rnd, 1, 9);
    const sh = divide(amount, n);
    assert.equal(sh.reduce((a, b) => a + b, 0), amount, 'conserves');
    assert.ok(Math.max(...sh) - Math.min(...sh) <= 1, '≤1 spread');
    assert.ok(sh.every((x) => x >= 0 && Number.isInteger(x)), 'non-neg ints');
    for (let i = 1; i < sh.length; i++) assert.ok(sh[i] <= sh[i - 1], 'priority order');
  }
});

test('pot resolution: Σawards == Σcontributed (20k random all-ins)', () => {
  const rnd = mkrng(4);
  const RANKS = '23456789TJQKA', SUITS = 'shdc';
  const full = []; for (const r of RANKS) for (const s of SUITS) full.push(r + s);
  let ran = 0;
  for (let t = 0; t < 20000; t++) {
    const game = rnd() < 0.5 ? 'holdem' : 'omaha';
    const holeN = game === 'omaha' ? 4 : 2;
    const n = rint(rnd, 2, 6);
    const numBoards = rnd() < 0.3 ? 2 : 1;
    const numRuns = rnd() < 0.3 ? rint(rnd, 2, 3) : 1;
    if (n * holeN + numBoards * numRuns * 5 > 52) continue;
    const deck = full.slice();
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    let k = 0;
    const players = Array.from({ length: n }, (_, i) => ({
      id: 'p' + i, hole: deck.slice(k, k += holeN).join(' '),
      contributed: rint(rnd, 0, 500), folded: rnd() < 0.25,
    }));
    const boards = Array.from({ length: numBoards }, () => ({ runs: Array.from({ length: numRuns }, () => deck.slice(k, k += 5)) }));
    const out = resolve({ game, hiLo: rnd() < 0.5, players, boards });
    ran++;
    const contributed = players.reduce((a, p) => a + p.contributed, 0);
    const awarded = Object.values(out.awards).reduce((a, b) => a + b, 0);
    assert.equal(awarded, contributed, 'every contributed chip is awarded');
    assert.ok(Object.values(out.awards).every((x) => x >= 0), 'no negative award');
  }
  assert.ok(ran > 15000, 'enough valid trials ran');
});

test('even-out reconcile: sums to zero, trims correct side, never flips sign (30k)', () => {
  // mirrors splitCents/reconcileProposal in src/routes/game/+page.svelte
  function splitCents(total, weights) {
    const wsum = weights.reduce((a, b) => a + b, 0);
    if (wsum === 0) return weights.map(() => 0);
    const raw = weights.map((w) => (total * w) / wsum);
    const out = raw.map((x) => Math.trunc(x));
    let rem = total - out.reduce((a, b) => a + b, 0);
    const order = raw.map((x, i) => ({ i, f: Math.abs(x - Math.trunc(x)) })).sort((a, b) => b.f - a.f);
    const step = total >= 0 ? 1 : -1; let k = 0;
    while (rem !== 0 && order.length) { out[order[k % order.length].i] += step; rem -= step; k++; }
    return out;
  }
  const rnd = mkrng(5);
  for (let t = 0; t < 30000; t++) {
    const n = rint(rnd, 2, 9);
    const rows = Array.from({ length: n }, () => { const netC = rint(rnd, -50000, 50000); return { netC, deltaC: 0, adjNetC: netC }; });
    const D = rows.reduce((s, r) => s + r.netC, 0);
    if (D !== 0) {
      const side = D > 0 ? rows.filter((r) => r.netC > 0) : rows.filter((r) => r.netC < 0);
      const d = splitCents(-D, side.map((r) => Math.abs(r.netC)));
      side.forEach((r, j) => { r.deltaC = d[j]; r.adjNetC = r.netC + d[j]; });
      assert.equal(rows.reduce((s, r) => s + r.adjNetC, 0), 0, 'adjusted nets sum to zero');
    }
    for (const r of rows) {
      if (D > 0 && r.netC <= 0) assert.equal(r.deltaC, 0, 'overcount leaves non-winners');
      if (D < 0 && r.netC >= 0) assert.equal(r.deltaC, 0, 'undercount leaves non-losers');
      if (r.netC > 0) assert.ok(r.adjNetC >= 0, 'winner not flipped');
      if (r.netC < 0) assert.ok(r.adjNetC <= 0, 'loser not flipped');
    }
  }
});
