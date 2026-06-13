// The single-file user and follow stores must FAIL FAST on a corrupt file
// rather than silently starting empty (which would log everyone out and break
// ownership checks) — M5.

import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { seedDataDir } from './helpers/server.js';

test('corrupt users.json / follows.json make init throw, not silently empty', async () => {
  const dir = seedDataDir({
    'users.json': '{ this is not valid json',
    'follows.json': 'also not json',
  });
  process.env.PC_DATA_DIR = dir;
  try {
    const users = await import('../server/users.js');
    const social = await import('../server/social.js');
    assert.throws(() => users.init(), /unreadable/i);
    assert.throws(() => social.init(), /unreadable/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
