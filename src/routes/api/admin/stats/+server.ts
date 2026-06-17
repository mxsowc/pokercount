import { json } from '@sveltejs/kit';
import { timingSafeEqual } from 'node:crypto';
import { allUsers } from '$lib/server/users.js';
import { rateLimit, clientIp } from '$lib/server/ratelimit.js';

// Gate: a single shared password from the env. No ADMIN_PASSWORD set = locked.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function passwordOk(provided: string): boolean {
  if (!ADMIN_PASSWORD) return false;
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(ADMIN_PASSWORD);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(event) {
  const { request } = event;
  // Throttle to stop password guessing.
  if (!rateLimit('admin:' + clientIp(event), 10, 60_000)) {
    return json({ error: 'Too many attempts — wait a minute.' }, { status: 429 });
  }
  if (!ADMIN_PASSWORD) {
    return json({ error: 'Admin is not configured yet (set the ADMIN_PASSWORD env var).' }, { status: 503 });
  }
  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }
  if (!passwordOk(body?.password)) {
    return json({ error: 'Wrong password' }, { status: 401 });
  }

  const users = allUsers();
  const providers: Record<string, number> = {};
  const perDay: Record<string, number> = {};
  let withEmail = 0;
  let optedIn = 0;
  for (const u of users) {
    providers[u.provider] = (providers[u.provider] || 0) + 1;
    if (u.email) withEmail++;
    if (u.newsletter) optedIn++;
    const day = String(u.createdAt || '').slice(0, 10);
    if (day) perDay[day] = (perDay[day] || 0) + 1;
  }

  // Newest first; never include pinHash.
  const recent = [...users]
    .sort((a, b) => (String(a.createdAt) < String(b.createdAt) ? 1 : -1))
    .slice(0, 30)
    .map((u) => ({
      handle: u.handle,
      displayName: u.displayName,
      provider: u.provider,
      email: u.email || null,
      newsletter: !!u.newsletter,
      ageRange: u.ageRange || null,
      country: u.country || null,
      heardFrom: u.heardFrom || null,
      createdAt: u.createdAt,
    }));

  return json({ total: users.length, providers, withEmail, optedIn, perDay, recent });
}
