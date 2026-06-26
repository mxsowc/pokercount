import { json } from '@sveltejs/kit';
import { sessionUser } from '$lib/server/helpers.js';
import { linkProvider, publicUser } from '$lib/server/users.js';
import { verifyGoogleIdToken } from '$lib/server/auth.js';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || null;

// Attach a Google identity to the CURRENTLY signed-in account (additive — your
// existing PIN/primary login keeps working). Same token verification as sign-in,
// but no new session is minted; we just record the link.
export async function POST({ request }) {
  const su = sessionUser(request);
  if (!su) return json({ error: 'not signed in' }, { status: 401 });
  if (!GOOGLE_CLIENT_ID) return json({ error: 'Google sign-in is not configured' }, { status: 501 });
  const { credential } = await request.json();
  let payload;
  try { payload = await verifyGoogleIdToken(credential, GOOGLE_CLIENT_ID); }
  catch (e: any) { return json({ error: 'Google verification failed: ' + e.message }, { status: 401 }); }
  try {
    const u = linkProvider(su.id, { provider: 'google', sub: payload.sub, email: payload.email, avatar: payload.picture });
    return json({ ok: true, user: publicUser(u) });
  } catch (e: any) {
    return json({ error: e.message }, { status: e.status || 400 });
  }
}
