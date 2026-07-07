import { json } from '@sveltejs/kit';
import { sessionUser } from '$lib/server/helpers.js';
import { allGames } from '$lib/server/store.js';

// Games the current account is seated in (by player.userId) — so a signed-in
// user sees their ongoing/past sessions on any device, even ones they never
// opened locally. Powers the home "Your games" list.
export function GET({ request }) {
  const su = sessionUser(request);
  if (!su) return json({ error: 'sign in first' }, { status: 401 });

  const mine = [];
  for (const g of allGames()) {
    const players = g.players || [];
    const seat = players.find((p: any) => p.userId === su.id);
    if (!seat) continue;
    // This seat's still-open money actions in a finished game. Only 'ended' games
    // carry transfers ('settled' = balanced, nothing owed). `youOwe` = unpaid
    // transfers where you're the payer; `youConfirm` = transfers you received that
    // the payer marked paid but you haven't confirmed yet. Home surfaces these.
    let oweC = 0, confirmC = 0;
    for (const t of g.settlement?.transfers || []) {
      if (t.from === seat.id && !t.paid) oweC += Math.round((t.amount || 0) * 100);
      else if (t.to === seat.id && t.paid && !t.confirmed) confirmC += Math.round((t.amount || 0) * 100);
    }
    mine.push({
      id: g.id,
      code: g.code ?? g.id,
      name: g.name,
      unit: g.unit,
      status: g.status,
      players: players.length,
      seatName: seat.name,
      at: g.updatedAt,
      scheduledFor: g.scheduledFor || null, // set only for scheduled games → home "Planned"
      youOwe: oweC / 100,
      youConfirm: confirmC / 100,
    });
  }
  // active first, then most-recently-updated (updatedAt is an ISO string, which
  // sorts chronologically as text).
  const rank = (s: string) => (s === 'active' ? 0 : s === 'ended' ? 1 : 2);
  mine.sort((a, b) => rank(a.status) - rank(b.status) || String(b.at).localeCompare(String(a.at)));
  return json({ games: mine.slice(0, 50) });
}
