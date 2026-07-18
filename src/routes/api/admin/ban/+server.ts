import { json } from '@sveltejs/kit';
import { timingSafeEqual } from 'node:crypto';
import { getUser, setBanned } from '$lib/server/users.js';
import { closeReport } from '$lib/server/reports.js';
import { rateLimit, clientIp } from '$lib/server/ratelimit.js';

// Admin-only: ban (suspend) or un-ban an account, from the reports queue. Same
// shared ADMIN_PASSWORD gate as the rest of the admin panel. Banning stops the
// account signing in and kills its live sessions immediately.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function passwordOk(provided: string): boolean {
  if (!ADMIN_PASSWORD) return false;
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(ADMIN_PASSWORD);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(event) {
  const { request } = event;
  if (!rateLimit('admin:' + clientIp(event), 20, 60_000)) {
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
  const userId = String(body?.userId || '');
  if (!getUser(userId)) return json({ error: 'user not found' }, { status: 404 });
  const banned = !!body?.banned;
  setBanned(userId, banned);
  // Banning resolves any open reports about them; unbanning leaves the queue alone.
  if (banned && typeof body?.reportId === 'string') closeReport(body.reportId);
  return json({ ok: true, banned });
}
