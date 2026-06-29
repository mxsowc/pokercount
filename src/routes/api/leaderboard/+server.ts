import { json } from '@sveltejs/kit';
import { sessionUser } from '$lib/server/helpers.js';
import { getFollowing } from '$lib/server/social.js';
import { getUser, allUsers, publicUser } from '$lib/server/users.js';
import { allGames } from '$lib/server/store.js';
import { computeLeaderboard } from '$lib/server/insights.js';
import { converter } from '$lib/server/fx.js';

export function GET({ request, url }) {
  const su = sessionUser(request);
  if (!su) return json({ error: 'sign in to see the leaderboard' }, { status: 401 });

  const scope = url.searchParams.get('scope') === 'global' ? 'global' : 'following';

  let set: Set<string>;
  if (scope === 'global') {
    // Everyone on potcount with a PUBLIC profile, plus yourself (so you always see
    // your own rank even if you're members/private). computeLeaderboard then drops
    // anyone without a real-game result.
    set = new Set(allUsers().filter((u) => (u.privacy || 'public') === 'public').map((u) => u.id));
    set.add(su.id);
  } else {
    // You + the people you follow; a followed person's PRIVATE profile is hidden.
    set = new Set(getFollowing(su.id));
    set.add(su.id);
    for (const id of [...set]) {
      if (id === su.id) continue;
      const u = getUser(id);
      if (u && u.privacy === 'private') set.delete(id);
    }
  }

  // Ranked across everyone, so nets are converted to a common currency (EUR).
  const rows = computeLeaderboard(allGames(), set, converter())
    .map((r) => { const u = getUser(r.id); return u ? { ...r, user: publicUser(u), you: r.id === su.id } : null; })
    .filter(Boolean);
  return json({ rows, scope });
}
