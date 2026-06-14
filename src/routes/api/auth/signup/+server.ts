import { json } from '@sveltejs/kit';
import { createLocal, publicUser } from '$lib/server/users.js';
import { sessionCookie } from '$lib/server/auth.js';
import { rateLimit, clientIp } from '$lib/server/ratelimit.js';

export async function POST(event) {
  const { request } = event;
  // Cap account creation per IP (each signup writes the whole users file).
  if (!rateLimit('signup:' + clientIp(event), 10, 60 * 60_000)) {
    return json({ error: 'Too many sign-ups — try again later' }, { status: 429 });
  }
  const body = await request.json();
  let u;
  try { u = createLocal(body); } catch (e: any) {
    return json({ error: e.message }, { status: e.status || 400 });
  }
  return json({ user: publicUser(u) }, {
    status: 201,
    headers: { 'Set-Cookie': sessionCookie(u.id, request) }
  });
}
