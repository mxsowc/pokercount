import { json } from '@sveltejs/kit';
import { sessionUser } from '$lib/server/helpers.js';
import { getFollowing } from '$lib/server/social.js';
import { getUser, publicUser } from '$lib/server/users.js';

export function GET({ request }) {
  const su = sessionUser(request);
  if (!su) return json({ error: 'sign in first' }, { status: 401 });
  const ids = getFollowing(su.id);
  const list = [...ids].map(id => publicUser(getUser(id))).filter(Boolean);
  return json({ following: list });
}
