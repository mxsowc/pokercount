import { json } from '@sveltejs/kit';
import { getGame, mutate, uid } from '$lib/server/store.js';
import { getActor, logEntry, isMoney, num } from '$lib/server/helpers.js';

export async function POST({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  if (g0.status !== 'active') return json({ error: 'Game is closed.' }, { status: 409 });
  const actor = getActor(request);
  const { playerId, amount, type } = await request.json();
  if (!isMoney(amount) || num(amount) <= 0) return json({ error: 'amount must be > 0' }, { status: 400 });
  const amt = num(amount);
  const txType = type === 'topup' ? 'topup' : 'buyin';
  const game = mutate(id, (g: any) => {
    if (!g.players.some((p: any) => p.id === playerId)) throw new Error('unknown player');
    g.transactions.push({ id: uid(8), playerId, amount: amt, type: txType, at: new Date().toISOString() });
    const pname = g.players.find((p: any) => p.id === playerId)?.name;
    g.log.push(logEntry(actor, txType, { playerId, playerName: pname, detail: { amount: amt, type: txType } }));
  });
  return json(game);
}
