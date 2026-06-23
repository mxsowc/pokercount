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

  // Count "hardest to read" votes received across all games
  const games = allGames();
  const hardestToReadCount = games.reduce((count: number, g: any) => {
    if (!g.votes?.hardestToRead) return count;
    const votedPlayerIds = Object.values(g.votes.hardestToRead) as string[];
    // Find the player seat linked to this user
    const seat = g.players.find((p: any) => p.userId === u.id);
    if (!seat) return count;
    return count + votedPlayerIds.filter((pid: string) => pid === seat.id).length;
  }, 0);

  return json({
    user: publicUser(u),
    stats: computeUserStats(games, u.id),
    badges: { hardestToRead: hardestToReadCount },
  });
}
