import { json } from '@sveltejs/kit';
import { getByHandle, publicUser } from '$lib/server/users.js';
import { privacyBlock } from '$lib/server/helpers.js';
import { allGames } from '$lib/server/store.js';
import { computeUserStats } from '$lib/engine/stats.js';

export function GET({ params, request }) {
  const u = getByHandle(params.handle);
  if (!u) return json({ error: 'no such player' }, { status: 404 });

  const blocked = privacyBlock(u, request);
  if (blocked) return json({ error: blocked.error, privacy: u.privacy }, { status: blocked.status });

  return json({ user: publicUser(u), stats: computeUserStats(allGames(), u.id) });
}
