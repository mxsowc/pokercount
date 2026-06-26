// Account linking + deletion. Exercises the file-backed stores directly (with an
// isolated PC_DATA_DIR) the same way the /api/me endpoints orchestrate them.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pc-acct-'));
process.env.PC_DATA_DIR = dir;
const users = await import('../src/lib/server/users.js');
const store = await import('../src/lib/server/store.js');
const social = await import('../src/lib/server/social.js');
const comments = await import('../src/lib/server/comments.js');
const reactions = await import('../src/lib/server/reactions.js');

after(() => rmSync(dir, { recursive: true, force: true }));

test('linkProvider: adds an OAuth identity that resolves to the same account', () => {
  const u = users.createLocal({ handle: 'alice', displayName: 'Alice', pin: '1234' });
  assert.equal(u.provider, 'local');
  users.linkProvider(u.id, { provider: 'google', sub: 'g-1', email: 'alice@example.com', avatar: null });
  // signing in with that Google identity now finds the SAME account
  assert.equal(users.getByProvider('google', 'g-1')?.id, u.id);
  // a verified email is adopted because the account had none
  assert.equal(users.getUser(u.id)?.email, 'alice@example.com');
  // the link is additive — the original PIN login still works
  assert.deepEqual(users.connectedProviders(users.getUser(u.id)), ['google']);
  assert.ok(users.verifyPin(u.id, '1234'), 'PIN login still works after linking');
});

test('linkProvider: rejects an identity already linked to another account', () => {
  const a = users.createLocal({ handle: 'bob', displayName: 'Bob', pin: '1234' });
  const b = users.createLocal({ handle: 'carol', displayName: 'Carol', pin: '1234' });
  users.linkProvider(a.id, { provider: 'google', sub: 'shared', email: null });
  assert.throws(() => users.linkProvider(b.id, { provider: 'google', sub: 'shared', email: null }), /already linked/);
});

test('unlinkProvider: removes the extra but never the original login', () => {
  const u = users.createLocal({ handle: 'dave', displayName: 'Dave', pin: '1234' });
  users.linkProvider(u.id, { provider: 'apple', sub: 'a-1', email: null });
  assert.equal(users.getByProvider('apple', 'a-1')?.id, u.id);
  users.unlinkProvider(u.id, 'apple');
  assert.equal(users.getByProvider('apple', 'a-1'), null, 'identity index cleared');
  assert.deepEqual(users.connectedProviders(users.getUser(u.id)), []);
  assert.throws(() => users.unlinkProvider(u.id, 'apple'), /not linked/);
});

test('delete + scrub: account erased, games kept but unlinked', () => {
  const u = users.createLocal({ handle: 'erin', displayName: 'Erin', pin: '1234' });
  const other = users.createLocal({ handle: 'frank', displayName: 'Frank', pin: '1234' });

  // a real game: Erin + Frank seated, a buy-in, Erin owns it and cast a vote
  const g = store.createGame({ name: 'Home', unit: '€', players: [{ name: 'Erin' }, { name: 'Frank' }] });
  store.mutate(g.id, (game) => {
    game.players[0].userId = u.id;
    game.players[1].userId = other.id;
    game.ownerId = u.id;
    game.transactions.push({ id: 't1', playerId: game.players[0].id, amount: 20, type: 'buyin', at: new Date(0).toISOString() });
    game.votes = { hardestToRead: { [u.id]: game.players[1].id, [other.id]: game.players[0].id } };
  });
  const erinSeat = g.players[0].id, frankSeat = g.players[1].id;

  // social + interactions referencing Erin
  social.follow(u.id, other.id);
  social.follow(other.id, u.id);
  comments.addComment(g.id, frankSeat, u.id, 'nice hand');
  reactions.toggleReaction(g.id, frankSeat, u.id, '🔥');

  // run the same scrub the delete endpoint does, then drop the account
  store.unlinkUser(u.id);
  social.removeUser(u.id);
  comments.removeUser(u.id);
  reactions.removeUser(u.id);
  assert.ok(users.deleteUser(u.id));

  // account fully erased
  assert.equal(users.getUser(u.id), null);
  assert.equal(users.getByHandle('erin'), null);

  // game survives; Erin's seat kept (name intact) but no longer linked; Frank untouched
  const gx = store.getGame(g.id);
  assert.ok(gx, 'game survives');
  assert.equal(gx.players[0].userId, undefined, 'Erin seat unlinked');
  assert.equal(gx.players[0].name, 'Erin', 'seat name preserved');
  assert.equal(gx.players[1].userId, other.id, 'Frank still linked');
  assert.equal(gx.ownerId, undefined, 'ownership marker scrubbed');
  assert.equal(gx.votes.hardestToRead[u.id], undefined, 'Erin\'s vote removed');
  assert.equal(gx.votes.hardestToRead[other.id], erinSeat, 'votes Erin received stay (seat-keyed)');

  // social graph + interactions scrubbed of Erin
  assert.equal(social.isFollowing(u.id, other.id), false);
  assert.equal(social.isFollowing(other.id, u.id), false);
  assert.equal(comments.getComments(g.id, frankSeat).length, 0);
  assert.equal(reactions.reactionSummary(g.id, frankSeat, other.id).counts['🔥'], undefined);
});
