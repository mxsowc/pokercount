import { sessionUid } from '$lib/server/auth.js';
import { getUser, publicUser } from '$lib/server/users.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ request }) => {
  const cookieHeader = request.headers.get('cookie') || '';
  // Parse the session cookie the same way auth.js does
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    cookies[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  const uid = cookies['pc_session'] ? sessionUid({ headers: { cookie: cookieHeader } } as any) : null;
  const user = uid ? publicUser(getUser(uid)) : null;
  return { user };
};
