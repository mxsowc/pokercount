import { json } from '@sveltejs/kit';
import { getGame, mutate } from '$lib/server/store.js';
import { sessionUser, httpError } from '$lib/server/helpers.js';

// "Hardest to read" post-game vote. Signed-in users only.
// Each signed-in user can vote once per game. The vote is stored on the game
// object as `votes: { hardestToRead: { oderId: votedPlayerId } }`.

export async function POST({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });

  // Must be signed in
  const su = sessionUser(request);
  if (!su) return json({ error: 'Sign in to vote' }, { status: 401 });

  // Game must be ended/settled
  if (g0.status === 'active') return json({ error: 'Game is still active' }, { status: 409 });

  const { playerId } = await request.json();

  // Voter must be seated in this game (linked account)
  const voterSeat = g0.players.find((p: any) => p.userId === su.id);
  if (!voterSeat) return json({ error: 'You must be seated in this game to vote' }, { status: 403 });

  // Target must be a different player in the game with a linked account
  const target = g0.players.find((p: any) => p.id === playerId);
  if (!target) return json({ error: 'Player not found' }, { status: 404 });
  if (target.id === voterSeat.id) return json({ error: "You can't vote for yourself" }, { status: 400 });
  if (!target.userId) return json({ error: 'That player doesn\'t have an account yet' }, { status: 400 });

  try {
    const game = mutate(id, (g: any) => {
      if (!g.votes) g.votes = {};
      if (!g.votes.hardestToRead) g.votes.hardestToRead = {};
      g.votes.hardestToRead[su.id] = playerId;
    });
    return json({ ok: true, votes: game?.votes?.hardestToRead || {} });
  } catch (e: any) {
    return json({ error: e.message || 'failed' }, { status: e.status || 400 });
  }
}

// GET: return current votes for this game
export async function GET({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  return json({ votes: g0.votes?.hardestToRead || {} });
}
