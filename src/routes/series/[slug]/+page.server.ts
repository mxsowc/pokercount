import { error } from '@sveltejs/kit';
import { seriesStats } from '$lib/server/series.js';
import { fmtSigned } from '$lib/utils/money';

// SSR the crew's season standings. Anyone with the link can view (like a game
// link); it's marked noindex on the page so it isn't search-indexed.
export function load({ params }) {
  const name = decodeURIComponent(params.slug);
  const stats = seriesStats(name);
  if (!stats.gameCount) throw error(404, 'No games in this series yet');

  const top = stats.leaderboard[0];
  const desc = top
    ? `${top.name} leads ${fmtSigned(top.totalNet, stats.unit)} · ${stats.gameCount} games`
      + (stats.nextDate ? ` · next ${stats.nextDate}` : '')
    : `${stats.gameCount} games`;

  return { stats, meta: { title: `${stats.series} — season standings · potcount`, description: desc } };
}
