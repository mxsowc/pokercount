import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the store at a throwaway data dir BEFORE importing it (paths.js reads
// PC_DATA_DIR at module load).
const dir = mkdtempSync(join(tmpdir(), 'pc-reap-'));
process.env.PC_DATA_DIR = dir;
const { createGame, mutate, getGame, reapAbandonedGames } = await import('../src/lib/server/store.js');

after(() => rmSync(dir, { recursive: true, force: true }));

const DAY = 24 * 60 * 60 * 1000;
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
