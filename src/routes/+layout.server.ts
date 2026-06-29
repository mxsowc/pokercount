import { publicUser, touchLastSeen } from '$lib/server/users.js';
import { sessionUser } from '$lib/server/helpers.js';
import { currencyForCountry } from '$lib/utils/currencies.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ request }) => {
  // sessionUser (not raw sessionUid) so a revoked session — "log out everywhere"
  // — shows logged-out chrome on every device's next page load, not just on the
  // device that triggered it.
  const full = sessionUser(request);
  if (full) touchLastSeen(full.id); // mark activity (throttled) for the active-users metric
  // This `user` is the CURRENT signed-in account (not the public view of someone
  // else), so it's safe to attach their own private region + the currency we'll
  // default their games to. publicUser() stays clean so other people's profiles
  // never leak these fields.
  const user = full
    ? { ...publicUser(full), country: full.country || null, homeUnit: currencyForCountry(full.country) }
    : null;
  return { user };
};
