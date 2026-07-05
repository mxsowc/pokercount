// Cumulative stats for a recurring game series, shared by the /api/series
// endpoint (client) and the /series/[slug] page load (SSR). Aggregation is
// ACCOUNT-KEYED: a linked player is tracked by userId so a rename mid-season
// doesn't split their record; only guests fall back to name.
import { allGames } from './store.js';
import { getUser } from './users.js';
import { getSeriesMeta } from './seriesmeta.js';

/** @param {string} name */
export function seriesStats(name) {
  const q = String(name || '').trim().toLowerCase();
  const games = allGames()
    .filter((g) => g.series && g.series.toLowerCase() === q && g.status !== 'active')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  /** @type {Record<string, { name: string, handle: string|null, games: number, totalNet: number, wins: number }>} */
  const by = {};
  for (const g of games) {
    /** @type {Record<string, string|undefined>} */
    const seatUser = {};
    for (const p of g.players || []) seatUser[p.id] = p.userId;
    for (const l of g.settlement?.lines || []) {
      const uid = seatUser[l.playerId];
      const key = uid ? `u:${uid}` : `n:${l.name.toLowerCase()}`;
      // games are newest-first, so the first sighting sets the current name/handle.
      if (!by[key]) by[key] = { name: l.name, handle: uid ? getUser(uid)?.handle ?? null : null, games: 0, totalNet: 0, wins: 0 };
      by[key].games++;
      by[key].totalNet += l.net ?? 0;
      if ((l.net ?? 0) > 0) by[key].wins++;
    }
  }
  const leaderboard = Object.values(by).sort((a, b) => b.totalNet - a.totalNet);

  return {
    series: games[0]?.series || name,
    gameCount: games.length,
    unit: games[0]?.unit || '€',
    nextDate: getSeriesMeta(name).nextDate,
    games: games.map((g) => ({
      id: g.id, code: g.code ?? g.id, name: g.name, createdAt: g.createdAt,
      players: g.players.length,
      winner: (g.settlement?.lines || []).slice().sort((a, b) => (b.net ?? 0) - (a.net ?? 0))[0]?.name || null,
    })),
    leaderboard,
  };
}
