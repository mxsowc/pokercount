import { json } from '@sveltejs/kit';
import { sessionUser } from '$lib/server/helpers.js';
import { getFollowing } from '$lib/server/social.js';
import { getUser, publicUser } from '$lib/server/users.js';
import { allGames } from '$lib/server/store.js';
import { computeLeaderboard } from '$lib/server/insights.js';

export function GET({ request }) {
  const su = sessionUser(request);
  if (!su) return json({ error: 'sign in to see the leaderboard' }, { status: 401 });
  // You + the people you follow, all time.
  const set = new Set(getFollowing(su.id));
  set.add(su.id);
  // Private profiles don't appear on other people's leaderboards (you always see yourself).
  for (const id of [...set]) {
    if (id === su.id) continue;
    const u = getUser(id);
    if (u && u.privacy === 'private') set.delete(id);
  }
  const rows = computeLeaderboard(allGames(), set)
    .map((r) => { const u = getUser(r.id); return u ? { ...r, user: publicUser(u), you: r.id === su.id } : null; })
    .filter(Boolean);
  return json({ rows });
}
