import { json } from '@sveltejs/kit';
import { getGame, mutate, uid } from '$lib/server/store.js';
import { sessionUser, getActor, logEntry, httpError, withProfiles } from '$lib/server/helpers.js';
import { signSeatToken } from '$lib/server/auth.js';

export async function POST({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  // Joining is how you both sit down at a live table AND RSVP to a scheduled one
  // (a lobby seat = "I'm in"). Only a closed game refuses joiners.
  if (g0.status !== 'active' && g0.status !== 'scheduled') return json({ error: 'Game is closed.' }, { status: 409 });

  const su = sessionUser(request);
  const actor = su ? { id: 'user:' + su.id, name: su.displayName } : getActor(request);
  const { name } = await request.json();
  const nm = String(name || '').trim().slice(0, 40);
  if (!nm) return json({ error: 'name required' }, { status: 400 });

  // Check for duplicate names (case-insensitive)
  const lower = nm.toLowerCase();
  if (g0.players.some((p: any) => p.name.toLowerCase() === lower)) {
    return json({ error: `There's already a player called "${nm}" — pick a slightly different name.` }, { status: 409 });
  }

  let newId: string | null = null;
  try {
    const game = mutate(id, (g: any) => {
      if (g.status !== 'active' && g.status !== 'scheduled') throw httpError(409, 'Game is closed.');
      if (su) {
        const existing = g.players.find((p: any) => p.userId === su.id);
        if (existing) { newId = existing.id; return; } // already seated — rejoin is always allowed
      }
      // Locked table: only the host adds players (via the add-player route). A new
      // self-join by code is refused — checked here so a rejoin above still works.
      if (g.locked) throw httpError(403, 'The host locked this game — ask them to add you.');
      if (g.players.length >= 100) throw httpError(409, 'This game is full.');
      // Public/city-listed games are approval-only: nobody self-seats by code
      // (the directory page exposes the game id, so a plain self-join would let
      // anyone bypass the host). Strangers use the join-request flow and the host
      // approves. An already-seated player's rejoin is handled above, before here.
      if (g.visibility === 'public') {
        throw httpError(403, 'This game is invite-only — request a seat from its city page.');
      }
      // Re-check the name atomically so two simultaneous joins can't both land the same name.
      if (g.players.some((p: any) => p.name.toLowerCase() === lower)) {
        throw httpError(409, `There's already a player called "${nm}" — pick a slightly different name.`);
      }
      const np: any = { id: uid(6), name: nm };
      if (su) np.userId = su.id;
      g.players.push(np);
      newId = np.id;
      g.log.push(logEntry(actor, 'add_player', { playerId: np.id, playerName: np.name }));
    });
    // Hand this device a proof it holds this seat, so it can later claim the seat
    // onto an account without needing the host to approve (same device = it's theirs).
    const seatToken = newId ? signSeatToken(id, newId) : null;
    return json({ game: withProfiles(game), playerId: newId, seatToken });
  } catch (e: any) {
    return json({ error: e.message || 'failed' }, { status: e.status || 400 });
  }
}
