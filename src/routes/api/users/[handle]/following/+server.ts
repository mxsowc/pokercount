import { json } from '@sveltejs/kit';
import { sessionUser } from '$lib/server/helpers.js';
import { getByHandle, getUser, publicUser } from '$lib/server/users.js';
import { getFollowing } from '$lib/server/social.js';

export function GET({ request, params }) {
  const su = sessionUser(request);
  if (!su) return json({ error: 'sign in first' }, { status: 401 });
  const target = getByHandle(params.handle);
  if (!target) return json({ error: 'no such player' }, { status: 404 });
  const ids = getFollowing(target.id);
  return json({ following: [...ids].map(id => publicUser(getUser(id))).filter(Boolean) });
}
