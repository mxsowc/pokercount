import { json } from '@sveltejs/kit';
import { upsertOAuth, publicUser } from '$lib/server/users.js';
import { sessionCookie, verifyGoogleIdToken } from '$lib/server/auth.js';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || null;

export async function POST({ request }) {
  if (!GOOGLE_CLIENT_ID) return json({ error: 'Google sign-in is not configured' }, { status: 501 });
  const { credential, newsletter } = await request.json();
  let payload;
  try { payload = await verifyGoogleIdToken(credential, GOOGLE_CLIENT_ID); }
  catch (e: any) { return json({ error: 'Google sign-in failed: ' + e.message }, { status: 401 }); }
  const u = upsertOAuth({
    provider: 'google', sub: payload.sub,
    displayName: payload.name || payload.email,
    avatar: payload.picture,
    handleHint: (payload.email || '').split('@')[0],
    email: payload.email,
    newsletter: !!newsletter,
  });
  return json({ user: publicUser(u) }, {
    headers: { 'Set-Cookie': sessionCookie(u.id, request) }
  });
}
