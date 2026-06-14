import { json } from '@sveltejs/kit';
import { sessionUser } from '$lib/server/helpers.js';
import { publicUser, updateProfile } from '$lib/server/users.js';

export function GET({ request }) {
  const su = sessionUser(request);
  return json({ user: publicUser(su) });
}

export async function PUT({ request }) {
  const su = sessionUser(request);
  if (!su) return json({ error: 'not signed in' }, { status: 401 });
  const { name } = await request.json();
  try {
    const u = updateProfile(su.id, { name });
    return json({ user: publicUser(u) });
  } catch (e: any) {
    return json({ error: e.message }, { status: e.status || 400 });
  }
}
