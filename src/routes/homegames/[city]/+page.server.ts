import { redirect } from '@sveltejs/kit';
import { publicUsersByCity } from '$lib/server/users.js';
import { publicGamesByCity } from '$lib/server/store.js';
import { citySlug, cityLabel, cityCountry, INDEXABLE_MIN_PLAYERS } from '$lib/cities.js';

// SSR a city hub: open public games + the local players + a start-a-game CTA.
// Public, no auth.
export function load({ params }) {
  const slug = citySlug(params.city);

  // Canonicalize the URL. Aliases ("den-haag"), stray casing/spacing or accents
  // all resolve to one slug — 308 to it so Google only ever sees (and indexes)
  // the canonical path, never a duplicate.
  if (slug && slug !== params.city) throw redirect(308, `/homegames/${slug}`);

  const { users, label: freeLabel } = publicUsersByCity(slug);
  const label = cityLabel(slug, freeLabel);

  // Minimal, safe projection of each open game — never the roster, transactions
  // or the host's request queue, just what a card needs.
  const openGames = publicGamesByCity(slug).map((g) => ({
    id: g.id,
    name: g.name,
    seated: g.players.length,
    maxPlayers: g.maxPlayers || 0,
    minBuyIn: g.minBuyIn || 0, // in blinds
    maxBuyIn: g.maxBuyIn || 0, // in blinds; 0 = fixed buy-in (top-ups in-game)
    blinds: g.blinds || null,  // stakes level, e.g. { small: 1, big: 2 }
    scheduledFor: g.scheduledFor || null,
  }));

  // Thin pages hurt the whole domain: don't let Google index a city until it has
  // real content — enough public players OR at least one open game. Rendered
  // either way — just noindex + out-of-sitemap until then.
  const indexable = users.length >= INDEXABLE_MIN_PLAYERS || openGames.length >= 1;

  return {
    slug,
    label,
    country: cityCountry(slug),
    players: users,
    openGames,
    indexable,
    meta: {
      title: `Home Poker Games in ${label} — Find Players & Open Tables · potcount`,
      description: openGames.length
        ? `${openGames.length} open home game${openGames.length === 1 ? '' : 's'} in ${label} on potcount — request a seat, or start your own. Free, nothing to install.`
        : users.length
          ? `${users.length} poker player${users.length === 1 ? '' : 's'} in ${label} on potcount. Find a home game, see the local players, or start your own — free, nothing to install.`
          : `Be the first to start a home poker game in ${label}. potcount tracks every buy-in and settles who pays who — free, nothing to install.`,
    },
  };
}
