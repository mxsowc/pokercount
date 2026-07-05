import { getGame } from '$lib/server/store.js';
import { fmtSigned } from '$lib/utils/money';

// Server-render a per-game social preview so the shared game link — the single
// most-opened message of the night — unfurls with real names and results
// (crawlers don't run our client fetch). Neutral, ledger-framed copy only:
// a net figure like "Max +€240", never "winnings". Flows into the og/twitter
// tags via the layout ($page.data.meta).
export function load({ url }) {
  const g = url.searchParams.get('g');
  if (!g) return {};
  const game = getGame(String(g).toUpperCase());
  if (!game) return {};

  const code = game.code ?? game.id;
  const n = game.players.length;
  const players = n === 1 ? '1 player' : `${n} players`;
  const unit = game.unit || '€';

  let description: string;
  const lines = game.status !== 'active' ? game.settlement?.lines : null;
  if (lines?.length) {
    const top = [...lines].sort((a, b) => b.net - a.net)[0];
    description = top && top.net > 0
      ? `${top.name} ${fmtSigned(top.net, unit)} · ${players} · #${code}`
      : `${players} · settled up · #${code}`;
  } else {
    description = `${players} · live now · join with code #${code}`;
  }

  return { meta: { title: `${game.name} · potcount`, description } };
}
