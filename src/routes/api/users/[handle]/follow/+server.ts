import { json } from '@sveltejs/kit';
import { sessionUser } from '$lib/server/helpers.js';
import { getByHandle } from '$lib/server/users.js';
import * as social from '$lib/server/social.js';
import { notify } from '$lib/server/notifications.js';

export async function POST({ request, params }) {
  const su = sessionUser(request);
  if (!su) return json({ error: 'sign in first' }, { status: 401 });
  const target = getByHandle(params.handle);
  if (!target) return json({ error: 'no such player' }, { status: 404 });
  if (target.id === su.id) return json({ error: "you can't follow yourself" }, { status: 400 });
  const wasFollowing = social.isFollowing(su.id, target.id);
  social.follow(su.id, target.id);
  if (!wasFollowing) notify(target.id, { type: 'follow', actorId: 'user:' + su.id, actorName: su.displayName, actorHandle: su.handle, text: 'started following you' });
  return json({ ok: true });
}

export async function DELETE({ request, params }) {
  const su = sessionUser(request);
  if (!su) return json({ error: 'sign in first' }, { status: 401 });
  const target = getByHandle(params.handle);
  if (!target) return json({ error: 'no such player' }, { status: 404 });
  social.unfollow(su.id, target.id);
  return json({ ok: true });
}
