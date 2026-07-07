import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolated data dir BEFORE importing the store (paths.js reads PC_DATA_DIR at load).
const dir = mkdtempSync(join(tmpdir(), 'pc-debt-'));
process.env.PC_DATA_DIR = dir;
const { createGame, mutate, settleAndClose, getGame } = await import('../src/lib/server/store.js');
const { listNotifications } = await import('../src/lib/server/notifications.js');
const { remindUnsettledDebts } = await import('../src/lib/server/debt-reminders.js');

after(() => rmSync(dir, { recursive: true, force: true }));

const HOUR = 3600_000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

// An ended game where the second seat (Debt) owes the first (Cred) 20. Accounts
// are linked with ids unique per game so each test's notifications are isolated,
// and the settlement is backdated so it reads as "ended `endedMsAgo` ago".
function endedDebt({ linkFrom = true, linkTo = true, endedMsAgo = 25 * HOUR } = {}) {
  const g = createGame({ name: 'T', unit: '€', players: [{ name: 'Cred' }, { name: 'Debt' }] });
  mutate(g.id, (game) => {
    if (linkTo) game.players[0].userId = 'cred_' + game.id;
    if (linkFrom) game.players[1].userId = 'debt_' + game.id;
    const c = game.players[0].id, d = game.players[1].id;
    game.transactions.push({ id: 'a', playerId: c, amount: 20, type: 'buyin', at: ago(0) });
    game.transactions.push({ id: 'b', playerId: d, amount: 20, type: 'buyin', at: ago(0) });
    game.finalStacks[c] = 40; game.finalStacks[d] = 0; // Debt owes Cred 20
  });
  mutate(g.id, (game) => settleAndClose(game, { action: 'close' }));
  mutate(g.id, (game) => { game.settlement.computedAt = ago(endedMsAgo); });
  return getGame(g.id);
}

test('reminds both linked parties 24h+ after an unpaid game, with an actionable payload', () => {
  const g = endedDebt();
  const cred = g.players[0].userId, debt = g.players[1].userId;
  remindUnsettledDebts();
  assert.deepEqual(listNotifications(debt).map((n) => n.type), ['debt_owe'], 'debtor gets "you owe"');
  assert.deepEqual(listNotifications(cred).map((n) => n.type), ['debt_owed'], 'creditor gets "you\'re owed"');
  const owe = listNotifications(debt)[0];
  assert.equal(owe.transferId, g.settlement.transfers[0].id, 'carries the transfer id to act on');
  assert.equal(owe.amount, 20);
  assert.equal(owe.unit, '€');
});

test('does not remind before 24h have passed', () => {
  const g = endedDebt({ endedMsAgo: 2 * HOUR });
  remindUnsettledDebts();
  assert.equal(listNotifications(g.players[1].userId).length, 0, 'a <24h debt is left alone');
});

test('is idempotent within the weekly window (no hourly nagging)', () => {
  const g = endedDebt();
  remindUnsettledDebts();
  const before = listNotifications(g.players[1].userId).length;
  remindUnsettledDebts(); // immediate second tick
  assert.equal(listNotifications(g.players[1].userId).length, before, 'a second tick does not pile on');
  assert.equal(before, 1);
});

test('only reminds seats linked to an account', () => {
  const g = endedDebt({ linkFrom: false }); // debtor is anonymous — nobody to ping
  remindUnsettledDebts();
  assert.equal(listNotifications(g.players[0].userId).length, 1, 'linked creditor still reminded');
});

test('stops reminding once the game is settled', () => {
  const g = endedDebt();
  mutate(g.id, (game) => { for (const t of game.settlement.transfers) t.paid = true; game.status = 'settled'; });
  remindUnsettledDebts();
  assert.equal(listNotifications(g.players[1].userId).length, 0, 'settled games are never reminded');
});
