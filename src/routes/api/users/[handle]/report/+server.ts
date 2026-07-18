import { json } from '@sveltejs/kit';
import { getByHandle } from '$lib/server/users.js';
import { sessionUser } from '$lib/server/helpers.js';
import { addReport } from '$lib/server/reports.js';
import { rateLimit } from '$lib/server/ratelimit.js';
import { REPORT_REASON_KEYS } from '$lib/reports';

// A signed-in user reports another player. Lands in the admin review queue.
export async function POST({ request, params }) {
  const su = sessionUser(request);
  if (!su) return json({ error: 'Sign in to report a player.' }, { status: 401 });
  // Cap reports per user so the queue can't be flooded.
  if (!rateLimit('report:' + su.id, 10, 60 * 60_000)) {
    return json({ error: 'Too many reports — try again later.' }, { status: 429 });
  }
  const target = getByHandle(params.handle);
  if (!target) return json({ error: 'no such player' }, { status: 404 });
  if (target.id === su.id) return json({ error: "You can't report yourself." }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const reason = REPORT_REASON_KEYS.has(body?.reason) ? body.reason : null;
  if (!reason) return json({ error: 'Pick a reason.' }, { status: 400 });
  const message = String(body?.message || '').trim();
  if (reason === 'other' && !message) return json({ error: 'Describe what happened.' }, { status: 400 });

  addReport({ reporterId: su.id, reportedId: target.id, reason, message });
  return json({ ok: true });
}
