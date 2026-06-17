import { json } from '@sveltejs/kit';
import { upsertOAuth, publicUser } from '$lib/server/users.js';
import { sessionCookie, verifyAppleIdToken } from '$lib/server/auth.js';

// The Services ID configured for Sign in with Apple (e.g. com.you.potcount.web).
const APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID || null;

export async function POST({ request }) {
  if (!APPLE_CLIENT_ID) return json({ error: 'Apple sign-in is not configured' }, { status: 501 });
  const { idToken, name, newsletter } = await request.json();
  let payload;
  try { payload = await verifyAppleIdToken(idToken, APPLE_CLIENT_ID); }
  catch (e: any) { return json({ error: 'Apple sign-in failed: ' + e.message }, { status: 401 }); }

  // Apple only sends the user's name on the very first authorization (in the JS
  // response, not the token), so fall back to the email local-part, then a
  // placeholder. The chosen handle is editable later from the account page.
  const email = (payload.email || '').toString();
  const display = (name && String(name).trim()) || (email ? email.split('@')[0] : '') || 'Apple user';
  const u = upsertOAuth({
    provider: 'apple',
    sub: payload.sub,
    displayName: display,
    handleHint: email ? email.split('@')[0] : 'player',
    email,
    newsletter: !!newsletter,
  });
  return json({ user: publicUser(u) }, {
    headers: { 'Set-Cookie': sessionCookie(u.id, request) },
  });
}
