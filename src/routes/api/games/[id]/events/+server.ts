import { getGame, onChange } from '$lib/server/store.js';
import { withProfiles, isParticipant, publicPreview } from '$lib/server/helpers.js';
import { clientIp } from '$lib/server/ratelimit.js';

const MAX_PER_GAME = 100;
const MAX_PER_IP_PER_GAME = 5;

const gameConns = new Map<string, number>();
const ipGameConns = new Map<string, number>();

function inc(map: Map<string, number>, key: string) { map.set(key, (map.get(key) || 0) + 1); }
function dec(map: Map<string, number>, key: string) {
  const n = (map.get(key) || 1) - 1;
  if (n <= 0) map.delete(key); else map.set(key, n);
}

export function GET(event) {
  const g0 = getGame(event.params.id.toUpperCase());
  if (!g0) {
    return new Response(JSON.stringify({ error: 'game not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' }
    });
  }
  const id = g0.id;
  const ip = clientIp(event);
  const ipKey = `${ip}:${id}`;

  // Decide the view once, at connect: a non-participant watching a PUBLIC game
  // only ever receives the discovery preview (no money/log/chat) on every frame.
  const previewOnly = g0.visibility === 'public' && !isParticipant(g0, event.request);
  const view = (game: any) => (previewOnly ? publicPreview(game) : withProfiles(game));

  if ((gameConns.get(id) || 0) >= MAX_PER_GAME) {
    return new Response(JSON.stringify({ error: 'Too many listeners on this game.' }), {
      status: 429, headers: { 'Content-Type': 'application/json' }
    });
  }
  if ((ipGameConns.get(ipKey) || 0) >= MAX_PER_IP_PER_GAME) {
    return new Response(JSON.stringify({ error: 'Too many connections from this device.' }), {
      status: 429, headers: { 'Content-Type': 'application/json' }
    });
  }

  inc(gameConns, id);
  inc(ipGameConns, ipKey);

  const encoder = new TextEncoder();
  let unsub: (() => void) | null = null;
  let hb: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: any) => {
        try { controller.enqueue(encoder.encode(`event: update\ndata: ${JSON.stringify(data)}\n\n`)); }
        catch { cleanup(); }
      };

      send(view(getGame(id)));

      unsub = onChange((game: any) => {
        if (game.id !== id) return;
        if (game._deleted) {
          try { controller.enqueue(encoder.encode(`event: deleted\ndata: {}\n\n`)); } catch { /* closed */ }
          cleanup();
          return;
        }
        send(view(game));
      });

      hb = setInterval(() => {
        try { controller.enqueue(encoder.encode(': hb\n\n')); }
        catch { cleanup(); }
      }, 25000);
    },
    cancel() {
      cleanup();
    }
  });

  function cleanup() {
    if (hb) { clearInterval(hb); hb = null; }
    if (unsub) { unsub(); unsub = null; }
    dec(gameConns, id);
    dec(ipGameConns, ipKey);
  }

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    }
  });
}
