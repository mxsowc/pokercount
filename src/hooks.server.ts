import { ensureInit } from '$lib/server/init.js';
import { startBackupScheduler } from '$lib/server/backup.js';
import { startFxScheduler } from '$lib/server/fx.js';
import { rateLimit, clientIp } from '$lib/server/ratelimit.js';
import { json } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit';

ensureInit();
startBackupScheduler();
startFxScheduler();

export const handle: Handle = async ({ event, resolve }) => {
  if (event.url.pathname.startsWith('/api/games')) {
    const ip = clientIp(event);
    if (!rateLimit('game:' + ip, 200, 60_000)) {
      return json({ error: 'Too many requests — slow down a moment.' }, { status: 429 });
    }
    // Stricter limit on game creation to prevent disk/memory flooding.
    if (event.request.method === 'POST' && event.url.pathname === '/api/games') {
      if (!rateLimit('create:' + ip, 10, 60_000)) {
        return json({ error: 'Too many games created — slow down a moment.' }, { status: 429 });
      }
    }
  }
  const response = await resolve(event);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return response;
};
