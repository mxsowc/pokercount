// The settlement-rewrite endpoint (PUT /api/games/:id/settlement) re-routes who
// pays whom. It must: validate the plan against the frozen balances, preserve a
// "paid" mark on an unchanged line, drop it on a changed line, and reject the
// rewrite before the game is closed. None of this was covered before.

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, openGame, buyIn, setFinal } from './helpers/server.js';

let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.stop(); });

// Balanced 4-player game: A +30, B +30, C -30, D -30. Two debtors, two creditors,
// so the plan has genuine routing choices. Returns ids + the closed settlement.
async function closedFourHander(c) {
  const { id, hostHeaders, game } = await openGame(c, {
    players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }],
  });
  const [A, B, C, D] = game.players.map((p) => p.id);
  for (const p of [A, B, C, D]) await buyIn(c, id, p, 30);
  await setFinal(c, id, A, 60);
  await setFinal(c, id, B, 60);
  await setFinal(c, id, C, 0);
  await setFinal(c, id, D, 0);
  const closed = await c.post(`/api/games/${id}/close`, undefined, hostHeaders);
  assert.equal(closed.data.status, 'ended');
  assert.equal(closed.data.settlement.balanced, true);
  assert.equal(closed.data.settlement.transfers.length, 2);
  return { id, ids: { A, B, C, D }, settlement: closed.data.settlement };
}

test('a valid re-route is accepted and replaces the plan', async () => {
  const c = srv.client();
  const { id, ids } = await closedFourHander(c);
  // C pays B, D pays A — each debtor still pays 30, each creditor still gets 30.
  const plan = [
    { from: ids.C, to: ids.B, amount: 30 },
    { from: ids.D, to: ids.A, amount: 30 },
  ];
  const r = await c.put(`/api/games/${id}/settlement`, { transfers: plan });
  assert.equal(r.status, 200);
  const got = r.data.settlement.transfers
    .map((t) => `${t.from}->${t.to}:${t.amount}`)
    .sort();
  assert.deepEqual(got, [`${ids.C}->${ids.B}:30`, `${ids.D}->${ids.A}:30`].sort());
});

test('resubmitting an identical plan preserves a paid mark', async () => {
  const c = srv.client();
  const { id, settlement } = await closedFourHander(c);
  const t0 = settlement.transfers[0];
  await c.put(`/api/games/${id}/settlement/${t0.id}`, { paid: true });

  // Resubmit the exact same plan (same from/to/amount on every line).
  const plan = settlement.transfers.map((t) => ({ from: t.from, to: t.to, amount: t.amount }));
  const r = await c.put(`/api/games/${id}/settlement`, { transfers: plan });
  assert.equal(r.status, 200);
  const same = r.data.settlement.transfers.find((t) => t.from === t0.from && t.to === t0.to);
  assert.equal(same.paid, true, 'unchanged line keeps its paid mark');
  assert.equal(same.paidBy != null, true);
});

test('a re-routed line loses its paid mark', async () => {
  const c = srv.client();
  const { id, ids, settlement } = await closedFourHander(c);
  // Mark whatever the default plan produced as paid.
  for (const t of settlement.transfers) {
    await c.put(`/api/games/${id}/settlement/${t.id}`, { paid: true });
  }
  // Now re-route so neither original (from,to) pairing survives.
  const plan = [
    { from: ids.C, to: ids.B, amount: 30 },
    { from: ids.D, to: ids.A, amount: 30 },
  ];
  const r = await c.put(`/api/games/${id}/settlement`, { transfers: plan });
  assert.equal(r.status, 200);
  // The default greedy plan pairs C->A, D->B; re-routing to C->B, D->A changes
  // both lines, so no paid mark should carry over.
  const anyPaid = r.data.settlement.transfers.some((t) => t.paid);
  assert.equal(anyPaid, false, 'changed lines must reset to unpaid');
  assert.equal(r.data.status, 'ended');
});

test('rewrite validation rejects bad plans', async () => {
  const c = srv.client();
  const { id, ids } = await closedFourHander(c);

  // Debtor underpays (C pays only 20).
  assert.equal(
    (await c.put(`/api/games/${id}/settlement`, { transfers: [
      { from: ids.C, to: ids.A, amount: 20 }, { from: ids.D, to: ids.B, amount: 30 },
    ] })).status, 400, 'underpaying debtor rejected');

  // A player paying themselves.
  assert.equal(
    (await c.put(`/api/games/${id}/settlement`, { transfers: [
      { from: ids.C, to: ids.C, amount: 30 },
    ] })).status, 400, 'self-payment rejected');

  // A creditor (A is owed money) listed as a payer.
  assert.equal(
    (await c.put(`/api/games/${id}/settlement`, { transfers: [
      { from: ids.A, to: ids.B, amount: 30 },
    ] })).status, 400, 'non-debtor payer rejected');

  // transfers not a list.
  assert.equal(
    (await c.put(`/api/games/${id}/settlement`, { transfers: 'nope' })).status,
    400, 'non-array transfers rejected');
});

test('rewrite before the game is closed is rejected (409)', async () => {
  const c = srv.client();
  const { id, game } = await openGame(c, { players: [{ name: 'A' }, { name: 'B' }] });
  await buyIn(c, id, game.players[0].id, 10);
  const r = await c.put(`/api/games/${id}/settlement`, { transfers: [] });
  assert.equal(r.status, 409);
});
