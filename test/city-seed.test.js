// One-off migration that sets specific accounts' home city to Amsterdam (and
// corrects Eric's country from Senegal → NL). Isolated PC_DATA_DIR.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pc-cityseed-'));
process.env.PC_DATA_DIR = dir;
const users = await import('../src/lib/server/users.js');

after(() => rmSync(dir, { recursive: true, force: true }));

test('seedHomeCities sets Amsterdam for the listed accounts and relocates Eric', () => {
  const ferdi = users.createLocal({ handle: 'ferdi', displayName: 'Ferdi', pin: '1234' });
  const eric = users.createLocal({ handle: 'eric', displayName: 'eric', pin: '1234' });
  users.saveOnboarding(eric.id, { country: 'senegal', ageRange: '55+' }); // Eric starts in Senegal
  const other = users.createLocal({ handle: 'someoneelse', displayName: 'Nope', pin: '1234' }); // not in the list

  const n = users.seedHomeCities();
  assert.equal(n, 2, 'only the two present listed handles were changed');

  assert.equal(users.getUser(ferdi.id).city, 'Amsterdam');
  assert.equal(users.getUser(eric.id).city, 'Amsterdam');
  assert.equal(users.getUser(eric.id).country, 'NL', 'Eric moved off Senegal');
  assert.equal(users.getUser(other.id).city ?? null, null, 'unlisted account untouched');

  // Idempotent — marker-guarded, never runs twice.
  assert.equal(users.seedHomeCities(), 0);
});
