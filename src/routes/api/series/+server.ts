import { json } from '@sveltejs/kit';
import { allGames } from '$lib/server/store.js';

// GET /api/series?name=Thursday+PLO — cumulative stats for a game series.
export function GET({ url }) {
  const name = url.searchParams.get('name')?.trim();
  if (!name) return json({ error: 'name parameter required' }, { status: 400 });

  const games = allGames()
    .filter((g: any) => g.series && g.series.toLowerCase() === name.toLowerCase() && g.status !== 'active')
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (!games.length) return json({ series: name, games: [], leaderboard: [] });

  // Build cumulative leaderboard by player name (since not all players have accounts)
  const byName: Record<string, { name: string; games: number; totalNet: number; wins: number }> = {};
  for (const g of games) {
    const lines = g.settlement?.lines || [];
    for (const l of lines) {
      const key = l.name.toLowerCase();
      if (!byName[key]) byName[key] = { name: l.name, games: 0, totalNet: 0, wins: 0 };
      byName[key].games++;
      byName[key].totalNet += l.net ?? 0;
      if ((l.net ?? 0) > 0) byName[key].wins++;
    }
  }
  const leaderboard = Object.values(byName).sort((a, b) => b.totalNet - a.totalNet);

  return json({
    series: name,
    gameCount: games.length,
    games: games.map((g: any) => ({
      id: g.id, name: g.name, createdAt: g.createdAt,
      players: g.players.length,
      winner: g.settlement?.lines?.slice().sort((a: any, b: any) => (b.net ?? 0) - (a.net ?? 0))[0]?.name,
    })),
    leaderboard,
  });
}
