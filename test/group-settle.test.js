// Group "time to pay debts" shown on open-game cards: mean of each seated,
// account-linked player's own avg-settle-days. Private users excluded; aggregate
// only; needs >=2 contributors. Colour: green <3d, yellow 3-7d, red >7d.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pc-groupsettle-'));
process.env.PC_DATA_DIR = dir;
const store = await import('../src/lib/server/store.js');
const { groupSettleDays } = await import('../src/lib/server/insights.js');
const { settleSpeedFor } = await import('../src/lib/engine/stats.js');

after(() => rmSync(dir, { recursive: true, force: true }));

const DAY = 86_400_000;
let seq = 0;

/** Give `debtorId` one CONFIRMED debt settled `days` after the game — so their
 *  own avg-settle-days becomes exactly `days`. */
function debtGame(debtorId, days) {
  const g = store.createGame({ name: 'G', unit: '€', players: [{ name: 'D' }, { name: 'C' }] });
  store.mutate(g.id, (gm) => {
    gm.players[0].userId = debtorId;
    gm.players[1].userId = 'cred_' + (++seq);
    gm.transactions.push({ id: 'a' + gm.id, playerId: gm.players[0].id, amount: 100, type: 'buyin', at: '2024-01-01' });
    gm.transactions.push({ id: 'b' + gm.id, playerId: gm.players[1].id, amount: 100, type: 'buyin', at: '2024-01-01' });
    gm.finalStacks[gm.players[0].id] = 80;   // −20 → owes
    gm.finalStacks[gm.players[1].id] = 120;  // +20
  });
  store.mutate(g.id, (gm) => store.settleAndClose(gm, { action: 'auto_close' }));
  const gg = store.getGame(g.id);
  const computed = new Date(gg.settlement.computedAt).getTime();
  const debtorSeat = gg.players[0].id;
  store.mutate(g.id, (gm) => {
    for (const t of gm.settlement.transfers) {
      if (t.from === debtorSeat) { t.confirmed = true; t.confirmedAt = new Date(computed + days * DAY).toISOString(); }
    }
  });
  return debtorId;
}
/** A fresh debtor id with an avg-settle of `days`. */
function debtor(days) { const id = 'u' + (++seq); debtGame(id, days); return id; }
const games = () => store.allGames();

test('sanity: a single debtor settling in N days reads N', () => {
  const id = debtor(4);
  assert.equal(settleSpeedFor(games(), id).avgDays, 4);
});

test('green when the group average is under 3 days', () => {
  const a = debtor(1), b = debtor(2);
  const r = groupSettleDays(games(), [{ id: a }, { id: b }]);
  assert.equal(r.avgDays, 1.5);
  assert.equal(r.level, 'green');
  assert.equal(r.count, 2);
});

test('yellow at exactly 3 days (3 is yellow, not green)', () => {
  const a = debtor(3), b = debtor(3);
  const r = groupSettleDays(games(), [{ id: a }, { id: b }]);
  assert.equal(r.avgDays, 3);
  assert.equal(r.level, 'yellow');
});

test('yellow in the 3–7 day band', () => {
  const a = debtor(4), b = debtor(6);
  assert.equal(groupSettleDays(games(), [{ id: a }, { id: b }]).level, 'yellow');
});

test('yellow at exactly 7 days (boundary), red just above', () => {
  const a = debtor(7), b = debtor(7);
  assert.equal(groupSettleDays(games(), [{ id: a }, { id: b }]).level, 'yellow');
  const c = debtor(7), d = debtor(8);
  const red = groupSettleDays(games(), [{ id: c }, { id: d }]); // avg 7.5
  assert.equal(red.avgDays, 7.5);
  assert.equal(red.level, 'red');
});

test('red when the group is slow (>7 days)', () => {
  const a = debtor(8), b = debtor(12);
  assert.equal(groupSettleDays(games(), [{ id: a }, { id: b }]).level, 'red');
});

test('PRIVATE-profile players are excluded from the average', () => {
  const fast1 = debtor(2), fast2 = debtor(2), slowPrivate = debtor(30);
  const r = groupSettleDays(games(), [
    { id: fast1, privacy: 'public' },
    { id: fast2, privacy: 'members' },
    { id: slowPrivate, privacy: 'private' }, // must NOT drag the average up
  ]);
  assert.equal(r.count, 2, 'only the two non-private players count');
  assert.equal(r.avgDays, 2);
  assert.equal(r.level, 'green');
});

test('hidden unless at least 2 players contribute (no single-person leak)', () => {
  const a = debtor(3);
  assert.equal(groupSettleDays(games(), [{ id: a }]), null, 'one contributor → null');
  // Two seated, but only one has any settle history → still null.
  const b = debtor(3);
  assert.equal(groupSettleDays(games(), [{ id: b }, { id: 'never_settled_' + (++seq) }]), null);
  // Two seated, but one is private → the remaining single is not enough → null.
  const c = debtor(3), d = debtor(3);
  assert.equal(groupSettleDays(games(), [{ id: c }, { id: d, privacy: 'private' }]), null);
});

test('anonymous / no-account seats are ignored, not counted', () => {
  const a = debtor(2), b = debtor(4);
  const r = groupSettleDays(games(), [{ id: a }, null, undefined, { id: b }]);
  assert.equal(r.count, 2);
  assert.equal(r.avgDays, 3);
});

test('players with no confirmed debts do not count toward the group', () => {
  // Three seated, only two have settled anything → average over those two.
  const a = debtor(2), b = debtor(4);
  const r = groupSettleDays(games(), [{ id: a }, { id: b }, { id: 'no_history_' + (++seq) }]);
  assert.equal(r.count, 2);
  assert.equal(r.avgDays, 3);
});

test('a fully anonymous / no-history table shows nothing', () => {
  assert.equal(groupSettleDays(games(), [null, { id: 'x_' + (++seq) }, { id: 'y_' + (++seq) }]), null);
  assert.equal(groupSettleDays(games(), []), null);
});
