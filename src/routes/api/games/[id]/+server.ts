import { json } from '@sveltejs/kit';
import { getGame } from '$lib/server/store.js';
import { withProfiles } from '$lib/server/helpers.js';

export function GET({ params }) {
  const game = getGame(params.id.toUpperCase());
  if (!game) return json({ error: 'game not found' }, { status: 404 });
  return json(withProfiles(game));
}
