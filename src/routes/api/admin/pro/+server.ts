import { json } from '@sveltejs/kit';
import { timingSafeEqual } from 'node:crypto';
import { getUser, setPro } from '$lib/server/users.js';
import { rateLimit, clientIp } from '$lib/server/ratelimit.js';

// Admin-only: manually grant (comp) or revoke Pro for an account. Same shared
// ADMIN_PASSWORD gate as the rest of the panel. In Phase 1 this is how Pro is
// assigned at all (no payments yet); Phase 2's webhooks will set it from a paid
// subscription instead. A manual grant is a 'comp' plan with no billing/end date.
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
  const grant = !!body?.pro;
  setPro(userId, grant
    ? { status: 'active', plan: 'comp', since: new Date().toISOString(), grantedBy: 'admin' }
    : null);
  return json({ ok: true, pro: grant });
}
