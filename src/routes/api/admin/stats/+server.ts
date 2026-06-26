import { json } from '@sveltejs/kit';
import { timingSafeEqual } from 'node:crypto';
import { allUsers } from '$lib/server/users.js';
import { allGames } from '$lib/server/store.js';
import { userResults } from '$lib/server/insights.js';
import { isRealGame } from '$lib/engine/stats.js';
import { rateLimit, clientIp } from '$lib/server/ratelimit.js';

// Gate: a single shared password from the env. No ADMIN_PASSWORD set = locked.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function passwordOk(provided: string): boolean {
  if (!ADMIN_PASSWORD) return false;
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(ADMIN_PASSWORD);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(event) {
  const { request } = event;
  // Throttle to stop password guessing.
  if (!rateLimit('admin:' + clientIp(event), 10, 60_000)) {
    return json({ error: 'Too many attempts — wait a minute.' }, { status: 429 });
  }
  if (!ADMIN_PASSWORD) {
    return json({ error: 'Admin is not configured yet (set the ADMIN_PASSWORD env var).' }, { status: 503 });
  }
  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }
  if (!passwordOk(body?.password)) {
    return json({ error: 'Wrong password' }, { status: 401 });
  }

  const users = allUsers();
  const games = allGames();
  const nowMs = Date.now();
  const DAY = 86_400_000;

  // A game only counts as "actually played" once there's a real table — see
  // isRealGame (shared with the stats engine and reaper): at least 2 players AND
  // at least one buy-in. This keeps abandoned/test games (a single seat, or no
  // money in) out of the played-game and engagement stats below.
  // (The recent-games table still lists every game so admins can spot/clean them.)
  const played = games.filter(isRealGame);

  const providers: Record<string, number> = {};
  const perDay: Record<string, number> = {};
  let withEmail = 0;
  let optedIn = 0;
  let active30 = 0;
  for (const u of users) {
    providers[u.provider] = (providers[u.provider] || 0) + 1;
    if (u.email) withEmail++;
    if (u.newsletter) optedIn++;
    if (u.lastSeenAt && nowMs - Date.parse(u.lastSeenAt) < 30 * DAY) active30++;
    const day = String(u.createdAt || '').slice(0, 10);
    if (day) perDay[day] = (perDay[day] || 0) + 1;
  }

  // Game-level aggregates — over actually-played games only (incl. anonymous players).
  const gameStatus: Record<string, number> = {};
  let totalSeats = 0;
  let totalBuyIns = 0;
  let totalBuyInAmount = 0;
  for (const g of played) {
    gameStatus[g.status] = (gameStatus[g.status] || 0) + 1;
    totalSeats += (g.players?.length || 0);
    totalBuyIns += (g.transactions?.length || 0);
    for (const t of (g.transactions || [])) totalBuyInAmount += (t.amount || 0);
  }
  const finishedGames = (gameStatus.ended || 0) + (gameStatus.settled || 0);

  // Per-account engagement: participation across ALL games (not just finished).
  let playersWhoPlayed = 0;
  let sumGames = 0;
  // Net stats: finished games only (active games have no final stacks).
  let sumProfit = 0;
  let playersWithResults = 0;
  let sumFinishedGames = 0;
  let biggestNight: { net: number; handle: string; game: string } | null = null;
  for (const u of users) {
    // Count seats across actually-played games (active included).
    let seatCount = 0;
    for (const g of played) {
      if ((g.players || []).some((p: any) => p.userId === u.id)) seatCount++;
    }
    if (seatCount > 0) { playersWhoPlayed++; sumGames += seatCount; }
    // Net stats from finished games only.
    const results = userResults(played, u.id);
    if (results.length) {
      playersWithResults++;
      sumFinishedGames += results.length;
      for (const r of results) {
        sumProfit += r.net;
        if (!biggestNight || r.net > biggestNight.net) biggestNight = { net: r.net, handle: u.handle, game: r.name };
      }
    }
  }

  // Distinct players who played (including anonymous — no account linked).
  const allPlayerCount = new Set<string>();
  for (const g of played) {
    for (const p of (g.players || [])) allPlayerCount.add(p.id);
  }

  // Recent games (newest first) for the games table.
  const recentGames = [...games]
    .sort((a: any, b: any) => (String(b.updatedAt || b.createdAt) < String(a.updatedAt || a.createdAt) ? -1 : 1))
    .slice(0, 20)
    .map((g: any) => ({
      id: g.id,
      code: g.code ?? g.id,
      name: g.name,
      status: g.status,
      players: g.players?.length || 0,
      transactions: g.transactions?.length || 0,
      pot: (g.transactions || []).reduce((s: number, t: any) => s + (t.amount || 0), 0),
      unit: g.unit || '€',
      updatedAt: g.updatedAt || g.createdAt,
    }));
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const round2 = (n: number) => Math.round(n * 100) / 100;

  // Newest first; never include pinHash.
  const recent = [...users]
    .sort((a, b) => (String(a.createdAt) < String(b.createdAt) ? 1 : -1))
    .slice(0, 30)
    .map((u) => ({
      handle: u.handle,
      displayName: u.displayName,
      provider: u.provider,
      email: u.email || null,
      newsletter: !!u.newsletter,
      ageRange: u.ageRange || null,
      country: u.country || null,
      heardFrom: u.heardFrom || null,
      createdAt: u.createdAt,
    }));

  return json({
    total: users.length,
    active30,
    withEmail,
    optedIn,
    providers,
    perDay,
    recent,
    games: {
      total: played.length,
      finished: finishedGames,
      byStatus: gameStatus,
      avgPlayers: played.length ? round1(totalSeats / played.length) : 0,
      buyIns: totalBuyIns,
      // Average money a person puts on the table (buy-ins + top-ups) per seat,
      // across all played games. Combines currencies, like the net figures.
      avgBuyInPerPlayer: totalSeats ? round1(totalBuyInAmount / totalSeats) : 0,
      totalDistinctPlayers: allPlayerCount.size,
      recentGames,
    },
    engagement: {
      playersWhoPlayed,
      avgGamesPerPlayer: playersWhoPlayed ? round1(sumGames / playersWhoPlayed) : 0,
      avgNetPerPlayer: playersWithResults ? round2(sumProfit / playersWithResults) : 0,
      biggestNight,
    },
  });
}
