import { json } from '@sveltejs/kit';
import { getGame, mutate, uid } from '$lib/server/store.js';
import { sessionUser, getActor, logEntry } from '$lib/server/helpers.js';
import { verifyGameToken } from '$lib/server/auth.js';
import { computeSettlement } from '$lib/engine/settle.js';

export async function POST({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  if (g0.status !== 'active') return json({ error: 'Game is already closed.' }, { status: 409 });

  const su = sessionUser(request);
  const actor = su ? { id: 'user:' + su.id, name: su.displayName } : getActor(request);
  const hostToken = request.headers.get('x-host-token');
  const isHost = !g0.hostId
    || (su && g0.ownerId && g0.ownerId === su.id)
    || (hostToken && verifyGameToken(hostToken, g0.id))
    || (!g0.tokenedHost && g0.hostId === actor.id);

  const s = computeSettlement(g0.players, g0.transactions, g0.finalStacks);

  if (!isHost) {
    const playerId = request.headers.get('x-player-id');
    const isSeated = (su && g0.players.some((p: any) => p.userId === su.id))
      || (playerId && g0.players.some((p: any) => p.id === playerId));
    if (!isSeated) return json({ error: 'Only players in this game can close it' }, { status: 403 });
    if (!s.balanced) return json({ error: "The cash-outs don't add up yet — only the host can close an unbalanced game" }, { status: 409 });
  }

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
  return json(game);
}
