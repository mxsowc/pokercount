import { json } from '@sveltejs/kit';
import { getGame, mutate, uid } from '$lib/server/store.js';
import { sessionUser, getActor, logEntry, withProfiles } from '$lib/server/helpers.js';
import { computeSettlement } from '$lib/engine/settle.js';

export async function POST({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  if (g0.status !== 'active') return json({ error: 'Game is already closed.' }, { status: 409 });

  const su = sessionUser(request);
  const actor = su ? { id: 'user:' + su.id, name: su.displayName } : getActor(request);

  // Anyone with the game can lock in the summary — "host" is just who started it,
  // not a gatekeeper. The books don't have to balance; the summary flags any gap.
  const s = computeSettlement(g0.players, g0.transactions, g0.finalStacks);

  const game = mutate(id, (g: any) => {
    g.settlement = {
      computedAt: new Date().toISOString(),
      lines: s.lines,
      transfers: s.transfers.map((t: any) => ({ id: uid(8), ...t, paid: false, paidAt: null, paidBy: null })),
      totalInvested: s.totalInvested, totalFinal: s.totalFinal,
      discrepancy: s.discrepancy, balanced: s.balanced,
    };
    g.status = (s.balanced && s.transfers.length === 0) ? 'settled' : 'ended';
    g.log.push(logEntry(actor, 'close_game', {}));
  });
  return json(withProfiles(game));
}
