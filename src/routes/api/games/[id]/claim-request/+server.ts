import { json } from '@sveltejs/kit';
import { getGame } from '$lib/server/store.js';
import { isGameHost } from '$lib/server/helpers.js';

// Host-only: the pending seat-claim queue. Claims are stripped from the served
// game body (they carry other accounts' ids), so the host fetches them here.
export function GET({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  if (!isGameHost(g0, request)) return json({ error: 'Only the host can see claim requests.' }, { status: 403 });
  const requests = (g0.claimRequests || []).filter((r: any) => r.status === 'pending');
  return json({ requests });
}
