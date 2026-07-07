import { json } from '@sveltejs/kit';
import { getGame, mutate } from '$lib/server/store.js';
import { getActor, logEntry, isGameHost, withProfiles } from '$lib/server/helpers.js';

// Host-only: lock the table (no new self-joins by code — the host adds players)
// or leave it open (anyone with the link/code can join). Like the kick action,
// this is gated on the signed host token so a random joiner can't flip it.
export async function PUT({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  if (!isGameHost(g0, request)) return json({ error: 'Only the host can lock the game' }, { status: 403 });
  const { locked } = await request.json();
  const actor = getActor(request);
  const game = mutate(id, (g: any) => {
    g.locked = !!locked;
    g.log.push(logEntry(actor, locked ? 'lock_game' : 'unlock_game', {}));
  });
  return json(withProfiles(game));
}
