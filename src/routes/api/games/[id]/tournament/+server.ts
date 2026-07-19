import { json } from '@sveltejs/kit';
import { getGame, mutate, settleAndClose } from '$lib/server/store.js';
import { getActor, logEntry, httpError, withProfiles } from '$lib/server/helpers.js';
import { payoutCents } from '$lib/payouts.js';

// Enter a tournament result: the finishing order (top places) + the payout split.
// The server splits the prize pool (= total buy-ins) across the places, writes the
// payout into each seat's finalStacks, then settles with the SAME zero-sum engine a
// cash game uses — so who-pays-who is computed identically and always balances.
export async function PUT({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  if (g0.mode !== 'tournament') return json({ error: 'This game is not a tournament.' }, { status: 400 });
  if (g0.status !== 'active') return json({ error: 'Game is closed.' }, { status: 409 });

  const actor = getActor(request);
  const body = await request.json().catch(() => ({}));
  const places: string[] = Array.isArray(body.places) ? body.places.map(String) : [];
  const payouts: number[] = Array.isArray(body.payouts) ? body.payouts.map((p: any) => Math.max(0, Number(p) || 0)) : [];

  if (!places.length || !payouts.length) return json({ error: 'Set the finishing order and the payout split.' }, { status: 400 });
  // One place per paid position, so the whole pool is distributed (zero-sum).
  if (places.length !== payouts.length) return json({ error: 'Rank exactly one player per paid place.' }, { status: 400 });

  try {
    const game = mutate(id, (g: any) => {
      if (g.status !== 'active') throw httpError(409, 'Game is closed.');
      const ids = new Set(g.players.map((p: any) => p.id));
      const seen = new Set<string>();
      for (const pid of places) {
        if (!ids.has(pid)) throw httpError(400, 'Unknown player in the finishing order.');
        if (seen.has(pid)) throw httpError(400, 'A player can only finish in one place.');
        seen.add(pid);
      }
      // Prize pool = every buy-in and top-up put on the table, in integer cents.
      const poolCents = (g.transactions || []).reduce((s: number, t: any) => s + Math.round((t.amount || 0) * 100), 0);
      const cents = payoutCents(poolCents, payouts);
      // Everyone out of the money cashes 0; the paid places get their cut. Sum of
      // finalStacks == pool, so the settlement balances exactly.
      g.finalStacks = {};
      for (const p of g.players) g.finalStacks[p.id] = 0;
      places.forEach((pid, i) => { g.finalStacks[pid] = (cents[i] || 0) / 100; });
      g.tournament = { payouts, places };
      g.log.push(logEntry(actor, 'tournament_result', { detail: { paidPlaces: places.length } }));
      settleAndClose(g, { actorId: actor.id, actorName: actor.name, action: 'tournament_close' });
    });
    if (!game) return json({ error: 'game not found' }, { status: 404 });
    return json(withProfiles(game));
  } catch (e: any) {
    return json({ error: e.message || 'failed' }, { status: e.status || 400 });
  }
}
