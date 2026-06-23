import { getGame, onChange } from '$lib/server/store.js';
import { withProfiles } from '$lib/server/helpers.js';

export function GET({ params }) {
  const g0 = getGame(params.id.toUpperCase());
  if (!g0) {
    return new Response(JSON.stringify({ error: 'game not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' }
    });
  }
  // Always filter/snapshot by the canonical internal id (the URL may be a code).
  const id = g0.id;

  const encoder = new TextEncoder();
  let unsub: (() => void) | null = null;
  let hb: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: any) => {
        try { controller.enqueue(encoder.encode(`event: update\ndata: ${JSON.stringify(data)}\n\n`)); }
        catch { cleanup(); }
      };

      send(withProfiles(getGame(id)));

      unsub = onChange((game: any) => {
        if (game.id === id) send(withProfiles(game));
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
  }

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    }
  });
}
