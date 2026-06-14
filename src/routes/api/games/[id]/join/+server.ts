import { json } from '@sveltejs/kit';
import { getGame, mutate, uid } from '$lib/server/store.js';
import { sessionUser, getActor, logEntry } from '$lib/server/helpers.js';

export async function POST({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  if (g0.status !== 'active') return json({ error: 'Game is closed.' }, { status: 409 });

  const su = sessionUser(request);
  const actor = su ? { id: 'user:' + su.id, name: su.displayName } : getActor(request);
  const { name } = await request.json();
  const nm = String(name || '').trim().slice(0, 40);
  if (!nm) return json({ error: 'name required' }, { status: 400 });

  // Check for duplicate names (case-insensitive)
  const lower = nm.toLowerCase();
  if (g0.players.some((p: any) => p.name.toLowerCase() === lower)) {
    return json({ error: `There's already a player called "${nm}" — pick a slightly different name.` }, { status: 409 });
  }

  let newId: string | null = null;
  const game = mutate(id, (g: any) => {
    if (su) {
      const existing = g.players.find((p: any) => p.userId === su.id);
      if (existing) { newId = existing.id; return; }
    }
    const np: any = { id: uid(6), name: nm };
    if (su) np.userId = su.id;
    g.players.push(np);
    newId = np.id;
    g.log.push(logEntry(actor, 'add_player', { playerId: np.id, playerName: np.name }));
  });
  return json({ game, playerId: newId });
}
