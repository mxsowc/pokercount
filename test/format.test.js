import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normFormat, FORMATS } from '../src/lib/formats.js';

test('normFormat defaults to NLH and normalizes known variants', () => {
  assert.equal(normFormat(''), 'NLH');
  assert.equal(normFormat(undefined), 'NLH');
  assert.equal(normFormat('nlh'), 'NLH');
  assert.equal(normFormat('  plo '), 'PLO');
  assert.equal(normFormat('PLO5'), 'PLO5');
  assert.equal(normFormat('mixed'), 'Mixed');
  assert.equal(normFormat('roulette'), 'NLH'); // unknown → NLH
  assert.ok(FORMATS.includes('NLH') && FORMATS[0] === 'NLH');
});

const dir = mkdtempSync(join(tmpdir(), 'pc-format-'));
process.env.PC_DATA_DIR = dir;
const store = await import('../src/lib/server/store.js');
after(() => rmSync(dir, { recursive: true, force: true }));

test('createGame: public games get a format (default NLH); private games have none', () => {
  const pub = store.createGame({ name: 'Open', players: [{ name: 'H' }], visibility: 'public', city: 'Amsterdam', smallBlind: 1, bigBlind: 2 });
  assert.equal(pub.format, 'NLH', 'default NLH');

  const plo = store.createGame({ name: 'Open PLO', players: [{ name: 'H' }], visibility: 'public', city: 'Amsterdam', smallBlind: 1, bigBlind: 2, format: 'plo' });
  assert.equal(plo.format, 'PLO');

  const priv = store.createGame({ name: 'Private', players: [{ name: 'H' }], format: 'PLO' });
  assert.equal(priv.format, undefined, 'private games do not carry a format');
});
