// Settlement-lifecycle + input-validation behaviour of the HTTP API.
// These encode the CORRECT behaviour; several would fail against the pre-fix
// server (unbalanced games marked "settled", double-close wiping paid marks,
// silent no-ops, unvalidated final stacks).

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, openGame, buyIn, setFinal } from './helpers/server.js';

let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.stop(); });

// A balanced game with one owed transfer: B owes A 50.
async function balancedWithTransfer(c) {
  const { id, hostHeaders, game } = await openGame(c, { players: [{ name: 'A' }, { name: 'B' }] });
  const [a, b] = game.players;
  await buyIn(c, id, a.id, 50);
  await buyIn(c, id, b.id, 50);
  await setFinal(c, id, a.id, 100);
  await setFinal(c, id, b.id, 0);
  return { id, hostHeaders, a, b };
}

test('balanced even game closes as settled (everyone breaks even)', async () => {
  const c = srv.client();
  const { id, hostHeaders, game } = await openGame(c, { players: [{ name: 'A' }, { name: 'B' }] });
  const [a, b] = game.players;
  await buyIn(c, id, a.id, 50);
  await buyIn(c, id, b.id, 50);
  await setFinal(c, id, a.id, 50);
  await setFinal(c, id, b.id, 50);
  const { status, data } = await c.post(`/api/games/${id}/close`, undefined, hostHeaders);
  assert.equal(status, 200);
  assert.equal(data.status, 'settled');
  assert.equal(data.settlement.transfers.length, 0);
  assert.equal(data.settlement.balanced, true);
});

test('UNBALANCED game never becomes settled — it ends with its discrepancy (H1)', async () => {
  const c = srv.client();
  const { id, hostHeaders, game } = await openGame(c, { players: [{ name: 'A' }, { name: 'B' }] });
  const [a, b] = game.players;
  await buyIn(c, id, a.id, 100);
  await buyIn(c, id, b.id, 100);
  await setFinal(c, id, a.id, 100); // A even
  await setFinal(c, id, b.id, 0);   // B lost 100 to nobody → books off by 100
  const { status, data } = await c.post(`/api/games/${id}/close`, undefined, hostHeaders);
  assert.equal(status, 200);
  assert.equal(data.status, 'ended', 'must not be dressed up as settled');
  assert.equal(data.settlement.balanced, false);
  assert.equal(data.settlement.transfers.length, 0);
  assert.equal(data.settlement.discrepancy, -100); // 100 in chips vs 200 bought in

});

test('one-player game with money in cannot settle (H2)', async () => {
  const c = srv.client();
  const { id, hostHeaders, game } = await openGame(c, { players: [{ name: 'Solo' }] });
  await buyIn(c, id, game.players[0].id, 50);
  const { data } = await c.post(`/api/games/${id}/close`, undefined, hostHeaders);
  assert.equal(data.status, 'ended');
  assert.equal(data.settlement.balanced, false);
});

test('balanced game with a debt: ends, then settles only when paid', async () => {
  const c = srv.client();
  const { id, hostHeaders, a, b } = await balancedWithTransfer(c);
  const closed = await c.post(`/api/games/${id}/close`, undefined, hostHeaders);
  assert.equal(closed.data.status, 'ended');
  assert.equal(closed.data.settlement.transfers.length, 1);
  const t = closed.data.settlement.transfers[0];
  assert.deepEqual(
    { from: t.from, to: t.to, amount: t.amount },
    { from: b.id, to: a.id, amount: 50 }, // B (down 50) pays A (up 50)
  );
  const paid = await c.put(`/api/games/${id}/settlement/${t.id}`, { paid: true });
  assert.equal(paid.status, 200);
  assert.equal(paid.data.status, 'settled');
});

test('marking every transfer paid on an UNBALANCED game does not flip it to settled', async () => {
  const c = srv.client();
  const { id, hostHeaders, game } = await openGame(c, { players: [{ name: 'A' }, { name: 'B' }] });
  const [a, b] = game.players;
  await buyIn(c, id, a.id, 100);
  await buyIn(c, id, b.id, 100);
  await setFinal(c, id, a.id, 150); // claims 150 but only 200 was in play
  await setFinal(c, id, b.id, 0);   // → discrepancy, but a B→A 50 transfer exists
  const closed = await c.post(`/api/games/${id}/close`, undefined, hostHeaders);
  assert.equal(closed.data.status, 'ended');
  assert.equal(closed.data.settlement.balanced, false);
  assert.equal(closed.data.settlement.transfers.length, 1);
  const tid = closed.data.settlement.transfers[0].id;
  const paid = await c.put(`/api/games/${id}/settlement/${tid}`, { paid: true });
  assert.equal(paid.status, 200);
  assert.equal(paid.data.status, 'ended', 'an unbalanced game can never read as settled');
});

test('re-closing a closed game is rejected and preserves paid marks (H3)', async () => {
  const c = srv.client();
  const { id, hostHeaders } = await balancedWithTransfer(c);
  const closed = await c.post(`/api/games/${id}/close`, undefined, hostHeaders);
  const tid = closed.data.settlement.transfers[0].id;
  await c.put(`/api/games/${id}/settlement/${tid}`, { paid: true }); // now settled

  const again = await c.post(`/api/games/${id}/close`, undefined, hostHeaders);
  assert.equal(again.status, 409, 'a second close must be refused');

  const after = await c.get(`/api/games/${id}`);
  assert.equal(after.data.settlement.transfers[0].paid, true, 'paid mark must survive');
});

test('marking a non-existent transfer returns 404, not a silent 200 (H5)', async () => {
  const c = srv.client();
  const { id, hostHeaders } = await balancedWithTransfer(c);
  await c.post(`/api/games/${id}/close`, undefined, hostHeaders);
  const r = await c.put(`/api/games/${id}/settlement/NOPE1234`, { paid: true });
  assert.equal(r.status, 404);
});

test('final stack rejects negatives, non-numbers, unknown and unsafe ids (M1/M2)', async () => {
  const c = srv.client();
  const { id, game } = await openGame(c, { players: [{ name: 'A' }] });
  const pid = game.players[0].id;

  assert.equal((await setFinal(c, id, pid, -50)).status, 400, 'negative rejected');
  assert.equal((await setFinal(c, id, pid, 'abc')).status, 400, 'non-number rejected');
  assert.equal((await setFinal(c, id, 'ZZZZZZ', 10)).status, 400, 'unknown player rejected');
  assert.equal((await setFinal(c, id, '__proto__', 10)).status, 400, 'prototype key rejected');
  assert.equal((await setFinal(c, id, pid, 0.003)).status, 400, 'sub-cent rejected');
  assert.equal((await setFinal(c, id, pid, 0)).status, 200, 'zero (busted) accepted');
  assert.equal((await setFinal(c, id, pid, 75)).status, 200, 'valid value accepted');
  assert.equal((await setFinal(c, id, pid, null)).status, 200, 'clearing accepted');
});

test('whitespace-only player names are dropped at creation (M3)', async () => {
  const c = srv.client();
  const { game } = await openGame(c, { players: [{ name: '   ' }, { name: 'Bob' }] });
  assert.equal(game.players.length, 1);
  assert.equal(game.players[0].name, 'Bob');
});
