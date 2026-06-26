import { json } from '@sveltejs/kit';
import { timingSafeEqual } from 'node:crypto';
import { getGame, deleteGame } from '$lib/server/store.js';
import { rateLimit, clientIp } from '$lib/server/ratelimit.js';

// Admin-only hard delete of ANY game (including ones with buy-ins / history) — for
// cleaning up test/junk tables from the admin panel. The public DELETE
// (/api/games/[id]) deliberately refuses games with history; this is the operator
// override, gated on the same shared ADMIN_PASSWORD as the admin stats endpoint.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function passwordOk(provided: string): boolean {
  if (!ADMIN_PASSWORD) return false;
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(ADMIN_PASSWORD);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(event) {
  const { request } = event;
  // Same throttle bucket as the admin login, to stop password guessing.
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
  const id = String(body?.id || '').toUpperCase();
  const game = getGame(id);
  if (!game) return json({ error: 'game not found' }, { status: 404 });
  const deleted = deleteGame(game.id);
  return json({ ok: !!deleted, deleted: !!deleted });
}
