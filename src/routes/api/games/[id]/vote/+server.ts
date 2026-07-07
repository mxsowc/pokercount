import { json } from '@sveltejs/kit';
import { getGame, mutate } from '$lib/server/store.js';
import { sessionUser } from '$lib/server/helpers.js';
import { AWARD_KEYS, AWARDS } from '$lib/awards';
import { notify } from '$lib/server/notifications.js';

function tallyCategory(map: Record<string, string>): Record<string, number> {
  const t: Record<string, number> = {};
  for (const pid of Object.values(map)) t[pid] = (t[pid] || 0) + 1;
  return t;
}

export async function POST({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });

  const su = sessionUser(request);
  if (!su) return json({ error: 'Sign in to vote' }, { status: 401 });
  if (g0.status === 'active') return json({ error: 'Game is still active' }, { status: 409 });

  const body = await request.json();
  const playerId = body?.playerId;
  const category = body?.category || 'hardestToRead';
  if (!AWARD_KEYS.has(category)) return json({ error: 'Unknown award' }, { status: 400 });

  const voterSeat = g0.players.find((p: any) => p.userId === su.id);
  if (!voterSeat) return json({ error: 'You must be seated in this game to vote' }, { status: 403 });

  const target = g0.players.find((p: any) => p.id === playerId);
  if (!target) return json({ error: 'Player not found' }, { status: 404 });
  if (target.id === voterSeat.id) return json({ error: "You can't vote for yourself" }, { status: 400 });
  if (!target.userId) return json({ error: 'That player doesn\'t have an account yet' }, { status: 400 });

  const alreadyVotedThem = g0.votes?.[category]?.[su.id] === playerId;
  try {
    const game = mutate(id, (g: any) => {
      if (!g.votes) g.votes = {};
      if (!g.votes[category]) g.votes[category] = {};
      g.votes[category][su.id] = playerId;
    });
    if (!alreadyVotedThem) {
      const award = AWARDS.find((a) => a.key === category);
      notify(target.userId, { type: 'award', actorId: 'user:' + su.id, actorName: su.displayName, actorHandle: su.handle, gameId: g0.id, gameCode: g0.code ?? g0.id, text: `voted you ${award ? `${award.emoji} ${award.label}` : 'an award'}` });
    }
    const catVotes = game?.votes?.[category] || {};
    return json({ ok: true, category, tally: tallyCategory(catVotes), myVote: playerId });
  } catch (e: any) {
    return json({ error: e.message || 'failed' }, { status: e.status || 400 });
  }
}

export async function GET({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });

  const su = sessionUser(request);
  const votes = g0.votes || {};
  const tallies: Record<string, Record<string, number>> = {};
  const myVotes: Record<string, string> = {};
  for (const [cat, map] of Object.entries(votes) as [string, Record<string, string>][]) {
    tallies[cat] = tallyCategory(map);
    if (su && map[su.id]) myVotes[cat] = map[su.id];
  }
  return json({ tallies, myVotes });
}
