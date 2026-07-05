import { json } from '@sveltejs/kit';
import { seriesStats } from '$lib/server/series.js';
import { sessionUser } from '$lib/server/helpers.js';
import { setSeriesNextDate } from '$lib/server/seriesmeta.js';

// GET /api/series?name=Thursday+PLO — cumulative, account-keyed series stats.
export function GET({ url }) {
  const name = url.searchParams.get('name')?.trim();
  if (!name) return json({ error: 'name parameter required' }, { status: 400 });
  return json(seriesStats(name));
}

// PUT /api/series  { name, nextDate } — any signed-in member sets the next session.
export async function PUT({ request }) {
  const su = sessionUser(request);
  if (!su) return json({ error: 'sign in to set the next session' }, { status: 401 });
  const { name, nextDate } = await request.json().catch(() => ({}));
  const series = String(name || '').trim();
  if (!series) return json({ error: 'series name required' }, { status: 400 });
  const meta = setSeriesNextDate(series, nextDate);
  return json({ series, nextDate: meta.nextDate });
}
