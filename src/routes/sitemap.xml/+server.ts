import { cityHubs } from '$lib/server/directory.js';

// Dynamic sitemap: the static pages plus every city hub with enough real content
// to be worth indexing (enough public players, or an open game — see cityHubs).
// Replaces the old static static/sitemap.xml so new cities appear the moment
// they fill in.
const BASE = 'https://potcount.com';

const STATIC: { loc: string; changefreq: string; priority: string }[] = [
  { loc: '/', changefreq: 'weekly', priority: '1.0' },
  { loc: '/pot', changefreq: 'monthly', priority: '0.8' },
  { loc: '/poker-chip-tracker', changefreq: 'monthly', priority: '0.9' },
  { loc: '/homegames', changefreq: 'daily', priority: '0.9' },
];

export function GET() {
  const cities = cityHubs().filter((c) => c.indexable);
  const urls = [
    ...STATIC,
    ...cities.map((c) => ({ loc: `/homegames/${c.slug}`, changefreq: 'daily', priority: '0.7' })),
  ];
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls
      .map(
        (u) =>
          `  <url><loc>${BASE}${u.loc}</loc><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`
      )
      .join('\n') +
    '\n</urlset>\n';

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
