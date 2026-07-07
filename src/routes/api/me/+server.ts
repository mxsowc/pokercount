import { json } from '@sveltejs/kit';
import { sessionUser } from '$lib/server/helpers.js';
import { publicUser, updateProfile } from '$lib/server/users.js';

// Private self-view: publicUser plus the fields only YOU should see (email +
// account-linking state), so the account page can show/toggle them. Never use
// this for anyone else's profile.
function meView(u: any) {
  return {
    user: publicUser(u),
    newsletter: !!u.newsletter,
    hasEmail: !!u.email,
    email: u.email || null,
    hasPin: !!u.pinHash,
    primaryProvider: u.provider,                                   // 'local' | 'google' | 'apple'
    linkedProviders: (u.linkedProviders || []).map((lp: any) => lp.provider), // extras you can disconnect
  };
}

export function GET({ request }) {
  const su = sessionUser(request);
  if (!su) return json({ user: null });
  return json(meView(su));
}

export async function PUT({ request }) {
  const su = sessionUser(request);
  if (!su) return json({ error: 'not signed in' }, { status: 401 });
  const { name, avatar, privacy, newsletter, email, city } = await request.json();
  try {
    const u = updateProfile(su.id, { name, avatar, privacy, newsletter, email, city });
    return json(meView(u));
  } catch (e: any) {
    return json({ error: e.message }, { status: e.status || 400 });
  }
}
