import { json } from '@sveltejs/kit';
import { sessionUser } from '$lib/server/helpers.js';
import { getGame } from '$lib/server/store.js';
import { addComment } from '$lib/server/comments.js';
import { publicUser } from '$lib/server/users.js';
import { rateLimit } from '$lib/server/ratelimit.js';
import { getFollowing } from '$lib/server/social.js';

export async function POST({ request, params }) {
  const su = sessionUser(request);
  if (!su) return json({ error: 'sign in to comment' }, { status: 401 });
  if (!rateLimit('comment:' + su.id, 15, 60_000)) return json({ error: 'Too many comments — slow down a moment.' }, { status: 429 });
  const id = params.id.toUpperCase();
  const g = getGame(id);
  if (!g) return json({ error: 'game not found' }, { status: 404 });
  const seat = g.players.find((p: any) => p.id === params.pid);
  if (!seat) return json({ error: 'unknown player' }, { status: 400 });
  // Match the feed's read scope: you can only interact with yourself or players you follow.
  if (!seat.userId || (seat.userId !== su.id && !getFollowing(su.id).has(seat.userId)))
    return json({ error: 'You can only comment on players you follow' }, { status: 403 });
  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, { status: 400 }); }
  if (typeof body?.text !== 'string') return json({ error: 'comment must be text' }, { status: 400 });
  const c = addComment(id, params.pid, su.id, body.text);
  if (!c) return json({ error: 'comment cannot be empty' }, { status: 400 });
  return json({ ...c, user: publicUser(su) });
}
