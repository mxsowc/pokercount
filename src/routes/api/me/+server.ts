import { json } from '@sveltejs/kit';
import { sessionUser } from '$lib/server/helpers.js';
import { publicUser, updateProfile } from '$lib/server/users.js';

export function GET({ request }) {
  const su = sessionUser(request);
  if (!su) return json({ user: null });
  // newsletter/hasEmail are private (not in publicUser), returned only for yourself
  // so the account page can show & toggle the preference.
  return json({ user: publicUser(su), newsletter: !!su.newsletter, hasEmail: !!su.email });
}

export async function PUT({ request }) {
  const su = sessionUser(request);
  if (!su) return json({ error: 'not signed in' }, { status: 401 });
  const { name, avatar, privacy, newsletter } = await request.json();
  try {
    const u = updateProfile(su.id, { name, avatar, privacy, newsletter });
    return json({ user: publicUser(u), newsletter: !!u.newsletter, hasEmail: !!u.email });
  } catch (e: any) {
    return json({ error: e.message }, { status: e.status || 400 });
  }
}
