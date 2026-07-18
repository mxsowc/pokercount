// Pre-game reminders: seated players get a 24h and a 2h nudge before a scheduled
// game, each fired once (deduped). Isolated PC_DATA_DIR.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pc-gamerem-'));
process.env.PC_DATA_DIR = dir;
const store = await import('../src/lib/server/store.js');
const notif = await import('../src/lib/server/notifications.js');
const { remindUpcomingGames } = await import('../src/lib/server/game-reminders.js');

after(() => rmSync(dir, { recursive: true, force: true }));

const HOUR = 60 * 60 * 1000;
let seq = 0;
const uid = () => 'user' + (++seq);

/** A scheduled game `hoursOut` in the future, seating the given ids (null = anon). */
function scheduledGame(hoursOut, ids) {
  const g = store.createGame({
    name: 'Night', players: ids.map((_, i) => ({ name: 'P' + i })),
    scheduledFor: new Date(Date.now() + hoursOut * HOUR).toISOString(),
  });
  store.mutate(g.id, (gm) => ids.forEach((id, i) => { if (id) gm.players[i].userId = id; }));
  return g.id;
}
const has = (userId, type) => notif.listNotifications(userId).some((n) => n.type === type);

test('scheduled game 20h out → seated players get the 24h reminder (once)', () => {
  const a = uid(), b = uid();
  const id = scheduledGame(20, [a, b]);
  assert.equal(store.getGame(id).status, 'scheduled');

  remindUpcomingGames();
  assert.ok(has(a, 'game_reminder_24h'));
  assert.ok(has(b, 'game_reminder_24h'));
  const before = notif.listNotifications(a).length;

  remindUpcomingGames(); // deduped — no second 24h reminder
  assert.equal(notif.listNotifications(a).length, before);
});

test('scheduled game ~1h out → seated players get the 2h reminder', () => {
  const a = uid(), b = uid();
  scheduledGame(1, [a, b]);
  remindUpcomingGames();
  assert.ok(has(a, 'game_reminder_2h'));
  assert.ok(has(b, 'game_reminder_2h'));
});

test('anonymous seats are not reminded', () => {
  const a = uid();
  scheduledGame(20, [a, null]);
  remindUpcomingGames();
  assert.ok(has(a, 'game_reminder_24h'));
  // (nothing to assert for the anon seat — it has no account to notify)
});

test('a game already past its start time is not reminded', () => {
  const a = uid(), b = uid();
  const id = scheduledGame(20, [a, b]);
  store.mutate(id, (gm) => { gm.scheduledFor = new Date(Date.now() - HOUR).toISOString(); }); // moved to the past
  remindUpcomingGames();
  assert.equal(has(a, 'game_reminder_24h'), false);
  assert.equal(has(a, 'game_reminder_2h'), false);
});

test('a game far out (>24h) is not reminded yet', () => {
  const a = uid();
  scheduledGame(72, [a]); // 3 days out
  remindUpcomingGames();
  assert.equal(has(a, 'game_reminder_24h'), false);
});
