import { json } from '@sveltejs/kit';
import { getGame, mutate } from '$lib/server/store.js';

export async function PUT({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  if (g0.status !== 'active') return json({ error: 'Game is closed.' }, { status: 409 });
  const { name, unit } = await request.json();
  const game = mutate(id, (g: any) => {
    if (name) g.name = String(name).slice(0, 80);
    if (unit) g.unit = String(unit).slice(0, 4);
  });
  return json(game);
}
