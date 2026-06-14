import { json } from '@sveltejs/kit';
import { sessionUser } from '$lib/server/helpers.js';
import { getFollowing } from '$lib/server/social.js';
import { getUser, publicUser } from '$lib/server/users.js';
import { allGames } from '$lib/server/store.js';
import { reactionSummary } from '$lib/server/reactions.js';
import { getComments } from '$lib/server/comments.js';
import { netFor } from '$lib/server/insights.js';

export function GET({ request }) {
  const su = sessionUser(request);
  if (!su) return json({ error: 'sign in to see your feed' }, { status: 401 });
  const followedIds = getFollowing(su.id);
  const games = allGames();

  const items: any[] = [];
  for (const g of games) {
    if (g.status !== 'ended' && g.status !== 'settled') continue;
    for (const p of g.players) {
      if (!p.userId || !followedIds.has(p.userId)) continue;
      const net = netFor(g, p.id); // same net the leaderboard/stats use (frozen line, else computed)
      const u = getUser(p.userId);
      if (!u) continue;
      items.push({
        user: publicUser(u),
        game: { id: g.id, name: g.name },
        playerId: p.id,
        net, unit: g.unit || '€',
        at: g.settlement?.computedAt || g.updatedAt,
        status: g.status,
        reactions: reactionSummary(g.id, p.id, su.id),
        comments: getComments(g.id, p.id).map((c) => {
          const cu = getUser(c.userId);
          return { id: c.id, text: c.text, at: c.at, user: cu ? publicUser(cu) : { displayName: '?', handle: '' } };
        }),
      });
    }
  }
  items.sort((a, b) => (a.at < b.at ? 1 : -1));
  return json({ items: items.slice(0, 30) });
}
