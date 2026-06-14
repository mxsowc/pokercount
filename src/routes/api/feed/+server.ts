import { json } from '@sveltejs/kit';
import { sessionUser } from '$lib/server/helpers.js';
import { getFollowing } from '$lib/server/social.js';
import { getUser, publicUser } from '$lib/server/users.js';
import { allGames } from '$lib/server/store.js';

export function GET({ request }) {
  const su = sessionUser(request);
  if (!su) return json({ error: 'sign in to see your feed' }, { status: 401 });
  const followedIds = getFollowing(su.id);
  if (followedIds.size === 0) return json({ items: [] });

  const items: any[] = [];
  for (const g of allGames()) {
    if (g.status !== 'ended' && g.status !== 'settled') continue;
    for (const p of g.players) {
      if (!p.userId || !followedIds.has(p.userId)) continue;
      let net = 0;
      if (g.settlement?.lines) {
        const ln = g.settlement.lines.find((l: any) => l.playerId === p.id);
        if (ln?.net != null) net = ln.net;
      }
      const u = getUser(p.userId);
      if (!u) continue;
      items.push({
        user: publicUser(u),
        game: { id: g.id, name: g.name },
        net, unit: g.unit || '\u20ac',
        at: g.settlement?.computedAt || g.updatedAt,
        status: g.status,
      });
    }
  }
  items.sort((a, b) => (a.at < b.at ? 1 : -1));
  return json({ items: items.slice(0, 30) });
}
