import { error } from '@sveltejs/kit';
import { getGame } from '$lib/server/store.js';
import { sessionUser } from '$lib/server/helpers.js';
import { publicGameCard } from '$lib/server/directory.js';

// Standalone shareable page for ONE open game — the link a host drops in a group
// chat. Only public games are viewable here; a private/unknown game 404s so a
// code-only game is never exposed by id. Same card projection as the directory.
export function load({ params, request }) {
  const g = getGame(params.id.toUpperCase());
  if (!g || g.visibility !== 'public') throw error(404, "This game isn't publicly listed.");
  const viewer = sessionUser(request);
  const game = publicGameCard(g, viewer?.id ?? null);
  const stakes = game.blinds ? ` · ${game.blinds.small}/${game.blinds.big} blinds` : '';
  return {
    game,
    meta: {
      title: `${game.name}${game.city ? ' — ' + game.city : ''} · potcount`,
      description: `${game.format} home poker game${game.city ? ' in ' + game.city : ''}${stakes} — request a seat on potcount. Free, nothing to install.`,
    },
  };
}
