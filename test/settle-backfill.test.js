// One-time historical backfill that seeds the "avg settle time" stat to 1 day for
// past debts (marks old settlement transfers paid + confirmed a day after the
// game). Isolated PC_DATA_DIR, set before importing the store.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pc-settle-'));
process.env.PC_DATA_DIR = dir;
const { createGame, mutate, getGame, allGames, settleAndClose, backfillSettleConfirmations } =
  await import('../src/lib/server/store.js');
const { computeUserStats } = await import('../src/lib/engine/stats.js');

after(() => rmSync(dir, { recursive: true, force: true }));

const DAY = 24 * 60 * 60 * 1000;

/** A finished 2-player € game: A ends +20, B ends −20, so B owes A one transfer. */
function endedGameWithDebt() {
  const g = createGame({ name: 'N', unit: '€', players: [{ name: 'A' }, { name: 'B' }] });
  mutate(g.id, (game) => {
    game.players[0].userId = 'ua';
    game.players[1].userId = 'ub';
    game.transactions.push({ id: 'a' + game.id, playerId: game.players[0].id, amount: 20, type: 'buyin', at: '2024-01-01' });
    game.transactions.push({ id: 'b' + game.id, playerId: game.players[1].id, amount: 20, type: 'buyin', at: '2024-01-01' });
    game.finalStacks[game.players[0].id] = 40; // +20
    game.finalStacks[game.players[1].id] = 0;  // −20 → owes A
  });
  mutate(g.id, (game) => settleAndClose(game, { action: 'auto_close' })); // builds unconfirmed transfers
  return g.id;
}

test('backfill resets EVERY past debt to 1 day — even ones already confirmed', () => {
  const id = endedGameWithDebt();
  const g0 = getGame(id);
  const computed = new Date(g0.settlement.computedAt).getTime();
  // Simulate a pre-existing REAL confirmation 3 days out (the data we're discarding).
  mutate(id, (game) => {
    const t = game.settlement.transfers[0];
    t.paid = true; t.paidAt = new Date(computed + 3 * DAY).toISOString();
    t.confirmed = true; t.confirmedAt = new Date(computed + 3 * DAY).toISOString(); t.confirmedBy = 'someone';
  });

  const n = backfillSettleConfirmations();
  assert.equal(n, 1, 'one transfer reset');

  const t = getGame(id).settlement.transfers[0];
  const delta = new Date(t.confirmedAt).getTime() - computed;
  assert.equal(delta, DAY, 'the real 3-day confirmation was overwritten to 1 day');
  assert.equal(getGame(id).status, 'settled', 'all transfers paid → game settled');

  // The debtor (B / ub) now reads exactly 1d — not a 3d/blend.
  const bStats = computeUserStats(allGames(), 'ub');
  assert.ok(bStats.settlementSpeed, 'debtor has a settlement-speed stat');
  assert.equal(bStats.settlementSpeed.avgDays, 1);

  // The creditor (A / ua) never owed anything → no settle-time stat (as expected).
  assert.equal(computeUserStats(allGames(), 'ua').settlementSpeed, null);
});

test('backfill is idempotent (marker-guarded) — never runs twice', () => {
  // A game finished AFTER the migration already ran must be left completely alone.
  const id = endedGameWithDebt();
  const realAt = new Date(new Date(getGame(id).settlement.computedAt).getTime() + 3 * DAY).toISOString();
  mutate(id, (game) => {
    const t = game.settlement.transfers[0];
    t.paid = true; t.confirmed = true; t.confirmedAt = realAt; t.confirmedBy = 'someone';
  });
  assert.equal(backfillSettleConfirmations(), 0, 'marker present → no-op');
  assert.equal(getGame(id).settlement.transfers[0].confirmedAt, realAt, 'post-migration data untouched');
});
