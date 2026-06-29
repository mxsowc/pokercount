import { json } from '@sveltejs/kit';
import { loginLocal, publicUser, normalizeHandle } from '$lib/server/users.js';
import { sessionCookie } from '$lib/server/auth.js';
import { rateLimit, clientIp } from '$lib/server/ratelimit.js';

export async function POST(event) {
  const { request } = event;
  if (!rateLimit('login-ip:' + clientIp(event), 10, 5 * 60_000)) {
    return json({ error: 'Too many login attempts — try again in a few minutes' }, { status: 429 });
  }
  const body = await request.json();
  // Per-handle cap so one account can't be ground through from many IPs. Key on
  // the NORMALIZED handle (same normalization loginLocal uses to resolve the
  // account) — keying on the raw input let an attacker rotate punctuation
  // ("a.lice", "alice!") to mint a fresh bucket per request and defeat the cap.
  if (!rateLimit('login-h:' + normalizeHandle(body.handle), 20, 15 * 60_000)) {
    return json({ error: 'Too many attempts for this account — try again later' }, { status: 429 });
  }
  let u;
  try { u = loginLocal(body); } catch (e: any) {
    return json({ error: e.message }, { status: e.status || 401 });
  }
  return json({ user: publicUser(u) }, {
    headers: { 'Set-Cookie': sessionCookie(u.id, request) }
  });
}
