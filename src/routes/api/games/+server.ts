import { json } from '@sveltejs/kit';
import { createGame, mutate, uid } from '$lib/server/store.js';
import { sessionUser, getActor, logEntry } from '$lib/server/helpers.js';
import { signGameToken } from '$lib/server/auth.js';

// First-party acquisition: where this game's creator first arrived from. The
// client sends a best-effort {ref, referrer, landing}; we re-sanitise (never
// trust the client) into short, charset-limited strings before storing.
function cleanAcquisition(src: any): { ref: string | null; referrer: string | null; landing: string | null } | null {
  if (!src || typeof src !== 'object') return null;
  const clip = (v: any, re: RegExp, n: number) =>
    (typeof v === 'string' ? v.toLowerCase().replace(re, '').slice(0, n) : '') || null;
  const ref = clip(src.ref, /[^a-z0-9_.-]/g, 40);
  const referrer = clip(src.referrer, /[^a-z0-9.:-]/g, 80);
  const landing = clip(src.landing, /[^a-z0-9/_-]/g, 80);
  return (ref || referrer || landing) ? { ref, referrer, landing } : null;
}

export async function POST({ request }) {
  const su = sessionUser(request);
  const actor = su ? { id: 'user:' + su.id, name: su.displayName } : getActor(request);
  const body = await request.json();
  const acquisition = cleanAcquisition(body?.source);
  let game;
  try {
    game = createGame(body);
  } catch (e: any) {
    return json({ error: e.message }, { status: e.status || 400 });
  }
  game = mutate(game.id, (g: any) => {
    g.hostId = actor.id;
    g.tokenedHost = true;
    if (acquisition) g.acquisition = acquisition;
    if (su) {
      g.ownerId = su.id;
      if (g.players[0]) g.players[0].userId = su.id;
    }
    g.log.push(logEntry(actor, 'create', { detail: { name: g.name } }));
  });
  if (!game) return json({ error: 'failed to create game' }, { status: 500 });
  return json({ ...game, hostToken: signGameToken(game.id) }, { status: 201 });
}
