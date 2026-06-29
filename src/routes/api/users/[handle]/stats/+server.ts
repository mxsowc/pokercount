import { json } from '@sveltejs/kit';
import { getByHandle, publicUser } from '$lib/server/users.js';
import { privacyBlock } from '$lib/server/helpers.js';
import { allGames } from '$lib/server/store.js';
import { computeUserStats } from '$lib/engine/stats.js';
import { converter } from '$lib/server/fx.js';

export function GET({ params, request }) {
  const u = getByHandle(params.handle);
  if (!u) return json({ error: 'no such player' }, { status: 404 });

  const blocked = privacyBlock(u, request);
  if (blocked) return json({ error: blocked.error, privacy: u.privacy }, { status: blocked.status });

  // Tally award votes received across all games, keyed by award (hardestToRead,
  // mostTilted, …). Generic over every category present in game.votes.
  const games = allGames();
  const badges: Record<string, number> = {};
  for (const g of games) {
    if (!g.votes) continue;
    const seat = g.players.find((p: any) => p.userId === u.id);
    if (!seat) continue;
    for (const [award, map] of Object.entries(g.votes as Record<string, Record<string, string>>)) {
      const got = Object.values(map).filter((pid) => pid === seat.id).length;
      if (got) badges[award] = (badges[award] || 0) + got;
    }
  }

  return json({
    user: publicUser(u),
    stats: computeUserStats(games, u.id, converter()),
    badges,
  });
}
