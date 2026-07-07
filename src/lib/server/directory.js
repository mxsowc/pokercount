// The public city directory, merged from two sources: public player profiles
// (users store) and open public games (game store). One place computes the
// per-city hubs AND the "is this worth indexing?" gate, so the index page, each
// city page, and the sitemap all agree.

import { cityDirectory } from './users.js';
import { allPublicGames } from './store.js';
import { citySlug, cityLabel, INDEXABLE_MIN_PLAYERS } from '../cities.js';

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
