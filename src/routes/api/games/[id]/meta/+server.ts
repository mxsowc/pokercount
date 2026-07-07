import { json } from '@sveltejs/kit';
import { getGame, mutate } from '$lib/server/store.js';
import { getActor, isGameHost, logEntry, withProfiles } from '$lib/server/helpers.js';

export async function PUT({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  if (g0.status !== 'active') return json({ error: 'Game is closed.' }, { status: 409 });
  const host = isGameHost(g0, request);
  const actor = getActor(request);
  const { name, unit, series } = await request.json();
  const game = mutate(id, (g: any) => {
    const detail: any = {};
    if (name) { g.name = String(name).slice(0, 80); detail.name = g.name; }
    // The unit relabels already-recorded money and is bucketed by cross-game
    // leaderboards/series totals, so changing it is host-only (other meta edits
    // are intentionally community-editable). Also write an audit-log entry.
    if (unit && host) { g.unit = String(unit).slice(0, 16); detail.unit = g.unit; }
    if (series !== undefined) { g.series = series ? String(series).trim().slice(0, 60) : null; detail.series = g.series; }
    if (Object.keys(detail).length) g.log.push(logEntry(actor, 'edit_meta', { detail }));
  });
  return json(withProfiles(game));
}
