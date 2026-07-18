import { json } from '@sveltejs/kit';
import { sessionUser } from '$lib/server/helpers.js';
import { allGames } from '$lib/server/store.js';
import { getUser } from '$lib/server/users.js';

// The signed-in user's OUTGOING join requests across all public games, with each
// game's public info + current status (pending / approved / rejected). Approved
// ones are also seated (so they show in "your games"); this list makes the
// pending + declined ones visible too.
export function GET({ request }) {
  const su = sessionUser(request);
  if (!su) return json({ requests: [] });
  const out = [];
  for (const g of allGames()) {
    const r = (g.joinRequests || []).find((x) => x.userId === su.id);
    if (!r) continue;
    const host = g.ownerId ? getUser(g.ownerId) : null;
    out.push({
      gameId: g.id,
      name: g.name,
      city: g.city || null,
      format: g.format || 'NLH',
      blinds: g.blinds || null,
      scheduledFor: g.scheduledFor || null,
      status: r.status, // pending | approved | rejected
      at: r.at,
      decidedAt: r.decidedAt || null,
      host: host ? { handle: host.handle, displayName: host.displayName } : null,
      seated: g.players.some((p) => p.userId === su.id),
    });
  }
  out.sort((a, b) => String(b.decidedAt || b.at).localeCompare(String(a.decidedAt || a.at)));
  return json({ requests: out });
}
