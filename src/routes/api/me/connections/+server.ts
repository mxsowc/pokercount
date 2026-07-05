import { json } from '@sveltejs/kit';
import { sessionUser } from '$lib/server/helpers.js';
import { getFollowing, getFollowers } from '$lib/server/social.js';
import { getUser, publicUser } from '$lib/server/users.js';
import { allGames } from '$lib/server/store.js';

// Suggestions when a host types a player name. Co-players first (the accounts you
// actually share games with — the strongest signal and usually non-empty, unlike
// the follow graph), then people you follow, then followers.
export function GET({ request, url }) {
  const su = sessionUser(request);
  if (!su) return json({ error: 'sign in first' }, { status: 401 });

  const q = (url.searchParams.get('q') || '').trim().toLowerCase();

  // Co-play graph: how often each other account has shared a game with me.
  const coCount = new Map<string, number>();
  for (const g of allGames()) {
    const players = g.players || [];
    if (!players.some((p: any) => p.userId === su.id)) continue;
    for (const p of players) {
      if (p.userId && p.userId !== su.id) coCount.set(p.userId, (coCount.get(p.userId) || 0) + 1);
    }
  }
  const coRanked = [...coCount.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);

  // Established connections — a lower-priority source, and lets a private account
  // you already know still surface.
  const followSet = new Set<string>([...getFollowing(su.id), ...getFollowers(su.id)]);

  const seen = new Set<string>();
  const ordered: string[] = [];
  const push = (id: string) => { if (id !== su.id && !seen.has(id)) { seen.add(id); ordered.push(id); } };
  coRanked.forEach(push);
  getFollowing(su.id).forEach(push);
  getFollowers(su.id).forEach(push);

  const matches = [];
  for (const id of ordered) {
    const u = getUser(id);
    if (!u) continue;
    const pu = publicUser(u);
    if (!pu) continue;
    // Don't surface a private account as a suggestion unless you already know them.
    if (pu.privacy === 'private' && !followSet.has(id)) continue;
    if (q && !u.handle.toLowerCase().includes(q) && !u.displayName.toLowerCase().includes(q)) continue;
    matches.push(pu);
    if (matches.length >= 8) break;
  }
  return json({ connections: matches });
}
