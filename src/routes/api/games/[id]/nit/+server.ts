import { json } from '@sveltejs/kit';
import { getGame, mutate } from '$lib/server/store.js';
import { getActor, logEntry, withProfiles } from '$lib/server/helpers.js';

// The "nit game" side game. POST with either:
//   { on: boolean }        → turn the side game on/off (starts a fresh round)
//   { playerId: string }   → toggle that seat as having won a pot (clears/un-clears
//                            their nit button)
// Open to any actor in the game (like rename / currency) — it's a fun side game,
// not a destructive host action. No money is involved.
export async function POST({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  if (g0.status !== 'active') return json({ error: 'Game is closed.' }, { status: 409 });

  const body = await request.json().catch(() => ({}));
  const actor = getActor(request);

  const game = mutate(id, (g: any) => {
    if (!g.nitGame) g.nitGame = { on: false, cleared: [] };

    if (typeof body.on === 'boolean') {
      g.nitGame.on = body.on;
      g.nitGame.cleared = []; // (re)start the round fresh whenever toggled
      g.log.push(logEntry(actor, body.on ? 'nit_on' : 'nit_off', {}));
      return;
    }

    if (typeof body.playerId === 'string') {
      if (!g.nitGame.on) return; // only while the side game is running
      const p = g.players.find((x: any) => x.id === body.playerId);
      if (!p) return; // ignore unknown seat
      const set = new Set(g.nitGame.cleared || []);
      const won = !set.has(p.id);
      if (won) set.add(p.id); else set.delete(p.id);
      g.nitGame.cleared = [...set];
      g.log.push(logEntry(actor, won ? 'nit_won' : 'nit_undo', { detail: { name: p.name } }));
    }
  });

  return json(withProfiles(game));
}
