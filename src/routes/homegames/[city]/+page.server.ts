import { redirect } from '@sveltejs/kit';
import { publicUsersByCity, getUser, allUsers } from '$lib/server/users.js';
import { publicGamesByCity, allGames } from '$lib/server/store.js';
import { sessionUser } from '$lib/server/helpers.js';
import { computeLeaderboard } from '$lib/server/insights.js';
import { converter } from '$lib/server/fx.js';
import { citySlug, cityLabel, cityCountry, INDEXABLE_MIN_PLAYERS } from '$lib/cities.js';

// SSR a city hub: open public games + the local players + a start-a-game CTA.
// Public, no auth — but when signed in we flag games you've already asked to join
// so the "Request sent" state survives a page reload (the request itself is
// stored on the game; the button was just forgetting it client-side).
export function load({ params, request }) {
  const slug = citySlug(params.city);
  const viewer = sessionUser(request);

  // Canonicalize the URL. Aliases ("den-haag"), stray casing/spacing or accents
  // all resolve to one slug — 308 to it so Google only ever sees (and indexes)
  // the canonical path, never a duplicate.
  if (slug && slug !== params.city) throw redirect(308, `/homegames/${slug}`);

  const { users, label: freeLabel } = publicUsersByCity(slug);
  const label = cityLabel(slug, freeLabel);
  const playerCount = users.length;

  // Public player ids in this city (same gate as the directory: public profiles,
  // minors excluded). Used to rank the city's top 10.
  const cityIds = new Set<string>();
  for (const u of allUsers()) {
    if (citySlug(u.city) !== slug) continue;
    if ((u.ageRange || '').trim().toLowerCase() === 'under 18') continue;
    if ((u.privacy || 'public') !== 'public') continue;
    cityIds.add(u.id);
  }

  // The top-10 ranking is shown ONLY to signed-in viewers — we don't publish
  // money results tied to handles on the unauthenticated, search-indexed page
  // (NL gambling-law / GDPR caution; see the open-games constraints). Logged-out
  // visitors just see the player count.
  let topPlayers: Array<{ rank: number; handle: string; net: number; games: number; you: boolean }> | null = null;
  if (viewer) {
    topPlayers = computeLeaderboard(allGames(), cityIds, converter())
      .slice(0, 10)
      .map((r, i) => {
        const u = getUser(r.id);
        return { rank: i + 1, handle: u?.handle ?? '?', net: r.net, games: r.games, you: r.id === viewer.id };
      });
  }

  // Projection of each open game with host info + player roster for the cards.
  const openGames = publicGamesByCity(slug).map((g) => {
    const host = g.ownerId ? getUser(g.ownerId) : null;
    const roster = g.players
      .map((p) => ({ name: p.name, handle: p.userId ? getUser(p.userId)?.handle ?? null : null }))
      .slice(0, 20);
    return {
      id: g.id,
      name: g.name,
      seated: g.players.length,
      maxPlayers: g.maxPlayers || 0,
      minBuyIn: g.minBuyIn || 0,
      maxBuyIn: g.maxBuyIn || 0,
      blinds: g.blinds || null,
      scheduledFor: g.scheduledFor || null,
      host: host ? { handle: host.handle, displayName: host.displayName, avatar: host.avatar || null } : null,
      roster,
      note: g.note || null,
      youRequested: !!viewer && (g.joinRequests || []).some((r) => r.userId === viewer.id && r.status === 'pending'),
      youSeated: !!viewer && g.players.some((p) => p.userId === viewer.id),
    };
  });

  // Thin pages hurt the whole domain: don't let Google index a city until it has
  // real content — enough public players OR at least one open game. Rendered
  // either way — just noindex + out-of-sitemap until then.
  const indexable = users.length >= INDEXABLE_MIN_PLAYERS || openGames.length >= 1;

  return {
    slug,
    label,
    country: cityCountry(slug),
    playerCount,
    topPlayers,
    openGames,
    indexable,
    meta: {
      title: `Home Poker Games in ${label} — Find Players & Open Tables · potcount`,
      description: openGames.length
        ? `${openGames.length} open home game${openGames.length === 1 ? '' : 's'} in ${label} on potcount — request a seat, or start your own. Free, nothing to install.`
        : playerCount
          ? `${playerCount} poker player${playerCount === 1 ? '' : 's'} in ${label} on potcount. Find a home game, see the local ranking, or start your own — free, nothing to install.`
          : `Be the first to start a home poker game in ${label}. potcount keeps score and tracks every player's record — free, nothing to install.`,
    },
  };
}
