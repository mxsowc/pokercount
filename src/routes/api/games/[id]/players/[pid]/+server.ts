import { json } from '@sveltejs/kit';
import { getGame, mutate } from '$lib/server/store.js';
import { getActor, logEntry, isGameHost, httpError } from '$lib/server/helpers.js';

export async function PATCH({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  if (g0.status !== 'active') return json({ error: 'Game is closed.' }, { status: 409 });
  const actor = getActor(request);
  const { name } = await request.json();
  const trimmed = String(name || '').trim().slice(0, 40);
  if (!trimmed) return json({ error: 'Name cannot be empty' }, { status: 400 });
  // Reject duplicate names — two players with the same name breaks settlement display.
  const target = g0.players.find((p: any) => p.id === params.pid);
  if (!target) return json({ error: 'player not found' }, { status: 404 });
  const existing = g0.players.find((p: any) => p.id !== params.pid && p.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return json({ error: 'Another player already has that name' }, { status: 409 });
  try {
    const game = mutate(id, (g: any) => {
      if (g.status !== 'active') throw httpError(409, 'Game is closed.');
      const p = g.players.find((x: any) => x.id === params.pid);
      if (!p) throw httpError(404, 'player not found');
      // Re-check duplicate atomically (a concurrent rename could have taken it).
      if (g.players.some((x: any) => x.id !== params.pid && x.name.toLowerCase() === trimmed.toLowerCase())) {
        throw httpError(409, 'Another player already has that name');
      }
      const from = p.name;
      p.name = trimmed;
      g.log.push(logEntry(actor, 'rename_player', { playerId: params.pid, playerName: p.name, detail: { from, to: p.name } }));
    });
    return json(game);
  } catch (e: any) {
    return json({ error: e.message || 'failed' }, { status: e.status || 400 });
  }
}

export async function DELETE({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  if (g0.status !== 'active') return json({ error: 'Game is closed.' }, { status: 409 });
  // Kicking is host-only: removing a player deletes their buy-ins, so don't let a
  // random joiner (or the unwanted person themselves) do it.
  if (!isGameHost(g0, request)) return json({ error: 'Only the host can remove players' }, { status: 403 });
  const actor = getActor(request);
  const pname = g0.players.find((p: any) => p.id === params.pid)?.name;
  const game = mutate(id, (g: any) => {
    g.players = g.players.filter((p: any) => p.id !== params.pid);
    g.transactions = g.transactions.filter((t: any) => t.playerId !== params.pid);
    delete g.finalStacks[params.pid];
    g.log.push(logEntry(actor, 'remove_player', { playerId: params.pid, playerName: pname }));
  });
  return json(game);
}
