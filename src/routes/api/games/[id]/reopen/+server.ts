import { json } from '@sveltejs/kit';
import { getGame, mutate } from '$lib/server/store.js';
import { sessionUser, getActor, logEntry } from '$lib/server/helpers.js';
import { verifyGameToken } from '$lib/server/auth.js';

export async function POST({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  const su = sessionUser(request);
  const actor = su ? { id: 'user:' + su.id, name: su.displayName } : getActor(request);
  const hostToken = request.headers.get('x-host-token');
  const isHost = !g0.hostId
    || (su && g0.ownerId && g0.ownerId === su.id)
    || (hostToken && verifyGameToken(hostToken, g0.id))
    || (!g0.tokenedHost && g0.hostId === actor.id);
  if (!isHost) return json({ error: 'Only the host can reopen the game' }, { status: 403 });
  const game = mutate(id, (g: any) => {
    g.status = 'active';
    delete g.settlement;
    g.log.push(logEntry(actor, 'reopen_game', {}));
  });
  return json(game);
}
