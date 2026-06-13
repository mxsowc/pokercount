import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSettlement } from '../src/settle.js';

test('basic settlement: nets and minimal transfers balance', () => {
  const players = [
    { id: 'a', name: 'Alice' },
    { id: 'b', name: 'Bob' },
    { id: 'c', name: 'Cara' },
  ];
  const transactions = [
    { playerId: 'a', amount: 20 }, // Alice buys in 20
    { playerId: 'a', amount: 20 }, // + top-up 20  → 40 invested
    { playerId: 'b', amount: 20 },
    { playerId: 'c', amount: 20 },
  ];
  const finalStacks = { a: 0, b: 10, c: 70 }; // total 80 == total invested 80
  const r = computeSettlement(players, transactions, finalStacks);

  assert.equal(r.totalInvested, 80);
  assert.equal(r.totalFinal, 80);
  assert.ok(r.balanced);
  // nets: Alice -40, Bob -10, Cara +30  (sum 0... wait Bob invested 20, final 10 → -10; Cara +50)
  const net = Object.fromEntries(r.lines.map((l) => [l.playerId, l.net]));
  assert.equal(net.a, -40);
  assert.equal(net.b, -10);
  assert.equal(net.c, 50);
  // transfers must exactly cover every debt and credit
  const paid = sumBy(r.transfers, 'amount');
  assert.equal(paid, 50); // total money moved = total losses = total wins
  assertConserves(r);
});

test('handles decimal amounts without float drift', () => {
  const players = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
  ];
  const transactions = [
    { playerId: 'a', amount: 5.55 },
    { playerId: 'b', amount: 5.55 },
  ];
  const r = computeSettlement(players, transactions, { a: 11.1, b: 0 });
  assert.ok(r.balanced);
  assert.equal(r.transfers.length, 1);
  assert.deepEqual(
    { from: r.transfers[0].fromName, to: r.transfers[0].toName, amount: r.transfers[0].amount },
    { from: 'B', to: 'A', amount: 5.55 },
  );
});

test('flags a miscount as a discrepancy instead of silently balancing', () => {
  const players = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
  ];
  const transactions = [
    { playerId: 'a', amount: 50 },
    { playerId: 'b', amount: 50 },
  ];
  // Players report 120 in chips but only 100 was bought in.
  const r = computeSettlement(players, transactions, { a: 70, b: 50 });
  assert.equal(r.balanced, false);
  assert.equal(r.discrepancy, 20);
});

test('missing final stacks count as zero (still settles)', () => {
  const players = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
  ];
  const transactions = [{ playerId: 'a', amount: 30 }, { playerId: 'b', amount: 30 }];
  const r = computeSettlement(players, transactions, { a: 60 }); // B not entered
  assert.equal(r.lines.find((l) => l.playerId === 'b').finalStack, null);
  assert.equal(r.transfers.length, 1);
  assert.equal(r.transfers[0].amount, 30); // B pays A 30
});

function sumBy(arr, k) {
  return Math.round(arr.reduce((s, x) => s + x[k], 0) * 100) / 100;
}
function assertConserves(r) {
  // For each creditor, money received equals their net; for each debtor, paid equals -net.
  const recv = {};
  const paid = {};
  for (const t of r.transfers) {
    recv[t.to] = (recv[t.to] || 0) + t.amount;
    paid[t.from] = (paid[t.from] || 0) + t.amount;
  }
  for (const l of r.lines) {
    if (l.net > 0) assert.equal(recv[l.playerId] || 0, l.net);
    if (l.net < 0) assert.equal(paid[l.playerId] || 0, -l.net);
  }
}
