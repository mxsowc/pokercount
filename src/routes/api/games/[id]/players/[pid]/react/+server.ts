import { json } from '@sveltejs/kit';
import { sessionUser } from '$lib/server/helpers.js';
import { getGame } from '$lib/server/store.js';
import { toggleReaction, reactionSummary } from '$lib/server/reactions.js';
import { rateLimit } from '$lib/server/ratelimit.js';
import { getFollowing } from '$lib/server/social.js';

const ALLOWED = new Set(['👏', '🖕']);

export async function POST({ request, params }) {
  const su = sessionUser(request);
  if (!su) return json({ error: 'sign in to react' }, { status: 401 });
  if (!rateLimit('react:' + su.id, 40, 60_000)) return json({ error: 'Too many reactions — slow down a moment.' }, { status: 429 });
  const id = params.id.toUpperCase();
  const g = getGame(id);
  if (!g) return json({ error: 'game not found' }, { status: 404 });
  const seat = g.players.find((p: any) => p.id === params.pid);
  if (!seat) return json({ error: 'unknown player' }, { status: 400 });
  // Match the feed's read scope: you can only react to yourself or players you follow.
  if (!seat.userId || (seat.userId !== su.id && !getFollowing(su.id).has(seat.userId)))
    return json({ error: 'You can only react to players you follow' }, { status: 403 });
  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, { status: 400 }); }
  if (!ALLOWED.has(body?.emoji)) return json({ error: 'bad reaction' }, { status: 400 });
  toggleReaction(id, params.pid, su.id, body.emoji);
  return json(reactionSummary(id, params.pid, su.id));
}
