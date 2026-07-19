import { json } from '@sveltejs/kit';
import { getGame, mutate, uid } from '$lib/server/store.js';
import { sessionUser, withProfiles, isGameHost, httpError } from '$lib/server/helpers.js';
import { verifySeatToken } from '$lib/server/auth.js';
import { notify } from '$lib/server/notifications.js';

// Link an unclaimed seat to your account. Auto-linked ONLY when the request proves
// it comes from the device that actually played the seat (a valid seat token) or
// from the host — otherwise it becomes a claim REQUEST the host approves, so a
// stranger browsing games can't grab someone else's winning seat.
export async function POST({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  const su = sessionUser(request);
  if (!su) return json({ error: 'sign in first' }, { status: 401 });
  const { playerId } = await request.json();

  const target = g0.players.find((x: any) => x.id === playerId);
  if (!target) return json({ error: 'player not found' }, { status: 404 });
  if (target.userId === su.id) return json({ game: withProfiles(g0), claimed: true }); // already mine — no-op
  if (target.userId) return json({ error: 'That seat is already linked to someone else.' }, { status: 409 });
  if (g0.players.some((p: any) => p.userId === su.id)) {
    return json({ error: "You're already seated in this game." }, { status: 409 });
  }

  // Proof this is really your seat: the seat token issued to the device that
  // self-joined it, or being the host of the game. Either skips approval.
  const seatToken = request.headers.get('x-seat-token');
  const proven = verifySeatToken(seatToken, id, playerId) || isGameHost(g0, request);

  if (proven) {
    const game = mutate(id, (g: any) => {
      const p = g.players.find((x: any) => x.id === playerId);
      if (!p) throw httpError(404, 'player not found');
      if (p.userId) throw httpError(409, 'That seat is already linked to someone else.');
      if (g.players.some((x: any) => x.userId === su.id)) throw httpError(409, "You're already seated in this game.");
      p.userId = su.id;
    });
    return json({ game: withProfiles(game), claimed: true });
  }

  // No device proof → ask the host. One live request per user; return the existing
  // one if they tap again.
  try {
    let result: any = null;
    const game = mutate(id, (g: any) => {
      if (!Array.isArray(g.claimRequests)) g.claimRequests = [];
      const existing = g.claimRequests.find((r: any) => r.userId === su.id && r.status === 'pending');
      if (existing) { result = existing; return; }
      const p = g.players.find((x: any) => x.id === playerId);
      if (!p) throw httpError(404, 'player not found');
      if (p.userId) throw httpError(409, 'That seat is already linked to someone else.');
      if (g.players.some((x: any) => x.userId === su.id)) throw httpError(409, "You're already seated in this game.");
      const req = {
        id: uid(8), userId: su.id, playerId, name: su.displayName, handle: su.handle,
        seatName: p.name, status: 'pending', at: new Date().toISOString(), decidedAt: null,
      };
      g.claimRequests.push(req);
      result = req;
    });
    if (!game) return json({ error: 'game not found' }, { status: 404 });
    if (g0.ownerId) {
      notify(g0.ownerId, {
        type: 'claim_request', actorId: 'user:' + su.id, actorName: su.displayName, actorHandle: su.handle,
        gameId: g0.id, gameCode: g0.code, text: `wants to claim the seat “${target.name}”`,
      });
    }
    return json({ requested: true, request: result });
  } catch (e: any) {
    return json({ error: e.message || 'failed' }, { status: e.status || 400 });
  }
}

// Leave / unlink: clear the account link from a seat — but only your own. The
// seat and its buy-ins stay intact; it just becomes anonymous again.
export async function DELETE({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  const su = sessionUser(request);
  if (!su) return json({ error: 'sign in first' }, { status: 401 });

  const mine = g0.players.find((p: any) => p.userId === su.id);
  if (!mine) return json(withProfiles(g0)); // nothing linked — no-op
  const game = mutate(id, (g: any) => {
    const p = g.players.find((x: any) => x.userId === su.id);
    if (p) delete p.userId;
  });
  return json(withProfiles(game));
}
