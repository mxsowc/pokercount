// Concurrency: two near-simultaneous joins must never create duplicate seats.
// This holds because the join handler does its check-and-insert with no `await`
// in between and getGame returns the live object, so under Node's single thread
// the second join always observes the first. These tests document/guard that
// invariant end-to-end (they are not a true interleaving stress test — the
// synchronous store makes a real interleave impossible to force over HTTP).

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, openGame } from './helpers/server.js';

let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.stop(); });

test('a signed-in user firing two joins at once gets exactly one seat', async () => {
  const host = srv.client();
  const { id } = await openGame(host, { players: [{ name: 'Host' }] });

  const joiner = srv.client();
  await joiner.post('/api/auth/signup', { handle: 'racer', displayName: 'Racer', pin: '1234' });
  const me = (await joiner.get('/api/me')).data.user;

  const [r1, r2] = await Promise.all([
    joiner.post(`/api/games/${id}/join`, { name: 'Racer' }),
    joiner.post(`/api/games/${id}/join`, { name: 'Racer' }),
  ]);
  assert.ok(r1.status === 200 && r2.status === 200, 'both joins succeed (one creates, one reuses)');

  const game = (await host.get(`/api/games/${id}`)).data;
  const mine = game.players.filter((p) => p.userId === me.id);
  assert.equal(mine.length, 1, 'must not create two seats for one account');
  // Both responses point at the same single seat.
  assert.equal(r1.data.playerId, r2.data.playerId);
  assert.equal(r1.data.playerId, mine[0].id);
});

test('two anonymous joins with the same name yield exactly one player', async () => {
  const host = srv.client();
  const { id } = await openGame(host, { players: [{ name: 'Host' }] });

  const c1 = srv.client();
  const c2 = srv.client();
  const [r1, r2] = await Promise.all([
    c1.post(`/api/games/${id}/join`, { name: 'Dup' }),
    c2.post(`/api/games/${id}/join`, { name: 'Dup' }),
  ]);

  const statuses = [r1.status, r2.status].sort();
  assert.deepEqual(statuses, [200, 409], 'one join wins, the other is told the name is taken');

  const game = (await host.get(`/api/games/${id}`)).data;
  const dups = game.players.filter((p) => p.name === 'Dup');
  assert.equal(dups.length, 1);
});
