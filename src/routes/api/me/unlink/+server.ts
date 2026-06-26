import { json } from '@sveltejs/kit';
import { sessionUser } from '$lib/server/helpers.js';
import { unlinkProvider, publicUser } from '$lib/server/users.js';

// Disconnect a later-linked Google/Apple identity. Only removes EXTRA links — an
// account's original sign-in method can never be unlinked here, so there's no way
// to lock yourself out.
export async function POST({ request }) {
  const su = sessionUser(request);
  if (!su) return json({ error: 'not signed in' }, { status: 401 });
  const { provider } = await request.json();
  if (provider !== 'google' && provider !== 'apple') {
    return json({ error: 'unknown provider' }, { status: 400 });
  }
  try {
    const u = unlinkProvider(su.id, provider);
    return json({ ok: true, user: publicUser(u) });
  } catch (e: any) {
    return json({ error: e.message }, { status: e.status || 400 });
  }
}
