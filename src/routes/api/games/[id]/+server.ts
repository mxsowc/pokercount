import { json } from '@sveltejs/kit';
import { getGame, deleteGame } from '$lib/server/store.js';
import { withProfiles, isGameHost, isParticipant, publicPreview } from '$lib/server/helpers.js';

export function GET({ params, request }) {
  const game = getGame(params.id.toUpperCase());
  if (!game) return json({ error: 'game not found' }, { status: 404 });
  // A PUBLIC game's id is published on /homegames, so a non-participant gets only
  // the discovery preview (no money, audit log, or chat). Private games are
  // reachable only by their secret id/code, so full access there is unchanged.
  if (game.visibility === 'public' && !isParticipant(game, request)) {
    return json(publicPreview(game));
  }
  return json(withProfiles(game));
}

// Hard-delete an EMPTY game (no buy-ins) — clean up abandoned/test tables so they
// don't linger as "active". A game with any buy-in has real history, so it can
// only be removed from a player's own list (DELETE /claim), never destroyed here.
export function DELETE({ params, request }) {
  const game = getGame(params.id.toUpperCase());
  if (!game) return json({ error: 'game not found' }, { status: 404 });
  // Only the host (account owner or host-token holder) may destroy the table —
  // otherwise any joiner/code-guesser could nuke a freshly-opened game.
  if (!isGameHost(game, request)) {
    return json({ error: 'Only the host can delete this game.' }, { status: 403 });
  }
  if ((game.transactions?.length || 0) > 0) {
    return json({ error: 'This game has buy-ins — it can only be removed from your own list.' }, { status: 409 });
  }
  deleteGame(game.id);
  return json({ ok: true, deleted: true });
}
