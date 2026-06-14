import { getGame, onChange } from '$lib/server/store.js';

export function GET({ params }) {
  const id = params.id.toUpperCase();
  if (!getGame(id)) {
    return new Response(JSON.stringify({ error: 'game not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' }
    });
  }

  const encoder = new TextEncoder();
  let unsub: (() => void) | null = null;
  let hb: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: any) => {
        try { controller.enqueue(encoder.encode(`event: update\ndata: ${JSON.stringify(data)}\n\n`)); }
        catch { cleanup(); }
      };

      send(getGame(id));

      unsub = onChange((game: any) => {
        if (game.id === id) send(game);
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
