// Player reports store + account-ban enforcement.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PC_DATA_DIR = mkdtempSync(join(tmpdir(), 'pc-reports-'));

const reports = await import('../src/lib/server/reports.js');
const users = await import('../src/lib/server/users.js');
const auth = await import('../src/lib/server/auth.js');
const helpers = await import('../src/lib/server/helpers.js');
auth.initAuth();
users.init();
reports.init();

const reqWith = (headers = {}) => new Request('http://test.local/', { headers });

test('addReport: one OPEN report per reporter→reported (a repeat just updates it)', () => {
  reports.addReport({ reporterId: 'A', reportedId: 'B', reason: 'unpaid', message: 'owes me 50' });
  reports.addReport({ reporterId: 'A', reportedId: 'B', reason: 'cheating', message: 'actually cheating' }); // update, not new
  reports.addReport({ reporterId: 'C', reportedId: 'B', reason: 'harassment', message: 'rude' });
  const open = reports.allReports().filter((r) => r.status === 'open');
  assert.equal(open.length, 2, 'A→B collapsed to one; C→B separate');
  const ab = open.find((r) => r.reporterId === 'A');
  assert.equal(ab.reason, 'cheating', 'repeat updated the reason/message');
});

test('removeUser drops reports authored by OR about a deleted account', () => {
  assert.equal(reports.removeUser('B'), true);
  assert.equal(reports.allReports().filter((r) => r.reportedId === 'B').length, 0);
});

test('banned account: login is blocked and live sessions are rejected', () => {
  const u = users.createLocal({ handle: 'banme', pin: 'passcode1' });
  // Valid session before the ban.
  const setCookie = auth.sessionCookie(u.id, reqWith({}));
  const token = setCookie.split(';')[0].slice('pc_session='.length);
  const authed = reqWith({ cookie: `pc_session=${token}` });
  assert.equal(helpers.sessionUser(authed)?.id, u.id, 'session works before ban');
  assert.equal(users.loginLocal({ handle: 'banme', pin: 'passcode1' }).id, u.id, 'login works before ban');

  assert.equal(users.setBanned(u.id, true), true);
  assert.equal(helpers.sessionUser(authed), null, 'live session rejected after ban');
  assert.throws(() => users.loginLocal({ handle: 'banme', pin: 'passcode1' }), /suspended/i, 'login blocked after ban');

  // Un-ban restores access.
  users.setBanned(u.id, false);
  assert.equal(helpers.sessionUser(authed)?.id, u.id, 'session works again after un-ban');
});

test('banned check comes AFTER auth (not an enumeration oracle)', () => {
  const u = users.createLocal({ handle: 'banme2', pin: 'passcode1' });
  users.setBanned(u.id, true);
  // Wrong password on a banned account still says "wrong", not "suspended".
  assert.throws(() => users.loginLocal({ handle: 'banme2', pin: 'nope' }), /Wrong name or passcode/);
});
