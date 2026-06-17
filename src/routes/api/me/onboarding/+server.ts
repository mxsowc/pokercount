import { json } from '@sveltejs/kit';
import { sessionUser } from '$lib/server/helpers.js';
import { saveOnboarding, publicUser } from '$lib/server/users.js';

// Save the one-time onboarding answers (all optional). Posting with no fields
// just marks onboarding as done ("skip"), so the prompt won't show again.
export async function POST({ request }) {
  const su = sessionUser(request);
  if (!su) return json({ error: 'sign in first' }, { status: 401 });
  let body: any = {};
  try { body = await request.json(); } catch { /* empty = skip */ }
  const u = saveOnboarding(su.id, {
    ageRange: body?.ageRange,
    country: body?.country,
    heardFrom: body?.heardFrom,
  });
  return json({ user: publicUser(u) });
}
