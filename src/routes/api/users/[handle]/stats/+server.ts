import { json } from '@sveltejs/kit';
import { getByHandle, publicUser } from '$lib/server/users.js';
import { sessionUser } from '$lib/server/helpers.js';
import { allGames } from '$lib/server/store.js';
import { computeUserStats } from '$lib/engine/stats.js';

export function GET({ params, request }) {
  const u = getByHandle(params.handle);
  if (!u) return json({ error: 'no such player' }, { status: 404 });

  // Privacy gate: 'public' = anyone, 'members' = any signed-in user, 'private' = owner only.
  const privacy = u.privacy || 'public';
  if (privacy !== 'public') {
    const me = sessionUser(request);
    if (privacy === 'private' && me?.id !== u.id) {
      return json({ error: 'This profile is private.', privacy }, { status: 403 });
    }
    if (privacy === 'members' && !me) {
      return json({ error: 'Sign in to view this profile.', privacy }, { status: 403 });
    }
  }

  return json({ user: publicUser(u), stats: computeUserStats(allGames(), u.id) });
}
