import { json } from '@sveltejs/kit';
import { getGame, mutate } from '$lib/server/store.js';
import { getActor, isGameHost, logEntry, httpError, withProfiles } from '$lib/server/helpers.js';
import { notify } from '$lib/server/notifications.js';

// Host-only: approve (→ links the seat to the claimant) or reject a seat-claim.
export async function POST({ request, params }) {
  const id = params.id.toUpperCase();
  const rid = params.rid;
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  if (!isGameHost(g0, request)) return json({ error: 'Only the host can decide claims.' }, { status: 403 });

  const actor = getActor(request);
  const body = await request.json().catch(() => ({}));
  const approve = body?.action === 'approve';

  try {
    let decided: any = null;
    const game = mutate(id, (g: any) => {
      const req = (g.claimRequests || []).find((r: any) => r.id === rid);
      if (!req) throw httpError(404, 'That claim no longer exists.');
      if (req.status !== 'pending') throw httpError(409, 'That claim was already handled.');

      if (!approve) {
        req.status = 'rejected';
        req.decidedAt = new Date().toISOString();
        decided = req;
        return;
      }

      // Approve — re-check atomically: the seat must still be unclaimed and the
      // claimant not already seated elsewhere in this game.
      const seat = g.players.find((p: any) => p.id === req.playerId);
      if (!seat) throw httpError(409, 'That seat no longer exists.');
      if (seat.userId) throw httpError(409, 'That seat was already linked to someone.');
      if (g.players.some((p: any) => p.userId === req.userId)) throw httpError(409, 'They are already seated in this game.');
      seat.userId = req.userId;
      req.status = 'approved';
      req.decidedAt = new Date().toISOString();
      decided = req;
      g.log.push(logEntry(actor, 'approve_claim', { playerId: seat.id, playerName: seat.name, detail: { userId: req.userId } }));
    });
    if (!game) return json({ error: 'game not found' }, { status: 404 });

    if (decided) {
      notify(decided.userId, {
        type: approve ? 'claim_approved' : 'claim_rejected',
        actorId: actor.id, actorName: actor.name,
        gameId: g0.id, gameCode: g0.code,
        text: approve ? `linked your seat “${decided.seatName}” to your account` : `declined your claim on “${decided.seatName}”`,
      });
    }
    return json({ ok: true, action: approve ? 'approved' : 'rejected', game: withProfiles(game) });
  } catch (e: any) {
    return json({ error: e.message || 'failed' }, { status: e.status || 400 });
  }
}
