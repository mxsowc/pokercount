import { sessionUid } from '$lib/server/auth.js';
import { getUser, publicUser, touchLastSeen } from '$lib/server/users.js';
import { currencyForCountry } from '$lib/utils/currencies.js';
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
  if (uid) touchLastSeen(uid); // mark activity (throttled) for the active-users metric
  const full = uid ? getUser(uid) : null;
  // This `user` is the CURRENT signed-in account (not the public view of someone
  // else), so it's safe to attach their own private region + the currency we'll
  // default their games to. publicUser() stays clean so other people's profiles
  // never leak these fields.
  const user = full
    ? { ...publicUser(full), country: full.country || null, homeUnit: currencyForCountry(full.country) }
    : null;
  return { user };
};
