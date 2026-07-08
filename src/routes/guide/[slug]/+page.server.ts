import { error } from '@sveltejs/kit';
import { GUIDES, getGuide } from '$lib/guides.js';

export function load({ params }) {
  const guide = getGuide(params.slug);
  if (!guide) throw error(404, 'No such guide');

  // Simple prev/next within the guide order, for a "keep reading" footer.
  const i = GUIDES.findIndex((g) => g.slug === guide.slug);
  const near = (j: number) => (GUIDES[j] ? { slug: GUIDES[j].slug, title: GUIDES[j].title, emoji: GUIDES[j].emoji } : null);

  return {
    guide,
    prev: near(i - 1),
    next: near(i + 1),
    meta: { title: guide.seoTitle, description: guide.description },
  };
}
