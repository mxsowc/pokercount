// init() must load ONLY real game files — never the sidecar JSON (reactions /
// comments / fx-rates / follows / users) or empty/corrupt files, which used to
// surface as a blank "ghost" game (id=undefined, un-openable, un-deletable).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// paths.js reads PC_DATA_DIR at module load — set it before importing the store.
const dir = mkdtempSync(join(tmpdir(), 'pc-init-'));
process.env.PC_DATA_DIR = dir;
const store = await import('../src/lib/server/store.js');

after(() => rmSync(dir, { recursive: true, force: true }));

test('init ignores sidecar + empty/malformed files, loads only real games', () => {
  const real = {
    id: 'G123456789AB', code: '4242', name: 'Real', unit: '€', status: 'active',
    createdAt: '2024-01-01', updatedAt: '2024-01-01', version: 1,
    players: [{ id: 'p0', name: 'A' }, { id: 'p1', name: 'B' }],
    transactions: [], finalStacks: {}, log: [],
  };
  writeFileSync(join(dir, real.id + '.json'), JSON.stringify(real));

  // Sidecar data files that must NOT be read as games:
  writeFileSync(join(dir, 'reactions.json'), JSON.stringify({ G123456789AB: { p0: { '👏': ['u1'] } } }));
  writeFileSync(join(dir, 'comments.json'), JSON.stringify({}));
  writeFileSync(join(dir, 'fx-rates.json'), JSON.stringify({ base: 'EUR', rates: { EUR: 1 } }));
  writeFileSync(join(dir, 'follows.json'), JSON.stringify({}));
  // Empty object + a malformed "game" missing id/status:
  writeFileSync(join(dir, 'EMPTY.json'), '{}');
  writeFileSync(join(dir, 'NOSTATUS.json'), JSON.stringify({ id: 'NOSTATUS', players: [] }));

  store.init();
  const all = store.allGames();
  assert.equal(all.length, 1, 'only the one real game loads');
  assert.equal(all[0].id, 'G123456789AB');
  assert.ok(store.getGame('G123456789AB'), 'real game is retrievable');

  // None of the sidecar/empty/malformed files became a game:
  assert.equal(store.getGame('reactions'), null);
  assert.equal(store.getGame('EMPTY'), null);
  assert.equal(store.getGame('NOSTATUS'), null);
  assert.ok(!all.some((g) => typeof g.id !== 'string' || !['active', 'ended', 'settled'].includes(g.status)),
    'no ghost games with missing id/status');
});
