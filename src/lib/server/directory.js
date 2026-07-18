// The public city directory, merged from two sources: public player profiles
// (users store) and open public games (game store). One place computes the
// per-city hubs AND the "is this worth indexing?" gate, so the index page, each
// city page, and the sitemap all agree.

import { cityDirectory, getUser } from './users.js';
import { allPublicGames, allGames } from './store.js';
import { groupSettleDays } from './insights.js';
import { citySlug, cityLabel, INDEXABLE_MIN_PLAYERS } from '../cities.js';

/** Public-safe projection of one open game — shared by the city directory and the
 *  standalone shareable game page (/g/[id]) so they never drift. `viewerId` is the
 *  signed-in viewer (for the "you requested / rejected / seated" flags); pass the
 *  games list to avoid recomputing it per card.
 *  @param {import('../types').Game} g @param {string | null} [viewerId]
 *  @param {import('../types').Game[]} [games] */
export function publicGameCard(g, viewerId = null, games = allGames()) {
  const host = g.ownerId ? getUser(g.ownerId) : null;
  const roster = (g.players || [])
    .map((p) => ({ name: p.name, handle: p.userId ? getUser(p.userId)?.handle ?? null : null }))
    .slice(0, 20);
  const seatedUsers = (g.players || []).filter((p) => p.userId).map((p) => getUser(p.userId));
  const reqs = g.joinRequests || [];
  return {
    id: g.id,
    name: g.name,
    city: g.city || null,
    citySlug: citySlug(g.city),
    seated: (g.players || []).length,
    maxPlayers: g.maxPlayers || 0,
    minBuyIn: g.minBuyIn || 0,
    maxBuyIn: g.maxBuyIn || 0,
    blinds: g.blinds || null,
    format: g.format || 'NLH',
    settle: groupSettleDays(games, seatedUsers),
    scheduledFor: g.scheduledFor || null,
    host: host ? { handle: host.handle, displayName: host.displayName, avatar: host.avatar || null } : null,
    roster,
    note: g.note || null,
    youRequested: !!viewerId && reqs.some((r) => r.userId === viewerId && r.status === 'pending'),
    youRejected: !!viewerId && reqs.some((r) => r.userId === viewerId && r.status === 'rejected'),
    youSeated: !!viewerId && (g.players || []).some((p) => p.userId === viewerId),
  };
}

/**
 * @typedef {{ slug: string, label: string, players: number, games: number, indexable: boolean }} CityHub
 */

/** All city hubs (public players + open games), busiest first. A hub is
 *  `indexable` once it has real content — enough public players OR at least one
 *  open game — so thin pages stay out of Google's index (and the sitemap).
 *  @returns {CityHub[]} */
export function cityHubs() {
  /** @type {Map<string, { slug: string, label: string, players: number, games: number }>} */
  const map = new Map();

  for (const c of cityDirectory()) {
    map.set(c.slug, { slug: c.slug, label: c.label, players: c.count, games: 0 });
  }
  for (const g of allPublicGames()) {
    const slug = citySlug(g.city);
    if (!slug) continue;
    const cur = map.get(slug) || { slug, label: cityLabel(slug, g.city || ''), players: 0, games: 0 };
    cur.games++;
    map.set(slug, cur);
  }

  const hubs = [...map.values()].map((h) => ({
    ...h,
    indexable: h.players >= INDEXABLE_MIN_PLAYERS || h.games >= 1,
  }));
  hubs.sort((a, b) => b.games - a.games || b.players - a.players || a.label.localeCompare(b.label));
  return hubs;
}
