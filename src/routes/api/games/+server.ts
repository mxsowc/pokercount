import { json } from '@sveltejs/kit';
import { createGame, mutate, uid } from '$lib/server/store.js';
import { sessionUser, getActor, logEntry } from '$lib/server/helpers.js';
import { signGameToken } from '$lib/server/auth.js';

export async function POST({ request }) {
  const su = sessionUser(request);
  const actor = su ? { id: 'user:' + su.id, name: su.displayName } : getActor(request);
  const body = await request.json();
  let game;
  try {
    game = createGame(body);
  } catch (e: any) {
    return json({ error: e.message }, { status: e.status || 400 });
  }
  game = mutate(game.id, (g: any) => {
    g.hostId = actor.id;
    g.tokenedHost = true;
    if (su) {
      g.ownerId = su.id;
      if (g.players[0]) g.players[0].userId = su.id;
    }
    g.log.push(logEntry(actor, 'create', { detail: { name: g.name } }));
  });
  return json({ ...game, hostToken: signGameToken(game.id) }, { status: 201 });
}
