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

  const raw = url.searchParams.get('scope');
  const scope = raw === 'global' ? 'global' : raw === 'city' ? 'city' : 'following';

  // The city being ranked (only used for scope=city): a passed ?city= wins so you
  // can browse other cities' boards; otherwise your own home city.
  let cityLabel: string | null = null;

  let set: Set<string>;
  if (scope === 'city') {
    const wanted = (url.searchParams.get('city') || su.city || '').trim();
    const key = wanted.toLowerCase();
    if (!key) return json({ rows: [], scope, city: null });
    // Public profiles in that city (plus you, if it's yours), keeping the nicest-
    // cased label we find for display.
    set = new Set();
    for (const u of allUsers()) {
      if ((u.city || '').trim().toLowerCase() !== key) continue;
      if (!cityLabel) cityLabel = (u.city || '').trim();
      if ((u.privacy || 'public') === 'public' || u.id === su.id) set.add(u.id);
    }
    cityLabel = cityLabel || wanted;
  } else if (scope === 'global') {
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
  return json({ rows, scope, city: cityLabel });
}
