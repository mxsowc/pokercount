import { json } from '@sveltejs/kit';
import { getGame, mutate } from '$lib/server/store.js';
import { getActor, logEntry, isSafeId, isMoney, num } from '$lib/server/helpers.js';

export async function PUT({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  if (g0.status !== 'active') return json({ error: 'Game is closed.' }, { status: 409 });
  const actor = getActor(request);
  const { playerId, amount } = await request.json();
  // Validate the id (no prototype-pollution keys, must be a real seat) and the
  // amount (reject negative / non-finite / sub-cent). Empty/null clears it.
  if (!isSafeId(playerId) || !g0.players.some((p: any) => p.id === playerId)) {
    return json({ error: 'unknown player' }, { status: 400 });
  }
  const clearing = amount === null || amount === '' || amount === undefined;
  if (!clearing && !isMoney(amount)) {
    return json({ error: 'amount must be a number ≥ 0' }, { status: 400 });
  }
  const game = mutate(id, (g: any) => {
    const from = g.finalStacks[playerId] ?? null;
    let to;
    if (clearing) {
      delete g.finalStacks[playerId];
      to = null;
    } else {
      g.finalStacks[playerId] = num(amount);
      to = num(amount);
    }
    const pname = g.players.find((p: any) => p.id === playerId)?.name;
    if (from !== to) g.log.push(logEntry(actor, 'set_final', { playerId, playerName: pname, detail: { from, to } }));
  });
  return json(game);
}
