import { json } from '@sveltejs/kit';
import { getGame, mutate, uid } from '$lib/server/store.js';
import { getActor, logEntry, withProfiles } from '$lib/server/helpers.js';

export async function GET({ params }) {
  const id = params.id.toUpperCase();
  const game = getGame(id);
  if (!game) return json({ error: 'game not found' }, { status: 404 });
  const { computeSettlement } = await import('$lib/engine/settle.js');
  return json(computeSettlement(game.players, game.transactions, game.finalStacks));
}

export async function PUT({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  if (!g0.settlement) return json({ error: 'The game has to be ended first' }, { status: 409 });
  const actor = getActor(request);
  const body = await request.json();
  if (!Array.isArray(body.transfers)) return json({ error: 'transfers must be a list' }, { status: 400 });

  const c = (x: any) => Math.round(Number(x) * 100);
  const unit = g0.unit || '\u20ac';
  const fmt = (cents: number) => unit + (cents / 100).toFixed(2);
  const owe = new Map(), owed = new Map(), nameOf = new Map();
  for (const l of g0.settlement.lines) {
    nameOf.set(l.playerId, l.name);
    const net = c(l.net);
    if (net < 0) owe.set(l.playerId, -net);
    else if (net > 0) owed.set(l.playerId, net);
  }
  const outSum = new Map(), inSum = new Map();
  const clean: any[] = [];
  for (const t of body.transfers) {
    const amt = c(t.amount);
    if (!(amt > 0)) continue;
    if (t.from === t.to) return json({ error: "A player can't pay themselves" }, { status: 400 });
    if (!owe.has(t.from)) return json({ error: `${nameOf.get(t.from) || 'That player'} isn't down money` }, { status: 400 });
    if (!owed.has(t.to)) return json({ error: `${nameOf.get(t.to) || 'That player'} isn't owed money` }, { status: 400 });
    outSum.set(t.from, (outSum.get(t.from) || 0) + amt);
    inSum.set(t.to, (inSum.get(t.to) || 0) + amt);
    clean.push({ from: t.from, to: t.to, amount: amt });
  }
  for (const [pid, debt] of owe) {
    const paid = outSum.get(pid) || 0;
    if (paid !== debt) return json({ error: `${nameOf.get(pid)} should pay ${fmt(debt)} but plan adds up to ${fmt(paid)}` }, { status: 400 });
  }
  for (const [pid, credit] of owed) {
    const recv = inSum.get(pid) || 0;
    if (recv !== credit) return json({ error: `${nameOf.get(pid)} should receive ${fmt(credit)} but plan adds up to ${fmt(recv)}` }, { status: 400 });
  }

  const prev = new Map(g0.settlement.transfers.map((t: any) => [`${t.from}|${t.to}|${c(t.amount)}`, t]));
  const game = mutate(id, (g: any) => {
    g.settlement.transfers = clean.map((t: any) => {
      const old = prev.get(`${t.from}|${t.to}|${t.amount}`);
      return {
        id: uid(8), from: t.from, fromName: nameOf.get(t.from),
        to: t.to, toName: nameOf.get(t.to), amount: t.amount / 100,
        paid: old ? old.paid : false, paidAt: old ? old.paidAt : null, paidBy: old ? old.paidBy : null,
      };
    });
    const allPaid = g.settlement.transfers.every((t: any) => t.paid);
    g.status = allPaid ? 'settled' : 'ended';
    g.log.push(logEntry(actor, 'edit_settlement', { detail: { count: g.settlement.transfers.length } }));
  });
  return json(withProfiles(game));
}
