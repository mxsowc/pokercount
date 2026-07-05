import { json } from '@sveltejs/kit';
import { getGame, mutate } from '$lib/server/store.js';
import { sessionUser, getActor, logEntry } from '$lib/server/helpers.js';

export async function POST({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  const su = sessionUser(request);
  const actor = su ? { id: 'user:' + su.id, name: su.displayName } : getActor(request);
  // Reopening is open to anyone with the game, same as closing — host isn't special.
  const game = mutate(id, (g: any) => {
    g.status = 'active';
    g.createdAt = new Date().toISOString();
    // Archive the locked-in settlement instead of destroying it, so a result
    // that was already shared/screenshotted can't be quietly rewritten.
    if (g.settlement) {
      (g.receipts ??= []).push({ ...g.settlement, archivedAt: new Date().toISOString() });
      if (g.receipts.length > 20) g.receipts = g.receipts.slice(-20);
    }
    delete g.settlement;
    g.log.push(logEntry(actor, 'reopen_game', {}));
  });
  return json(game);
}
