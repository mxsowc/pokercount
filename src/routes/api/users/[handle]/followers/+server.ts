import { json } from '@sveltejs/kit';
import { sessionUser, privacyBlock } from '$lib/server/helpers.js';
import { getByHandle, getUser, publicUser } from '$lib/server/users.js';
import { getFollowers } from '$lib/server/social.js';

export function GET({ request, params }) {
  const su = sessionUser(request);
  if (!su) return json({ error: 'sign in first' }, { status: 401 });
  const target = getByHandle(params.handle);
  if (!target) return json({ error: 'no such player' }, { status: 404 });
  // The follower LIST is private-gated; the count stays public via /social.
  const blocked = privacyBlock(target, request);
  if (blocked) return json({ error: blocked.error }, { status: blocked.status });
  const ids = getFollowers(target.id);
  return json({ followers: ids.map(id => publicUser(getUser(id))).filter(Boolean) });
}
