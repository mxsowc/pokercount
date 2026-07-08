import { GUIDES } from '$lib/guides.js';

// SSR the guide index so crawlers get every guide as real HTML + internal links.
export function load() {
  return {
    guides: GUIDES.map((g) => ({
      slug: g.slug, emoji: g.emoji, title: g.title, tagline: g.tagline,
      description: g.description, readMins: g.readMins,
    })),
    meta: {
      title: 'potcount guides — how to run a home poker night',
      description: 'Step-by-step guides to every potcount feature: track a home game, settle up and confirm payments, split messy pots, use your stats, and host or find local games.',
    },
  };
}
