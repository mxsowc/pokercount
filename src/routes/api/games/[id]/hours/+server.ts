import { json } from '@sveltejs/kit';
import { getGame, mutate } from '$lib/server/store.js';
import { sessionUser, num } from '$lib/server/helpers.js';

// Log how long THIS signed-in user played this game — powers their personal
// €/hr stat. Deliberately allowed on finished/old games (it's a post-game
// annotation, not a money edit), and only ever for the caller's own seat.
export async function PUT({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  const su = sessionUser(request);
  if (!su) return json({ error: 'sign in to log hours' }, { status: 401 });
  const seat = (g0.players || []).find((p: any) => p.userId === su.id);
  if (!seat) return json({ error: 'you have no seat in this game' }, { status: 403 });

  const { hours } = await request.json();
  const clearing = hours === null || hours === '' || hours === undefined;
  let val = 0;
  if (!clearing) {
    val = Math.round(num(hours) * 100) / 100;
    if (!Number.isFinite(val) || val <= 0 || val > 1000) {
      return json({ error: 'Hours must be between 0 and 1000.' }, { status: 400 });
    }
  }

  const game = mutate(id, (g: any) => {
    if (!g.hours) g.hours = {};
    if (clearing) delete g.hours[seat.id];
    else g.hours[seat.id] = val;
  });
  return json(game);
}
