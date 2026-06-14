import { ensureInit } from '$lib/server/init.js';
import { rateLimit, clientIp } from '$lib/server/ratelimit.js';
import { json } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit';

ensureInit();

export const handle: Handle = async ({ event, resolve }) => {
  // Throttle game traffic per IP so the short, shareable game codes can't be
  // swept by brute force. 200/min is far above any real game's needs.
  if (event.url.pathname.startsWith('/api/games')) {
    if (!rateLimit('game:' + clientIp(event), 200, 60_000)) {
      return json({ error: 'Too many requests — slow down a moment.' }, { status: 429 });
    }
  }
  return resolve(event);
};
