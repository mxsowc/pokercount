import { json } from '@sveltejs/kit';
import { getGame, mutate, uid } from '$lib/server/store.js';
import { getActor, logEntry } from '$lib/server/helpers.js';

export async function POST({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  if (g0.status !== 'active') return json({ error: 'Game is closed.' }, { status: 409 });
  const actor = getActor(request);
  const { name } = await request.json();
  if (!name || !String(name).trim()) return json({ error: 'name required' }, { status: 400 });
  const game = mutate(id, (g: any) => {
    const np = { id: uid(6), name: String(name).trim().slice(0, 40) };
    g.players.push(np);
    g.log.push(logEntry(actor, 'add_player', { playerId: np.id, playerName: np.name }));
  });
  return json(game);
}
