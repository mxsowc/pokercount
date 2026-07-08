// Auto-infer a home city from who you consistently play with. Isolated PC_DATA_DIR.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pc-cityinfer-'));
process.env.PC_DATA_DIR = dir;
const store = await import('../src/lib/server/store.js');
const users = await import('../src/lib/server/users.js');

after(() => rmSync(dir, { recursive: true, force: true }));

let seq = 0;
function withCity(city) {
  const u = users.createLocal({ handle: 'usr' + (++seq), displayName: 'U' + seq, pin: '1234' });
  users.updateProfile(u.id, { city }); // explicit → evidence
  return u.id;
}
const amsUser = () => withCity('Amsterdam');
const rotUser = () => withCity('Rotterdam');
const cityless = () => users.createLocal({ handle: 'usr' + (++seq), displayName: 'U' + seq, pin: '1234' }).id;

/** A real game (≥2 players, 2 buy-ins) seating the given accounts; null = anonymous. */
function game(seats) {
  const g = store.createGame({ name: 'G', unit: '€', players: seats.map((_, i) => ({ name: 'P' + i })) });
  store.mutate(g.id, (gm) => {
    seats.forEach((uid, i) => { if (uid) gm.players[i].userId = uid; });
    gm.transactions.push({ id: 'a' + gm.id, playerId: gm.players[0].id, amount: 20, type: 'buyin', at: '2024-01-01' });
    gm.transactions.push({ id: 'b' + gm.id, playerId: gm.players[1].id, amount: 20, type: 'buyin', at: '2024-01-01' });
  });
  return g.id;
}

test('infers a city after >2 games consistently with players from one city', () => {
  const hero = cityless();
  for (let i = 0; i < 3; i++) game([hero, amsUser()]);
  assert.ok(users.inferCitiesFromCoplayers(store.allGames()) >= 1);
  const u = users.getUser(hero);
  assert.equal(u.city, 'Amsterdam');
  assert.equal(u.cityInferred, true);
});

test('2 games is not enough — needs MORE than 2', () => {
  const hero = cityless();
  game([hero, amsUser()]); game([hero, amsUser()]);
  users.inferCitiesFromCoplayers(store.allGames());
  assert.equal(users.getUser(hero).city ?? null, null);
});

test('multi-city games are ignored (no single consistent city)', () => {
  const hero = cityless();
  for (let i = 0; i < 3; i++) game([hero, amsUser(), rotUser()]); // each game spans two cities
  users.inferCitiesFromCoplayers(store.allGames());
  assert.equal(users.getUser(hero).city ?? null, null, 'ambiguous game → no vote');
});

test('anonymous seats are ignored and never block a single-city inference', () => {
  const hero = cityless();
  for (let i = 0; i < 3; i++) game([hero, amsUser(), null]); // Amsterdam + an anonymous seat
  users.inferCitiesFromCoplayers(store.allGames());
  assert.equal(users.getUser(hero).city, 'Amsterdam');
});

test('never overrides a city the user set themselves', () => {
  const decided = cityless();
  users.updateProfile(decided, { city: 'Utrecht' });
  for (let i = 0; i < 3; i++) game([decided, amsUser()]);
  users.inferCitiesFromCoplayers(store.allGames());
  assert.equal(users.getUser(decided).city, 'Utrecht');
});

test('an inferred city is NOT used as evidence (no cascade)', () => {
  const h1 = cityless();
  for (let i = 0; i < 3; i++) game([h1, amsUser()]);
  users.inferCitiesFromCoplayers(store.allGames());
  assert.equal(users.getUser(h1).city, 'Amsterdam'); // h1 is now inferred-Amsterdam

  const h2 = cityless();
  for (let i = 0; i < 3; i++) game([h2, h1]); // only ever plays with inferred-Amsterdam h1
  users.inferCitiesFromCoplayers(store.allGames());
  assert.equal(users.getUser(h2).city ?? null, null, 'inferred city gives no evidence');
});
