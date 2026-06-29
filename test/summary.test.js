// Monthly summary email: the 30-day window computation, auto-enrolment, the
// signed unsubscribe token, and the rendered email. File-backed stores point at
// an isolated PC_DATA_DIR (set before importing, like the other store tests).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pc-summary-'));
process.env.PC_DATA_DIR = dir;
const store = await import('../src/lib/server/store.js');
const users = await import('../src/lib/server/users.js');
const auth = await import('../src/lib/server/auth.js');
const { buildMonthlySummary, renderSummaryEmail } = await import('../src/lib/server/summary.js');

auth.initAuth(); // gives signUnsubToken a server secret to sign with
after(() => rmSync(dir, { recursive: true, force: true }));

const DAY = 86_400_000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

/** A finished 2-player € game where `uid` ends on `myFinal` (invested 100, so net
 *  = myFinal − 100). `ageMs` controls how long ago the result was. */
function finishedGame(uid, myFinal, ageMs) {
  const g = store.createGame({ name: 'N', unit: '€', players: [{ name: 'Me' }, { name: 'Opp' }] });
  store.mutate(g.id, (game) => {
    game.players[0].userId = uid;
    game.players[1].userId = 'opp';
    game.transactions.push({ id: 'a' + game.id, playerId: game.players[0].id, amount: 100, type: 'buyin', at: '2024-01-01' });
    game.transactions.push({ id: 'b' + game.id, playerId: game.players[1].id, amount: 100, type: 'buyin', at: '2024-01-01' });
    game.finalStacks[game.players[0].id] = myFinal;
    game.finalStacks[game.players[1].id] = 200 - myFinal; // books balance
    game.status = 'ended';
  });
  store.getGame(g.id).updatedAt = ago(ageMs); // touched() stamped 'now' — set the result time
  return g.id;
}

test('buildMonthlySummary covers ONLY the last 30 days', () => {
  const uid = 'u_window';
  finishedGame(uid, 150, 5 * DAY);   // +50, in window
  finishedGame(uid, 70, 10 * DAY);   // −30, in window
  finishedGame(uid, 200, 40 * DAY);  // +100, OUTSIDE the window (counts as previous month)
  const s = buildMonthlySummary(uid);
  assert.ok(s, 'has a summary');
  assert.equal(s.gamesPlayed, 2, 'only the two games inside 30 days');
  assert.equal(s.totalProfit, 20, '+50 −30');
  assert.equal(s.avgProfit, 10);
  assert.equal(s.best.net, 50);
  assert.equal(s.worst.net, -30);
  assert.equal(s.deltaVsPrev, -80, 'this month +20 vs previous month +100');
});

test('buildMonthlySummary is null when nothing finished in the window', () => {
  finishedGame('u_old', 150, 40 * DAY); // only an old game
  assert.equal(buildMonthlySummary('u_old'), null);
});

test('renderSummaryEmail outputs subject/html/text with a verifiable unsubscribe link', () => {
  finishedGame('u_render', 180, 3 * DAY); // +80
  const s = buildMonthlySummary('u_render');
  const { subject, html, text } = renderSummaryEmail({ id: 'u_render', handle: 'tester', displayName: 'Tester' }, s);
  assert.match(subject, /potcount month/);
  assert.match(html, /Tester/);
  const m = html.match(/unsubscribe\?u=u_render&t=([A-Za-z0-9_-]+)/);
  assert.ok(m, 'has an unsubscribe link');
  assert.ok(auth.verifyUnsubToken('u_render', m[1]), 'the unsubscribe token verifies');
  assert.match(text, /Unsubscribe:/);
});

test('opt-IN only: enrol needs both the ticked box AND an email', () => {
  // Ticked the box + gave an email → enrolled.
  const optedIn = users.createLocal({ handle: 'mailer', displayName: 'Mailer', pin: '1234', email: 'mailer@example.com', newsletter: true });
  assert.equal(optedIn.newsletter, true, 'consented + has email → enrolled');
  assert.ok(optedIn.lastSummaryEmailAt, 'stamped so the first email is ~30 days out');

  // Gave an email but did NOT tick the box → not enrolled (no pre-ticked consent).
  const noConsent = users.createLocal({ handle: 'quiet', displayName: 'Quiet', pin: '1234', email: 'quiet@example.com' });
  assert.equal(noConsent.newsletter, false, 'email but no consent → not enrolled');

  // Ticked the box but no email to send to → not enrolled.
  const noAddr = users.createLocal({ handle: 'pinonly', displayName: 'Pin', pin: '1234', newsletter: true });
  assert.equal(noAddr.newsletter, false, 'consent but no email → not enrolled');

  // Adding an email later does NOT silently subscribe — stays opt-in.
  users.updateProfile(noConsent.id, { email: 'quiet2@example.com' });
  assert.equal(users.getUser(noConsent.id).newsletter, false, 'changing email never auto-subscribes');

  // The account toggle / one-click unsubscribe still work.
  users.setNewsletter(noConsent.id, true);
  assert.equal(users.getUser(noConsent.id).newsletter, true, 'explicit opt-in via settings works');
  users.setNewsletter(optedIn.id, false);
  assert.equal(users.getUser(optedIn.id).newsletter, false, 'unsubscribe sticks');

  const tok = auth.signUnsubToken(optedIn.id);
  assert.ok(auth.verifyUnsubToken(optedIn.id, tok));
  assert.equal(auth.verifyUnsubToken('someone-else', tok), false, 'token is bound to its user');
});
