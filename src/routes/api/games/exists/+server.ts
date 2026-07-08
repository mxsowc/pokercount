import { json } from '@sveltejs/kit';
import { getGame } from '$lib/server/store.js';

// Given the game ids a device has cached in localStorage (pc_games), return which
// still exist on the server. The homepage uses this to prune "ghost" entries for
// games the cleanup reaper has since deleted (e.g. an abandoned single-player
// table older than 24h) so they stop showing a dead "Continue" button.
export async function POST({ request }) {
  let body: any;
  try { body = await request.json(); } catch { return json({ existing: [] }); }
  const ids = Array.isArray(body?.ids) ? body.ids : [];
  const existing = ids
    .filter((id: unknown): id is string => typeof id === 'string')
    .slice(0, 50) // cap: the client only ever caches ~20
    .filter((id: string) => !!getGame(id));
  return json({ existing });
}
