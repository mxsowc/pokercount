import { json } from '@sveltejs/kit';
import { getGame, mutate, uid } from '$lib/server/store.js';
import { sessionUser, withProfiles } from '$lib/server/helpers.js';
import { rateLimit } from '$lib/server/ratelimit.js';
import { notify, hasRecentGameNotif } from '$lib/server/notifications.js';

// Keep the most recent messages on the game (home-game threads are small; this
// just stops a runaway thread from bloating the per-game JSON / SSE frames).
const MAX_THREAD = 200;

// POST /api/games/[id]/messages { text } → append to the game's coordination
// thread. Posting requires a signed-in player who's IN the game (or its owner),
// so public-game threads stay free of drive-by messages from strangers who
// haven't been seated. Reading is open to anyone with the game (it rides SSE).
export async function POST({ request, params }) {
  const su = sessionUser(request);
  if (!su) return json({ error: 'Sign in to post in the game chat' }, { status: 401 });
  if (!rateLimit('msg:' + su.id, 20, 60_000)) return json({ error: 'Slow down a moment.' }, { status: 429 });

  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });

  // Chat is scoped to private / invite-by-link games. A public directory game's
  // id is published on /homegames and its full payload is served over the
  // unauthenticated game read + SSE, so an open thread there would leak posts
  // (names, addresses) to anonymous visitors. Public games coordinate via the
  // approval (join-request) flow instead — keep chat off them.
  if (g0.visibility === 'public') {
    return json({ error: 'Chat isn’t available on public games.' }, { status: 403 });
  }

  const seated = g0.players.some((p: any) => p.userId === su.id);
  if (!seated && g0.ownerId !== su.id) {
    return json({ error: 'Join the game to post in its chat' }, { status: 403 });
  }

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, { status: 400 }); }
  const text = String(body?.text ?? '').trim().slice(0, 500);
  if (!text) return json({ error: 'Message cannot be empty' }, { status: 400 });

  const msg = { id: uid(8), userId: su.id, name: su.displayName, handle: su.handle ?? null, text, at: new Date().toISOString() };
  const game = mutate(id, (g: any) => {
    if (!Array.isArray(g.messages)) g.messages = [];
    g.messages.push(msg);
    if (g.messages.length > MAX_THREAD) g.messages = g.messages.slice(-MAX_THREAD);
  });

  // Ping the other seated accounts who aren't already watching — throttled to at
  // most once an hour each, since SSE already updates anyone with the game open.
  const snippet = text.slice(0, 60);
  for (const p of game.players) {
    if (!p.userId || p.userId === su.id) continue;
    if (hasRecentGameNotif(p.userId, g0.id, 'game_message')) continue;
    notify(p.userId, {
      type: 'game_message', actorId: 'user:' + su.id, actorName: su.displayName, actorHandle: su.handle,
      gameId: g0.id, gameCode: g0.code, text: `messaged ${g0.name}: “${snippet}”`,
    });
  }

  return json(withProfiles(game));
}
