import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the store at a throwaway data dir BEFORE importing it (paths.js reads
// PC_DATA_DIR at module load).
const dir = mkdtempSync(join(tmpdir(), 'pc-reap-'));
process.env.PC_DATA_DIR = dir;
const { createGame, mutate, getGame, reapAbandonedGames, reapStaleGames, settleAndClose } = await import('../src/lib/server/store.js');

after(() => rmSync(dir, { recursive: true, force: true }));

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

/** Build a game, then backdate it and stock it with buy-ins. */
function makeGame({ players = [], buyins = 0, ageMs = 0 } = {}) {
  const g = createGame({ name: 'T', unit: '€', players });
  mutate(g.id, (game) => {
    game.createdAt = ago(ageMs);
    for (let i = 0; i < buyins; i++) {
      const pid = game.players[0]?.id || 'x';
      game.transactions.push({ id: 't' + i, playerId: pid, amount: 20, type: 'buyin', at: ago(ageMs) });
    }
  });
  return g.id;
}

test('reapAbandonedGames deletes an old single-player game', () => {
  const id = makeGame({ players: [{ name: 'Solo' }], buyins: 1, ageMs: 25 * 3600_000 });
  assert.equal(reapAbandonedGames(), 1);
  assert.equal(getGame(id), null);
});

test('reapAbandonedGames deletes an old multi-player game with no buy-ins', () => {
  const id = makeGame({ players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], buyins: 0, ageMs: 2 * DAY });
  reapAbandonedGames();
  assert.equal(getGame(id), null);
});

test('reapAbandonedGames deletes an old multi-player game with only one buy-in', () => {
  const id = makeGame({ players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], buyins: 1, ageMs: 2 * DAY });
  reapAbandonedGames();
  assert.equal(getGame(id), null, 'a lone single buy-in is not a real game');
});

test('reapAbandonedGames keeps a real old game (2+ players AND 2+ buy-ins)', () => {
  const id = makeGame({ players: [{ name: 'A' }, { name: 'B' }], buyins: 2, ageMs: 2 * DAY });
  reapAbandonedGames();
  assert.ok(getGame(id), 'a game with real history must survive');
});

test('reapAbandonedGames keeps a fresh trivial game (under 24h)', () => {
  const id = makeGame({ players: [{ name: 'Solo' }], buyins: 0, ageMs: 1000 });
  reapAbandonedGames();
  assert.ok(getGame(id), 'a recent game is not old enough to reap');
});

test('reapStaleGames auto-closes a game inactive 12h+, keeps a recently-active one', () => {
  const stale = makeGame({ players: [{ name: 'A' }, { name: 'B' }], buyins: 2, ageMs: 2 * DAY });
  const fresh = makeGame({ players: [{ name: 'C' }, { name: 'D' }], buyins: 2, ageMs: 2 * DAY });
  // makeGame's last mutate stamped updatedAt = now; inactivity is measured from
  // updatedAt, so backdate only `stale`.
  getGame(stale).updatedAt = ago(13 * HOUR);
  getGame(fresh).updatedAt = ago(1 * HOUR);
  reapStaleGames();
  assert.notEqual(getGame(stale).status, 'active', 'silent 13h game auto-closed');
  assert.equal(getGame(fresh).status, 'active', 'game active 1h ago stays open');
  assert.ok(getGame(stale).settlement, 'closed game has a frozen settlement');
});

test('settleAndClose freezes the settlement and flips status (all-cashed-out path)', () => {
  const g = createGame({ name: 'X', unit: '€', players: [{ name: 'A' }, { name: 'B' }] });
  mutate(g.id, (game) => {
    game.transactions.push({ id: 't1', playerId: game.players[0].id, amount: 20, type: 'buyin', at: ago(0) });
    game.transactions.push({ id: 't2', playerId: game.players[1].id, amount: 20, type: 'buyin', at: ago(0) });
    game.finalStacks[game.players[0].id] = 30;
    game.finalStacks[game.players[1].id] = 10;
  });
  // This is exactly what the /final route runs once every seat has cashed out.
  mutate(g.id, (game) => settleAndClose(game, { action: 'auto_close' }));
  const done = getGame(g.id);
  assert.notEqual(done.status, 'active', 'game closed');
  assert.ok(done.settlement, 'settlement frozen');
  assert.ok(done.settlement.transfers.length >= 1, 'a transfer is owed (30/10 split)');
  assert.ok(done.settlement.transfers.every((t) => t.id && t.paid === false), 'transfers get ids + unpaid flags');
  assert.ok(done.log.some((e) => e.action === 'auto_close'), 'auto_close logged');
});
