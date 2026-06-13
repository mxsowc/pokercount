// Authorization for host-only / destructive actions (reopen). The fix replaces
// the spoofable "does X-Actor-Id match the publicly-readable hostId?" check with
// a signed host token (anonymous) or the account session (owner). These tests
// would FAIL against the pre-fix server, where replaying the hostId was enough.

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, openGame, buyIn, setFinal } from './helpers/server.js';

let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.stop(); });

// Open + close a balanced (even) game so it's in a closed state to reopen.
async function closedGame(c, headers) {
  const { status, data } = await c.post('/api/games', { players: [{ name: 'A' }, { name: 'B' }] }, headers);
  assert.equal(status, 201);
  const id = data.id;
  const [a, b] = data.players;
  await buyIn(c, id, a.id, 10);
  await buyIn(c, id, b.id, 10);
  await setFinal(c, id, a.id, 10);
  await setFinal(c, id, b.id, 10);
  await c.post(`/api/games/${id}/close`, undefined, { 'X-Host-Token': data.hostToken });
  return { id, hostToken: data.hostToken };
}

async function signup(c, handle) {
  const r = await c.post('/api/auth/signup', { handle, displayName: handle, pin: '1234' });
  assert.equal(r.status, 201, `signup ${handle}: ${JSON.stringify(r.data)}`);
}

test('anonymous host can reopen with the host token', async () => {
  const c = srv.client();
  const { id, hostToken } = await closedGame(c, { 'X-Actor-Id': 'dev-host' });
  const r = await c.post(`/api/games/${id}/reopen`, undefined, { 'X-Host-Token': hostToken });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'active');
  assert.equal(r.data.settlement, undefined, 'reopen clears the frozen settlement');
});

test('reopen without the host token is rejected (403)', async () => {
  const c = srv.client();
  const { id } = await closedGame(c, { 'X-Actor-Id': 'dev-host' });
  const attacker = srv.client();
  const r = await attacker.post(`/api/games/${id}/reopen`, undefined, {});
  assert.equal(r.status, 403);
});

test('reopen with a forged host token is rejected (403)', async () => {
  const c = srv.client();
  const { id } = await closedGame(c, { 'X-Actor-Id': 'dev-host' });
  const r = await c.post(`/api/games/${id}/reopen`, undefined, { 'X-Host-Token': 'not-the-real-token' });
  assert.equal(r.status, 403);
});

test('replaying the publicly-readable hostId via X-Actor-Id no longer grants host (C2)', async () => {
  const c = srv.client();
  const { id } = await closedGame(c, { 'X-Actor-Id': 'dev-host' });

  // hostId is visible in the game body — the old attack read it and replayed it.
  const seen = await c.get(`/api/games/${id}`);
  assert.equal(seen.data.hostId, 'dev-host', 'hostId is readable (so replay must NOT be trusted)');

  const attacker = srv.client();
  const r = await attacker.post(`/api/games/${id}/reopen`, undefined, { 'X-Actor-Id': 'dev-host' });
  assert.equal(r.status, 403, 'matching the readable hostId must not authorize a host action');
});

test('account owner can reopen via session, with no host token', async () => {
  const c = srv.client();
  await signup(c, 'owner1');
  const { id } = await closedGame(c, {}); // created while logged in → ownerId set
  const r = await c.post(`/api/games/${id}/reopen`, undefined, {}); // cookie only
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'active');
});

test('a different account cannot reopen someone else\'s game', async () => {
  const owner = srv.client();
  await signup(owner, 'owner2');
  const { id } = await closedGame(owner, {});

  const other = srv.client();
  await signup(other, 'rando2');
  const r = await other.post(`/api/games/${id}/reopen`, undefined, {});
  assert.equal(r.status, 403);
});
