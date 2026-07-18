import { json } from '@sveltejs/kit';
import { sessionUser } from '$lib/server/helpers.js';
import { normalizeHandle, verifyPin, deleteUser } from '$lib/server/users.js';
import { unlinkUser } from '$lib/server/store.js';
import { removeUser as socialRemoveUser } from '$lib/server/social.js';
import { removeUser as commentsRemoveUser } from '$lib/server/comments.js';
import { removeUser as reactionsRemoveUser } from '$lib/server/reactions.js';
import { removeUser as reportsRemoveUser } from '$lib/server/reports.js';
import { removeUser as notificationsRemoveUser } from '$lib/server/notifications.js';
import { clearCookie } from '$lib/server/auth.js';

// Permanently delete the signed-in account. Deliberate-action guard: the caller
// must type their exact username, and PIN accounts must re-enter their PIN. The
// account record (incl. email + PIN hash) is erased and the user is scrubbed from
// the social graph, comments and reactions. Games they played are KEPT — their
// seats simply lose the link to a profile (see unlinkUser).
export async function POST({ request }) {
  const su = sessionUser(request);
  if (!su) return json({ error: 'not signed in' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  if (normalizeHandle(body?.confirm) !== su.handle) {
    return json({ error: 'Type your exact username to confirm' }, { status: 400 });
  }
  // PIN accounts re-authenticate; OAuth-only accounts have no PIN, so the typed
  // username (over an already-authenticated session) is the confirmation.
  if (su.pinHash && !verifyPin(su.id, body?.pin)) {
    return json({ error: 'Wrong passcode' }, { status: 401 });
  }

  // Scrub references first, then drop the account record itself.
  unlinkUser(su.id);
  socialRemoveUser(su.id);
  commentsRemoveUser(su.id);
  reactionsRemoveUser(su.id);
  reportsRemoveUser(su.id);
  notificationsRemoveUser(su.id);
  deleteUser(su.id);

  // End the session — the account no longer exists.
  return json({ ok: true, deleted: true }, { headers: { 'Set-Cookie': clearCookie(request) } });
}
