import { json } from '@sveltejs/kit';
import { getGame, mutate, uid } from '$lib/server/store.js';
import { getActor, logEntry, sessionUser, areConnected, withProfiles, httpError } from '$lib/server/helpers.js';
import { getUser } from '$lib/server/users.js';

export async function POST({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  if (g0.status !== 'active') return json({ error: 'Game is closed.' }, { status: 409 });
  const actor = getActor(request);
  const { name, userId } = await request.json();

  // Optional: link the new seat to a connection's account ("auto-connect"), so
  // it shows up as their game when they sign in. Guarded so a host can only
  // attach accounts of people they have a follow relationship with.
  let linkUser: any = null;
  if (userId) {
    const su = sessionUser(request);
    if (!su) return json({ error: 'sign in to link a player to an account' }, { status: 401 });
    if (!areConnected(su.id, String(userId))) {
      return json({ error: 'You can only link people you follow or who follow you.' }, { status: 403 });
    }
    linkUser = getUser(String(userId));
    if (!linkUser) return json({ error: 'account not found' }, { status: 404 });
    if (g0.players.some((p: any) => p.userId === linkUser.id)) {
      return json({ error: `${linkUser.displayName} is already in this game.` }, { status: 409 });
    }
  }

  const nm = String(name ?? linkUser?.displayName ?? '').trim();
  if (!nm) return json({ error: 'name required' }, { status: 400 });
  // Duplicate-name guard (case-insensitive), matching the join route.
  const lower = nm.toLowerCase();
  if (g0.players.some((p: any) => p.name.toLowerCase() === lower)) {
    return json({ error: `There's already a player called "${nm}" — pick a slightly different name.` }, { status: 409 });
  }

  try {
    const game = mutate(id, (g: any) => {
      if (g.status !== 'active') throw httpError(409, 'Game is closed.');
      if (g.players.length >= 100) throw httpError(409, 'This game is full (100 players max).');
      // Re-check atomically: a concurrent add/join could have taken the name or linked the account.
      if (g.players.some((p: any) => p.name.toLowerCase() === lower)) {
        throw httpError(409, `There's already a player called "${nm}" — pick a slightly different name.`);
      }
      if (linkUser && g.players.some((p: any) => p.userId === linkUser.id)) {
        throw httpError(409, `${linkUser.displayName} is already in this game.`);
      }
      const np: any = { id: uid(6), name: nm.slice(0, 40) };
      if (linkUser) np.userId = linkUser.id;
      g.players.push(np);
      g.log.push(logEntry(actor, 'add_player', { playerId: np.id, playerName: np.name }));
    });
    return json(withProfiles(game));
  } catch (e: any) {
    return json({ error: e.message || 'failed' }, { status: e.status || 400 });
  }
}
