import { json } from '@sveltejs/kit';
import { getGame, mutate, uid } from '$lib/server/store.js';
import { getActor, isGameHost, logEntry, httpError } from '$lib/server/helpers.js';
import { notify } from '$lib/server/notifications.js';

// Host-only: approve (→ seats the requester) or reject a pending join request.
export async function POST({ request, params }) {
  const id = params.id.toUpperCase();
  const rid = params.rid;
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  if (!isGameHost(g0, request)) return json({ error: 'Only the host can decide requests.' }, { status: 403 });
  if (g0.status !== 'active' && g0.status !== 'scheduled') return json({ error: 'Game is closed.' }, { status: 409 });

  const actor = getActor(request);
  const body = await request.json().catch(() => ({}));
  const approve = body?.action === 'approve';

  try {
    /** @type {any} */ let decided: any = null;
    const game = mutate(id, (g: any) => {
      const reqs = g.joinRequests || [];
      const req = reqs.find((r: any) => r.id === rid);
      if (!req) throw httpError(404, 'That request no longer exists.');
      if (req.status !== 'pending') throw httpError(409, 'That request was already handled.');

      if (!approve) {
        req.status = 'rejected';
        req.decidedAt = new Date().toISOString();
        decided = req;
        g.log.push(logEntry(actor, 'reject_join', { detail: { userId: req.userId } }));
        return;
      }

      // Approve. If they already got seated some other way, just close the request.
      if (g.players.some((p: any) => p.userId === req.userId)) {
        req.status = 'approved';
        req.decidedAt = new Date().toISOString();
        decided = req;
        return;
      }
      // Enforce the table cap here — atomically, so two approvals can't both slip
      // past a full table (the same TOCTOU discipline as the join route).
      const cap = Number(g.maxPlayers) || 0;
      if (cap > 0 && g.players.length >= cap) {
        throw httpError(409, `Table is full (${cap} players). Remove someone or raise the cap first.`);
      }
      // Seat them under a non-colliding name (their display name, else @handle, else + suffix).
      const taken = new Set(g.players.map((p: any) => String(p.name).toLowerCase()));
      let name = String(req.name || req.handle || 'Player').slice(0, 40);
      if (taken.has(name.toLowerCase()) && req.handle) name = `@${req.handle}`.slice(0, 40);
      while (taken.has(name.toLowerCase())) name = `${String(req.name).slice(0, 36)} ${uid(2)}`;

      g.players.push({ id: uid(6), name, userId: req.userId });
      req.status = 'approved';
      req.decidedAt = new Date().toISOString();
      decided = req;
      g.log.push(logEntry(actor, 'approve_join', { playerName: name, detail: { userId: req.userId } }));
    });
    if (!game) return json({ error: 'game not found' }, { status: 404 });

    // Tell the requester either way, with a link back to the game.
    if (decided) {
      notify(decided.userId, {
        type: approve ? 'join_approved' : 'join_rejected',
        actorId: actor.id, actorName: actor.name,
        gameId: g0.id, gameCode: g0.code,
        text: approve ? `approved your request to join “${g0.name}”` : `declined your request to join “${g0.name}”`,
      });
    }
    return json({ ok: true, action: approve ? 'approved' : 'rejected' });
  } catch (e: any) {
    return json({ error: e.message || 'failed' }, { status: e.status || 400 });
  }
}
