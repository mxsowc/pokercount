import { json } from '@sveltejs/kit';
import { getGame, mutate } from '$lib/server/store.js';
import { getActor, logEntry, isGameHost } from '$lib/server/helpers.js';

export async function PATCH({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  if (g0.status !== 'active') return json({ error: 'Game is closed.' }, { status: 409 });
  const actor = getActor(request);
  const { name } = await request.json();
  const game = mutate(id, (g: any) => {
    const p = g.players.find((x: any) => x.id === params.pid);
    if (p && name) {
      const from = p.name;
      p.name = String(name).trim().slice(0, 40);
      g.log.push(logEntry(actor, 'rename_player', { playerId: params.pid, playerName: p.name, detail: { from, to: p.name } }));
    }
  });
  return json(game);
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
