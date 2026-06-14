import { json } from '@sveltejs/kit';
import { getByHandle, publicUser } from '$lib/server/users.js';
import { allGames } from '$lib/server/store.js';
import { computeUserStats } from '$lib/engine/stats.js';

export function GET({ params }) {
  const u = getByHandle(params.handle);
  if (!u) return json({ error: 'no such player' }, { status: 404 });
  return json({ user: publicUser(u), stats: computeUserStats(allGames(), u.id) });
}
