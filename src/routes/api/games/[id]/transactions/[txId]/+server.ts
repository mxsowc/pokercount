import { json } from '@sveltejs/kit';
import { getGame, mutate } from '$lib/server/store.js';
import { getActor, logEntry, isMoney, num } from '$lib/server/helpers.js';

export async function PATCH({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  if (g0.status !== 'active') return json({ error: 'Game is closed.' }, { status: 409 });
  const actor = getActor(request);
  const { amount } = await request.json();
  if (!isMoney(amount) || num(amount) <= 0) return json({ error: 'amount must be > 0' }, { status: 400 });
  if (!g0.transactions.some((x: any) => x.id === params.txId)) return json({ error: 'transaction not found' }, { status: 404 });
  const game = mutate(id, (g: any) => {
    const t = g.transactions.find((x: any) => x.id === params.txId);
    if (t) {
      const from = t.amount;
      t.amount = num(amount);
      t.by = actor.name; // last edited by
      const pname = g.players.find((p: any) => p.id === t.playerId)?.name;
      g.log.push(logEntry(actor, 'edit_tx', { playerId: t.playerId, playerName: pname, detail: { from, to: num(amount), type: t.type } }));
    }
  });
  return json(game);
}

export async function DELETE({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  if (g0.status !== 'active') return json({ error: 'Game is closed.' }, { status: 409 });
  const actor = getActor(request);
  if (!g0.transactions.some((x: any) => x.id === params.txId)) return json({ error: 'transaction not found' }, { status: 404 });
  const game = mutate(id, (g: any) => {
    const t = g.transactions.find((x: any) => x.id === params.txId);
    g.transactions = g.transactions.filter((x: any) => x.id !== params.txId);
    if (t) {
      const pname = g.players.find((p: any) => p.id === t.playerId)?.name;
      g.log.push(logEntry(actor, 'remove_tx', { playerId: t.playerId, playerName: pname, detail: { amount: t.amount, type: t.type } }));
    }
  });
  return json(game);
}
