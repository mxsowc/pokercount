import { json } from '@sveltejs/kit';
import { getGame, mutate } from '$lib/server/store.js';
import { sessionUser, getActor, logEntry, withProfiles } from '$lib/server/helpers.js';

// Turn a scheduled game's lobby into a live table. Like close/reopen this is NOT
// host-gated — anyone holding the game can start it on the night (see the
// collaborative-editing model). The RSVP'd seats become the starting line-up.
export async function POST({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  if (g0.status === 'active') return json(withProfiles(g0)); // already live — idempotent
  if (g0.status !== 'scheduled') return json({ error: 'This game has already been played.' }, { status: 409 });

  const su = sessionUser(request);
  // Public games: only a seated player can start (prevents strangers from
  // premature-starting via the exposed game ID on /homegames).
  if (g0.visibility === 'public') {
    if (!su || !g0.players.some((p: any) => p.userId === su.id))
      return json({ error: 'Only a seated player can start a public game.' }, { status: 403 });
  }
  const actor = su ? { id: 'user:' + su.id, name: su.displayName } : getActor(request);

  const game = mutate(id, (g: any) => {
    if (g.status !== 'scheduled') return; // lost a race — someone started it first
    g.status = 'active';
    g.scheduledFor = null; // it's live now; no longer a future plan
    g.log.push(logEntry(actor, 'start_game', {}));
  });
  return json(withProfiles(game));
}
