import { json } from '@sveltejs/kit';
import { timingSafeEqual } from 'node:crypto';
import { allUsers } from '$lib/server/users.js';
import { allGames } from '$lib/server/store.js';
import { userResults } from '$lib/server/insights.js';
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

  // Game-level aggregates (across ALL games, incl. anonymous players).
  const gameStatus: Record<string, number> = {};
  let totalSeats = 0;
  let totalBuyIns = 0;
  for (const g of games) {
    gameStatus[g.status] = (gameStatus[g.status] || 0) + 1;
    totalSeats += (g.players?.length || 0);
    totalBuyIns += (g.transactions?.length || 0);
  }
  const finishedGames = (gameStatus.ended || 0) + (gameStatus.settled || 0);

  // Per-account engagement: only accounts with finished-game results count.
  let playersWhoPlayed = 0;
  let sumGames = 0;
  let sumProfit = 0;
  let biggestNight: { net: number; handle: string; game: string } | null = null;
  for (const u of users) {
    const results = userResults(games, u.id);
    if (!results.length) continue;
    playersWhoPlayed++;
    sumGames += results.length;
    for (const r of results) {
      sumProfit += r.net;
      if (!biggestNight || r.net > biggestNight.net) biggestNight = { net: r.net, handle: u.handle, game: r.name };
    }
  }
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
      total: games.length,
      finished: finishedGames,
      byStatus: gameStatus,
      avgPlayers: games.length ? round1(totalSeats / games.length) : 0,
      buyIns: totalBuyIns,
    },
    engagement: {
      playersWhoPlayed,
      avgGamesPerPlayer: playersWhoPlayed ? round1(sumGames / playersWhoPlayed) : 0,
      avgNetPerPlayer: playersWhoPlayed ? round2(sumProfit / playersWhoPlayed) : 0,
      biggestNight,
    },
  });
}
