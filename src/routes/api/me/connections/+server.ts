import { json } from '@sveltejs/kit';
import { sessionUser } from '$lib/server/helpers.js';
import { getFollowing, getFollowers } from '$lib/server/social.js';
import { getUser, publicUser } from '$lib/server/users.js';

// Suggestions when a host types a player name: people the current user follows
// or is followed by (following ranked first), optionally filtered by query.
export function GET({ request, url }) {
  const su = sessionUser(request);
  if (!su) return json({ error: 'sign in first' }, { status: 401 });

  const q = (url.searchParams.get('q') || '').trim().toLowerCase();

  // following first (stronger signal), then followers; dedupe by id.
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of getFollowing(su.id)) { if (!seen.has(id)) { seen.add(id); ordered.push(id); } }
  for (const id of getFollowers(su.id)) { if (!seen.has(id)) { seen.add(id); ordered.push(id); } }

  const matches = [];
  for (const id of ordered) {
    const u = getUser(id);
    if (!u) continue;
    if (q && !u.handle.toLowerCase().includes(q) && !u.displayName.toLowerCase().includes(q)) continue;
    matches.push(publicUser(u));
    if (matches.length >= 8) break;
  }
  return json({ connections: matches });
}
