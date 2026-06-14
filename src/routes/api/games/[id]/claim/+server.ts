import { json } from '@sveltejs/kit';
import { getGame, mutate } from '$lib/server/store.js';
import { sessionUser, withProfiles } from '$lib/server/helpers.js';

// Claim an unclaimed seat as your account (a signed-out player attaching their
// spot after the fact).
export async function POST({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  const su = sessionUser(request);
  if (!su) return json({ error: 'sign in first' }, { status: 401 });
  const { playerId } = await request.json();

  const target = g0.players.find((x: any) => x.id === playerId);
  if (!target) return json({ error: 'player not found' }, { status: 404 });
  if (target.userId === su.id) return json(withProfiles(g0)); // already mine — no-op
  if (target.userId) return json({ error: 'That seat is already linked to someone else.' }, { status: 409 });
  // One seat per account per game.
  if (g0.players.some((p: any) => p.userId === su.id)) {
    return json({ error: "You're already seated in this game." }, { status: 409 });
  }

  const game = mutate(id, (g: any) => {
    const p = g.players.find((x: any) => x.id === playerId);
    if (p && !p.userId) p.userId = su.id;
  });
  return json(withProfiles(game));
}

// Leave / unlink: clear the account link from a seat — but only your own. The
// seat and its buy-ins stay intact; it just becomes anonymous again.
export async function DELETE({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  const su = sessionUser(request);
  if (!su) return json({ error: 'sign in first' }, { status: 401 });

  const mine = g0.players.find((p: any) => p.userId === su.id);
  if (!mine) return json(withProfiles(g0)); // nothing linked — no-op
  const game = mutate(id, (g: any) => {
    const p = g.players.find((x: any) => x.userId === su.id);
    if (p) delete p.userId;
  });
  return json(withProfiles(game));
}
