import { json } from '@sveltejs/kit';
import { getGame, mutate } from '$lib/server/store.js';
import { getActor, logEntry } from '$lib/server/helpers.js';

export async function PUT({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  const actor = getActor(request);
  const { paid } = await request.json();
  if (!g0.settlement) return json({ error: 'The game has to be ended first' }, { status: 409 });
  // Don't silently 200 on a transfer that no longer exists (e.g. the plan was
  // re-routed and ids changed) — the client would think it succeeded.
  if (!g0.settlement.transfers.some((x: any) => x.id === params.tid)) {
    return json({ error: 'no such payment' }, { status: 404 });
  }
  const game = mutate(id, (g: any) => {
    const t = g.settlement.transfers.find((x: any) => x.id === params.tid);
    t.paid = !!paid;
    t.paidAt = paid ? new Date().toISOString() : null;
    t.paidBy = paid ? actor.name : null;
    const allPaid = g.settlement.transfers.every((x: any) => x.paid);
    g.status = (g.settlement.balanced && allPaid) ? 'settled' : 'ended';
    g.log.push(logEntry(actor, paid ? 'mark_paid' : 'mark_unpaid', {
      detail: { from: t.fromName, to: t.toName, amount: t.amount },
    }));
  });
  return json(game);
}
