import { json } from '@sveltejs/kit';
import { sessionUser } from '$lib/server/helpers.js';
import { searchUsers, publicUser } from '$lib/server/users.js';

export function GET({ request, url }) {
  const su = sessionUser(request);
  if (!su) return json({ error: 'sign in to search' }, { status: 401 });
  const q = url.searchParams.get('q') || '';
  const results = searchUsers(q, su.id);
  return json({ users: results.map(publicUser) });
}
