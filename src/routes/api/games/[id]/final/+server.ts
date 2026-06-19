import { json } from '@sveltejs/kit';
import { getGame, mutate } from '$lib/server/store.js';
import { getActor, logEntry, isSafeId, isMoney, num } from '$lib/server/helpers.js';

export async function PUT({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  if (g0.status !== 'active') return json({ error: 'Game is closed.' }, { status: 409 });
  const actor = getActor(request);
  const body = await request.json();
  // Accept a single update OR a batch (`updates`) so "mark everyone left as out"
  // is one atomic request. Empty/null amount clears a stack.
  const updates = Array.isArray(body.updates) ? body.updates : [{ playerId: body.playerId, amount: body.amount }];
  if (!updates.length) return json({ error: 'nothing to update' }, { status: 400 });
  if (updates.length > 200) return json({ error: 'too many updates' }, { status: 400 });
  for (const u of updates) {
    if (!u || typeof u !== 'object') return json({ error: 'invalid update' }, { status: 400 });
    if (!isSafeId(u.playerId) || !g0.players.some((p: any) => p.id === u.playerId)) {
      return json({ error: 'unknown player' }, { status: 400 });
    }
    const clearing = u.amount === null || u.amount === '' || u.amount === undefined;
    if (!clearing && !isMoney(u.amount)) {
      return json({ error: 'amount must be a number ≥ 0' }, { status: 400 });
    }
  }
  const game = mutate(id, (g: any) => {
    for (const u of updates) {
      const clearing = u.amount === null || u.amount === '' || u.amount === undefined;
      const from = g.finalStacks[u.playerId] ?? null;
      let to;
      if (clearing) { delete g.finalStacks[u.playerId]; to = null; }
      else { g.finalStacks[u.playerId] = num(u.amount); to = num(u.amount); }
      const pname = g.players.find((p: any) => p.id === u.playerId)?.name;
      if (from !== to) g.log.push(logEntry(actor, 'set_final', { playerId: u.playerId, playerName: pname, detail: { from, to } }));
    }
  });
  return json(game);
}
