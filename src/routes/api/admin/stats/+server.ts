import { json } from '@sveltejs/kit';
import { timingSafeEqual } from 'node:crypto';
import { allUsers } from '$lib/server/users.js';
import { allGames } from '$lib/server/store.js';
import { userResults } from '$lib/server/insights.js';
import { isRealGame } from '$lib/engine/stats.js';
import { converter } from '$lib/server/fx.js';
import { isConvertibleUnit, cryptoTicker } from '$lib/utils/currencies.js';
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
  // at least 2 buy-ins (you need two people to put money in to have a game). This
  // keeps abandoned/test games (a single seat, or just one lone buy-in) out of the
  // played-game and engagement stats below.
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

  // Money lands in one of three buckets:
  //  - EUR: real fiat currencies, converted via the monthly FX rates.
  //  - points: big blinds + chips + any custom unit — play money with no real
  //    value, all counted 1:1 together.
  //  - crypto: BTC/etc. — kept in the actual coin amount, never converted/lumped.
  const conv = converter();
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const round6 = (n: number) => Math.round(n * 1e6) / 1e6; // crypto amounts
  /** classify a unit → 'eur' | 'pts' | a crypto ticker; returns the EUR-converted
   *  amount for fiat, else the raw amount. */
  const bucketOf = (unit: string, amount: number): { bucket: string; value: number } | null => {
    if (isConvertibleUnit(unit)) {
      const eur = conv(amount, unit, '€');
      return eur == null ? null : { bucket: 'eur', value: eur };
    }
    const tk = cryptoTicker(unit);
    if (tk) return { bucket: tk, value: amount };
    return { bucket: 'pts', value: amount }; // BB / chips / custom — 1:1
  };

  // Game-level aggregates — over actually-played games only (incl. anonymous players).
  const gameStatus: Record<string, number> = {};
  let totalSeats = 0;
  let totalBuyIns = 0;
  let eurSeats = 0, eurBuyInAmount = 0;
  let ptsSeats = 0, ptsBuyInAmount = 0;
  /** crypto ticker → { seats, amount } */
  const cryptoBuyIn: Record<string, { seats: number; amount: number }> = {};
  // Games per currency bucket, so we can average the whole pot ACROSS games
  // (avg pot / game — total money on the table per game, regardless of headcount).
  let eurGames = 0, ptsGames = 0;
  /** crypto ticker → game count */
  const cryptoGames: Record<string, number> = {};
  for (const g of played) {
    gameStatus[g.status] = (gameStatus[g.status] || 0) + 1;
    const seats = g.players?.length || 0;
    totalSeats += seats;
    totalBuyIns += (g.transactions?.length || 0);
    const unit = g.unit || '€';
    const gameTotal = (g.transactions || []).reduce((s: number, t: any) => s + (t.amount || 0), 0);
    const b = bucketOf(unit, gameTotal);
    if (!b) continue;
    if (b.bucket === 'eur') { eurSeats += seats; eurBuyInAmount += b.value; eurGames++; }
    else if (b.bucket === 'pts') { ptsSeats += seats; ptsBuyInAmount += b.value; ptsGames++; }
    else {
      (cryptoBuyIn[b.bucket] ??= { seats: 0, amount: 0 }); cryptoBuyIn[b.bucket].seats += seats; cryptoBuyIn[b.bucket].amount += b.value;
      cryptoGames[b.bucket] = (cryptoGames[b.bucket] || 0) + 1;
    }
  }
  const finishedGames = (gameStatus.ended || 0) + (gameStatus.settled || 0);

  // Per-account engagement: participation across ALL games (not just finished).
  let playersWhoPlayed = 0;
  let sumGames = 0;
  // Net stats: finished games only. Same three buckets as buy-ins.
  let eurNetSum = 0, eurNetPlayers = 0;
  let ptsNetSum = 0, ptsNetPlayers = 0;
  /** crypto ticker → { sum, players } */
  const cryptoNet: Record<string, { sum: number; players: number }> = {};
  let biggestNight: { net: number; handle: string; game: string } | null = null; // EUR
  for (const u of users) {
    // Count seats across actually-played games (active included).
    let seatCount = 0;
    for (const g of played) {
      if ((g.players || []).some((p: any) => p.userId === u.id)) seatCount++;
    }
    if (seatCount > 0) { playersWhoPlayed++; sumGames += seatCount; }
    // Net stats from finished games only.
    const results = userResults(played, u.id);
    let uEur = 0, uHasEur = false, uPts = 0, uHasPts = false;
    const uCrypto: Record<string, number> = {};
    for (const r of results) {
      const b = bucketOf(r.unit, r.net);
      if (!b) continue;
      if (b.bucket === 'eur') {
        uEur += b.value; uHasEur = true;
        if (!biggestNight || b.value > biggestNight.net) biggestNight = { net: round2(b.value), handle: u.handle, game: r.name };
      } else if (b.bucket === 'pts') { uPts += b.value; uHasPts = true; }
      else uCrypto[b.bucket] = (uCrypto[b.bucket] || 0) + b.value;
    }
    if (uHasEur) { eurNetSum += uEur; eurNetPlayers++; }
    if (uHasPts) { ptsNetSum += uPts; ptsNetPlayers++; }
    for (const [tk, v] of Object.entries(uCrypto)) { (cryptoNet[tk] ??= { sum: 0, players: 0 }); cryptoNet[tk].sum += v; cryptoNet[tk].players++; }
  }

  // Distinct players who played (including anonymous — no account linked).
  const allPlayerCount = new Set<string>();
  for (const g of played) {
    for (const p of (g.players || [])) allPlayerCount.add(p.id);
  }

  // Acquisition: where created games came from (first-party, cookieless). Only
  // games created after source-tracking shipped carry g.acquisition; untracked
  // legacy games are omitted. Attribution priority per game: explicit campaign
  // tag → SEO landing page → external referrer host → "direct".
  const sourceCounts: Record<string, number> = {};
  let trackedGames = 0;
  for (const g of games) {
    const a = (g as any).acquisition;
    if (!a) continue;
    trackedGames++;
    const bucket = a.ref || (a.landing && a.landing !== '/' ? a.landing : null) || a.referrer || 'direct';
    sourceCounts[bucket] = (sourceCounts[bucket] || 0) + 1;
  }
  const sources = Object.entries(sourceCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => ({ source, count }));

  // Open (public) games — the city-directory feature. These are always played in
  // BLINDS (social play, no real-money stakes), so their pot is a pure blind count.
  // Tracked separately from the money buckets above so open-game engagement is
  // visible without polluting the currency stats.
  let openLive = 0, openEver = 0, openSeats = 0, openBlinds = 0, openReq = 0, openApproved = 0;
  const openByCity: Record<string, number> = {};
  for (const g of games) {
    if (g.visibility === 'public') {
      openEver++;
      if (g.status === 'active' || g.status === 'scheduled') openLive++;
      openSeats += g.players?.length || 0;
      openBlinds += (g.transactions || []).reduce((s: number, t: any) => s + (t.amount || 0), 0);
      const city = (g.city || '').trim();
      if (city) openByCity[city] = (openByCity[city] || 0) + 1;
    }
    for (const r of (g.joinRequests || [])) {
      openReq++;
      if (r.status === 'approved') openApproved++;
    }
  }
  const openTopCities = Object.entries(openByCity).sort((a, b) => b[1] - a[1]).map(([city, count]) => ({ city, count }));

  // Recent games (newest first) for the games table. ISO timestamps compare
  // chronologically as strings; a game missing both dates coerces to '' → sorts
  // oldest (so it can't float to the top).
  const recencyKey = (g: any) => String(g.updatedAt || g.createdAt || '');
  const recentGames = [...games]
    .sort((a: any, b: any) => { const ka = recencyKey(a), kb = recencyKey(b); return ka < kb ? 1 : ka > kb ? -1 : 0; })
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
      // Money a person puts on the table (buy-ins + top-ups) per seat. EUR =
      // real currencies converted; pts = big blinds + chips + custom (1:1);
      // crypto = per-coin amounts.
      avgBuyInPerPlayerEUR: eurSeats ? round1(eurBuyInAmount / eurSeats) : 0,
      avgBuyInPerPlayerPts: ptsSeats ? round1(ptsBuyInAmount / ptsSeats) : 0,
      avgBuyInPerPlayerCrypto: Object.fromEntries(
        Object.entries(cryptoBuyIn).map(([tk, v]) => [tk, v.seats ? round6(v.amount / v.seats) : 0])
      ),
      // Avg pot per game: the whole pot (buy-ins + top-ups) ÷ number of games.
      avgPotPerGameEUR: eurGames ? round2(eurBuyInAmount / eurGames) : 0,
      avgPotPerGamePts: ptsGames ? round2(ptsBuyInAmount / ptsGames) : 0,
      avgPotPerGameCrypto: Object.fromEntries(
        Object.entries(cryptoBuyIn).map(([tk, v]) => [tk, cryptoGames[tk] ? round6(v.amount / cryptoGames[tk]) : 0])
      ),
      totalDistinctPlayers: allPlayerCount.size,
      recentGames,
      acquisition: { tracked: trackedGames, sources },
    },
    // Open home games (public city directory) — measured in blinds, not money.
    openGames: {
      listedNow: openLive,
      listedEver: openEver,
      seats: openSeats,
      blindsBoughtIn: Math.round(openBlinds),
      requests: openReq,
      approved: openApproved,
      topCities: openTopCities,
    },
    engagement: {
      playersWhoPlayed,
      avgGamesPerPlayer: playersWhoPlayed ? round1(sumGames / playersWhoPlayed) : 0,
      avgNetPerPlayerEUR: eurNetPlayers ? round2(eurNetSum / eurNetPlayers) : 0,
      avgNetPerPlayerPts: ptsNetPlayers ? round2(ptsNetSum / ptsNetPlayers) : 0,
      avgNetPerPlayerCrypto: Object.fromEntries(
        Object.entries(cryptoNet).map(([tk, v]) => [tk, v.players ? round6(v.sum / v.players) : 0])
      ),
      biggestNight, // in EUR
    },
  });
}
