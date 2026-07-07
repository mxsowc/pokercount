import { cityHubs } from '$lib/server/directory.js';

// SSR the city directory so crawlers get the full list of local hubs as real
// HTML (and it's the internal-link hub that spreads crawl/authority to every
// city page). Public — no auth required.
export function load() {
  return {
    cities: cityHubs(),
    meta: {
      title: 'Find a home poker game near you · potcount',
      description:
        'Browse local poker players and open home games by city — find a table or start your own. potcount tracks every buy-in and settles who pays who. Free, nothing to install.',
    },
  };
}
