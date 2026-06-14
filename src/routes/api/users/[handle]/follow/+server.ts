import { json } from '@sveltejs/kit';
import { sessionUser } from '$lib/server/helpers.js';
import { getByHandle } from '$lib/server/users.js';
import * as social from '$lib/server/social.js';

export async function POST({ request, params }) {
  const su = sessionUser(request);
  if (!su) return json({ error: 'sign in first' }, { status: 401 });
  const target = getByHandle(params.handle);
  if (!target) return json({ error: 'no such player' }, { status: 404 });
  if (target.id === su.id) return json({ error: "you can't follow yourself" }, { status: 400 });
  social.follow(su.id, target.id);
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
