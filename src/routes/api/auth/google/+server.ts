import { json } from '@sveltejs/kit';
import { upsertOAuth, publicUser } from '$lib/server/users.js';
import { sessionCookie, verifyGoogleIdToken } from '$lib/server/auth.js';
import { rateLimit, clientIp } from '$lib/server/ratelimit.js';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || null;

export async function POST(event) {
  const { request } = event;
  if (!GOOGLE_CLIENT_ID) return json({ error: 'Google sign-in is not configured' }, { status: 501 });
  if (!rateLimit('oauth:' + clientIp(event), 10, 300_000)) return json({ error: 'Too many sign-in attempts — try again in a few minutes.' }, { status: 429 });
  const { credential, newsletter } = await request.json();
  let payload;
  try { payload = await verifyGoogleIdToken(credential, GOOGLE_CLIENT_ID); }
  catch (e: any) { return json({ error: 'Google sign-in failed: ' + e.message }, { status: 401 }); }
  const verifiedEmail = payload.email_verified !== false ? payload.email : undefined;
  const u = upsertOAuth({
    provider: 'google', sub: payload.sub,
    displayName: payload.name || verifiedEmail,
    avatar: payload.picture,
    handleHint: (verifiedEmail || '').split('@')[0],
    email: verifiedEmail,
    newsletter: !!newsletter,
  });
  return json({ user: publicUser(u) }, {
    headers: { 'Set-Cookie': sessionCookie(u.id, request) }
  });
}
