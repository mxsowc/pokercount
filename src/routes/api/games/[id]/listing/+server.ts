import { json } from '@sveltejs/kit';
import { getGame, mutate } from '$lib/server/store.js';
import { getActor, isGameHost, logEntry } from '$lib/server/helpers.js';
import { withProfiles } from '$lib/server/helpers.js';

// Host-only: publish a game to the public city directory (or pull it back).
// Body: { visibility?: 'public'|'private', city?: string|null, maxPlayers?: number|null }.
export async function PUT({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  // Only a live table or a scheduled lobby can be listed — a closed game can't be joined.
  if (g0.status !== 'active' && g0.status !== 'scheduled') return json({ error: 'Game is closed.' }, { status: 409 });
  if (!isGameHost(g0, request)) return json({ error: 'Only the host can change the public listing.' }, { status: 403 });

  const actor = getActor(request);
  const body = await request.json().catch(() => ({}));

  try {
    const game = mutate(id, (g: any) => {
      const detail: any = {};

      if (body.city !== undefined) {
        g.city = body.city ? String(body.city).trim().replace(/\s+/g, ' ').slice(0, 60) : null;
        detail.city = g.city;
      }

      if (body.maxPlayers !== undefined) {
        const n = Number(body.maxPlayers);
        // 0 / null / invalid → no cap. Otherwise 2–50 (a home game, not a casino).
        g.maxPlayers = Number.isFinite(n) && n >= 2 ? Math.min(50, Math.floor(n)) : 0;
        detail.maxPlayers = g.maxPlayers;
      }

      if (body.minBuyIn !== undefined) {
        const n = Number(body.minBuyIn);
        // In blinds. 0 / null / invalid → no minimum. Capped so it stays sane.
        g.minBuyIn = Number.isFinite(n) && n > 0 ? Math.min(1_000_000, Math.floor(n)) : 0;
        detail.minBuyIn = g.minBuyIn;
      }

      if (body.maxBuyIn !== undefined) {
        const n = Number(body.maxBuyIn);
        // In blinds. 0 / null / invalid → no max = FIXED buy-in (everyone in for the
        // min; top-ups agreed in-game). When set, it can't sit below the minimum.
        g.maxBuyIn = Number.isFinite(n) && n > 0 ? Math.min(1_000_000, Math.max(Math.floor(n), g.minBuyIn || 0)) : 0;
        detail.maxBuyIn = g.maxBuyIn;
      }

      if (body.smallBlind !== undefined || body.bigBlind !== undefined) {
        const sb = Number(body.smallBlind);
        const bb = Number(body.bigBlind);
        if (Number.isFinite(sb) && sb > 0 && Number.isFinite(bb) && bb > 0) {
          // Big blind can't sit below the small blind.
          const small = Math.min(sb, bb);
          const big = Math.max(sb, bb);
          g.blinds = { small: Math.min(1_000_000, small), big: Math.min(1_000_000, big) };
          detail.blinds = g.blinds;
        } else {
          // Either cleared → drop the level.
          delete g.blinds;
          detail.blinds = null;
        }
      }

      if (body.visibility !== undefined) {
        const v = body.visibility === 'public' ? 'public' : 'private';
        if (v === 'public' && !g.city) {
          const e: any = new Error('Set a city before listing this game publicly.'); e.status = 400; throw e;
        }
        g.visibility = v;
        detail.visibility = v;
        // Public/open games are ALWAYS played in blinds — never a real-money
        // currency. This keeps the public directory social play (no stakes shown),
        // which is the crux of staying the right side of NL gambling law.
        if (v === 'public' && g.unit !== 'blinds') {
          g.unit = 'blinds';
          detail.unit = 'blinds';
        }
      }

      if (Object.keys(detail).length) g.log.push(logEntry(actor, 'edit_listing', { detail }));
    });
    return json(withProfiles(game));
  } catch (e: any) {
    return json({ error: e.message || 'failed' }, { status: e.status || 400 });
  }
}
