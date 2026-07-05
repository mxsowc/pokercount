import { json } from '@sveltejs/kit';
import { sessionUser } from '$lib/server/helpers.js';
import { listNotifications, unreadCount, markRead } from '$lib/server/notifications.js';

// GET /api/me/notifications → { notifications, unread }. Signed-out returns empty
// so the nav can call it unconditionally.
export function GET({ request }) {
  const su = sessionUser(request);
  if (!su) return json({ notifications: [], unread: 0 });
  return json({ notifications: listNotifications(su.id), unread: unreadCount(su.id) });
}

// POST /api/me/notifications { ids? } → mark some (or all) read.
export async function POST({ request }) {
  const su = sessionUser(request);
  if (!su) return json({ error: 'sign in first' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  markRead(su.id, Array.isArray(body?.ids) ? body.ids : undefined);
  return json({ ok: true, unread: unreadCount(su.id) });
}
