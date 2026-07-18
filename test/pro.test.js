// Pro membership: isPro gating + setPro grant/revoke + publicUser exposure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PC_DATA_DIR = mkdtempSync(join(tmpdir(), 'pc-pro-'));
const users = await import('../src/lib/server/users.js');
users.init();

test('setPro grant/revoke, and publicUser exposes the crown flag', () => {
  const u = users.createLocal({ handle: 'prouser', pin: 'passcode1' });
  assert.equal(users.isPro(users.getUser(u.id)), false, 'free by default');
  assert.equal(users.publicUser(users.getUser(u.id)).pro, false);

  users.setPro(u.id, { status: 'active', plan: 'comp', since: new Date().toISOString(), grantedBy: 'admin' });
  assert.equal(users.isPro(users.getUser(u.id)), true, 'comp grant → Pro');
  assert.equal(users.publicUser(users.getUser(u.id)).pro, true, 'publicUser exposes pro → 👑');

  users.setPro(u.id, null);
  assert.equal(users.isPro(users.getUser(u.id)), false, 'revoked → not Pro');
});

test('seedConfiguredPro grants a comp Pro to PRO_HANDLES (idempotent)', () => {
  users.createLocal({ handle: 'founder1', pin: 'passcode1' });
  process.env.PRO_HANDLES = 'founder1, ghosthandle';
  assert.equal(users.seedConfiguredPro(), 1, 'granted the one existing handle, skipped the missing one');
  assert.equal(users.isPro(users.getByHandle('founder1')), true);
  assert.equal(users.seedConfiguredPro(), 0, 'idempotent — already Pro');
  delete process.env.PRO_HANDLES;
});

test('isPro status + renewal-date edge cases', () => {
  assert.equal(users.isPro(null), false);
  assert.equal(users.isPro({}), false);
  assert.equal(users.isPro({ pro: { status: 'canceled', plan: 'monthly' } }), false);
  assert.equal(users.isPro({ pro: { status: 'past_due', plan: 'monthly' } }), true, 'dunning grace keeps Pro');
  const past = new Date(Date.now() - 86_400_000).toISOString();
  assert.equal(users.isPro({ pro: { status: 'active', plan: 'yearly', currentPeriodEnd: past } }), false, 'expired paid → not Pro');
  const future = new Date(Date.now() + 86_400_000).toISOString();
  assert.equal(users.isPro({ pro: { status: 'active', plan: 'yearly', currentPeriodEnd: future } }), true);
  assert.equal(users.isPro({ pro: { status: 'active', plan: 'comp' } }), true, 'comp (no end date) → Pro');
});
