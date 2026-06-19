import { json } from '@sveltejs/kit';
import { getGame, mutate, uid } from '$lib/server/store.js';
import { getActor, logEntry, isMoney, num, isSafeId } from '$lib/server/helpers.js';

export async function POST({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  if (g0.status !== 'active') return json({ error: 'Game is closed.' }, { status: 409 });
  const actor = getActor(request);
  const body = await request.json();
  // Accept a single transaction OR a batch (`entries`) so bulk actions like
  // "buy everyone in" are one atomic request instead of N round-trips.
  const entries = Array.isArray(body.entries) ? body.entries : [{ playerId: body.playerId, amount: body.amount, type: body.type }];
  if (!entries.length) return json({ error: 'nothing to add' }, { status: 400 });
  if (entries.length > 200) return json({ error: 'too many entries' }, { status: 400 });
  for (const e of entries) {
    if (!e || typeof e !== 'object') return json({ error: 'invalid entry' }, { status: 400 });
    if (!isMoney(e.amount) || num(e.amount) <= 0) return json({ error: 'amount must be > 0' }, { status: 400 });
    if (!isSafeId(e.playerId) || !g0.players.some((p: any) => p.id === e.playerId)) return json({ error: 'unknown player' }, { status: 400 });
  }
  const game = mutate(id, (g: any) => {
    for (const e of entries) {
      const amt = num(e.amount);
      const txType = e.type === 'topup' ? 'topup' : 'buyin';
      g.transactions.push({ id: uid(8), playerId: e.playerId, amount: amt, type: txType, at: new Date().toISOString() });
      const pname = g.players.find((p: any) => p.id === e.playerId)?.name;
      g.log.push(logEntry(actor, txType, { playerId: e.playerId, playerName: pname, detail: { amount: amt, type: txType } }));
    }
  });
  return json(game);
}
