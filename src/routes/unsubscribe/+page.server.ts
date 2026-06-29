import { verifyUnsubToken } from '$lib/server/auth.js';
import { getUser, setNewsletter } from '$lib/server/users.js';

// One-click unsubscribe from the monthly summary email. The link carries a signed
// token so it works while logged out but can't unsubscribe anyone else.
export function load({ url }) {
  const u = url.searchParams.get('u') || '';
  const t = url.searchParams.get('t') || '';
  const ok = verifyUnsubToken(u, t);
  const user = ok ? getUser(u) : null;
  return { ok: ok && !!user, handle: user?.handle ?? null, subscribed: !!user?.newsletter };
}

export const actions = {
  // POSTed by the page's confirm button AND by mail clients honouring the
  // List-Unsubscribe-Post one-click header — both land here.
  default: async ({ url }) => {
    const u = url.searchParams.get('u') || '';
    const t = url.searchParams.get('t') || '';
    if (verifyUnsubToken(u, t)) setNewsletter(u, false);
    return { done: true };
  },
};
