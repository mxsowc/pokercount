import { json } from '@sveltejs/kit';
import { getGame, mutate, uid } from '$lib/server/store.js';
import { sessionUser, isGameHost, mutualCoPlayers, httpError } from '$lib/server/helpers.js';
import { notify } from '$lib/server/notifications.js';

// A signed-in user asks to join a PUBLIC game. Unlike code-join, this never seats
// them directly — it queues a request the host approves or rejects.
export async function POST({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  if (g0.visibility !== 'public') return json({ error: "This game isn't open to requests." }, { status: 403 });
  if (g0.status !== 'active' && g0.status !== 'scheduled') return json({ error: 'Game is closed.' }, { status: 409 });

  // Requesting requires an account (it's the anti-abuse gate for a public surface,
  // and the host needs a real profile + a way to be notified back).
  const su = sessionUser(request);
  if (!su) return json({ error: 'Sign in to request to join.' }, { status: 401 });
  // Real-money poker matchmaking is 18+ — a self-declared minor can't request a seat.
  if ((su.ageRange || '').trim().toLowerCase() === 'under 18') {
    return json({ error: 'Open games are 18+.' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const message = body?.message ? String(body.message).trim().slice(0, 200) : '';

  try {
    let result: any = null;
    const game = mutate(id, (g: any) => {
      // Re-check joinability atomically inside the mutation.
      if (g.visibility !== 'public') throw httpError(403, "This game isn't open to requests.");
      if (g.players.some((p: any) => p.userId === su.id)) throw httpError(409, "You're already in this game.");
      if (!Array.isArray(g.joinRequests)) g.joinRequests = [];
      // Idempotent: one live request per user. A prior pending one is returned as-is.
      const existing = g.joinRequests.find((r: any) => r.userId === su.id && r.status === 'pending');
      if (existing) { result = { request: existing, already: true }; return; }
      const req = {
        id: uid(8), userId: su.id, name: su.displayName, handle: su.handle,
        message, status: 'pending', at: new Date().toISOString(), decidedAt: null,
      };
      g.joinRequests.push(req);
      result = { request: req, already: false };
    });
    if (!game) return json({ error: 'game not found' }, { status: 404 });
    // Ping the host (if the game has an account owner) so they can act on it.
    if (!result?.already && g0.ownerId) {
      notify(g0.ownerId, {
        type: 'join_request', actorId: 'user:' + su.id, actorName: su.displayName, actorHandle: su.handle,
        gameId: g0.id, gameCode: g0.code, text: `wants to join “${g0.name}”`,
      });
    }
    return json({ ok: true, ...result });
  } catch (e: any) {
    return json({ error: e.message || 'failed' }, { status: e.status || 400 });
  }
}

// Host-only: the request queue for this game (the queue is stripped from the
// player-facing game payload, so the host fetches it here).
export function GET({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  if (!isGameHost(g0, request)) return json({ error: 'Only the host can see join requests.' }, { status: 403 });
  // Enrich each pending request with mutual-poker-acquaintance social proof for
  // the (signed-in) host: people the requester has played with that the host has
  // too — only shown when the host & requester have never played together.
  const hostId = sessionUser(request)?.id;
  const requests = (g0.joinRequests || [])
    .filter((r: any) => r.status === 'pending')
    .map((r: any) => ({ ...r, mutual: hostId ? mutualCoPlayers(hostId, r.userId) : null }));
  return json({ requests });
}
