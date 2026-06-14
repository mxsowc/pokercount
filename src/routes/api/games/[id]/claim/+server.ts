import { json } from '@sveltejs/kit';
import { getGame, mutate } from '$lib/server/store.js';
import { sessionUser } from '$lib/server/helpers.js';

export async function POST({ request, params }) {
  const id = params.id.toUpperCase();
  if (!getGame(id)) return json({ error: 'game not found' }, { status: 404 });
  const su = sessionUser(request);
  if (!su) return json({ error: 'sign in first' }, { status: 401 });
  const { playerId } = await request.json();
  const game = mutate(id, (g: any) => {
    const p = g.players.find((x: any) => x.id === playerId);
    if (p && !p.userId) p.userId = su.id;
  });
  return json(game);
}
