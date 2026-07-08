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

test('backfill confirms past debts 1 day after settling, and the debtor reads 1d', () => {
  const id = endedGameWithDebt();
  const before = getGame(id);
  assert.equal(before.settlement.transfers.length, 1, 'B owes A one transfer');
  assert.ok(!before.settlement.transfers[0].confirmedAt, 'starts unconfirmed');

  const n = backfillSettleConfirmations();
  assert.equal(n, 1, 'one transfer backfilled');

  const g = getGame(id);
  const t = g.settlement.transfers[0];
  assert.equal(t.paid, true);
  assert.equal(t.confirmed, true);
  assert.equal(t.confirmedBy, 'potcount');
  const delta = new Date(t.confirmedAt).getTime() - new Date(g.settlement.computedAt).getTime();
  assert.equal(delta, DAY, 'confirmed exactly one day after settling');
  assert.equal(g.status, 'settled', 'all transfers paid → game settled');

  // The debtor (B / ub) — who owed the transfer — now shows avg settle time 1d.
  const bStats = computeUserStats(allGames(), 'ub');
  assert.ok(bStats.settlementSpeed, 'debtor has a settlement-speed stat');
  assert.equal(bStats.settlementSpeed.avgDays, 1);
  assert.equal(bStats.settlementSpeed.count, 1);

  // The creditor (A / ua) never owed anything → no settle-time stat (as expected).
  assert.equal(computeUserStats(allGames(), 'ua').settlementSpeed, null);
});

test('backfill is idempotent (marker-guarded) and leaves real confirmations alone', () => {
  // A fresh debt confirmed "for real" 3 days after settling.
  const id = endedGameWithDebt();
  const real = getGame(id);
  const realAt = new Date(new Date(real.settlement.computedAt).getTime() + 3 * DAY).toISOString();
  mutate(id, (game) => {
    const t = game.settlement.transfers[0];
    t.paid = true; t.confirmed = true; t.confirmedAt = realAt; t.confirmedBy = 'someone';
  });

  // Marker already written by the first test's run → this is a no-op.
  assert.equal(backfillSettleConfirmations(), 0, 'does not run twice');
  assert.equal(getGame(id).settlement.transfers[0].confirmedAt, realAt, 'real confirmation untouched');
});
