import { json } from '@sveltejs/kit';
import { sessionUser } from '$lib/server/helpers.js';
import { linkProvider, publicUser } from '$lib/server/users.js';
import { verifyAppleIdToken } from '$lib/server/auth.js';

const APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID || null;

// Attach an Apple identity to the CURRENTLY signed-in account (additive). Same
// token verification as sign-in, but no new session is minted.
export async function POST({ request }) {
  const su = sessionUser(request);
  if (!su) return json({ error: 'not signed in' }, { status: 401 });
  if (!APPLE_CLIENT_ID) return json({ error: 'Apple sign-in is not configured' }, { status: 501 });
  const { idToken } = await request.json();
  let payload;
  try { payload = await verifyAppleIdToken(idToken, APPLE_CLIENT_ID); }
  catch (e: any) { return json({ error: 'Apple verification failed: ' + e.message }, { status: 401 }); }
  try {
    const u = linkProvider(su.id, { provider: 'apple', sub: payload.sub, email: (payload.email || '').toString() });
    return json({ ok: true, user: publicUser(u) });
  } catch (e: any) {
    return json({ error: e.message }, { status: e.status || 400 });
  }
}
