import { json } from '@sveltejs/kit';
import { getGame, mutate, uid } from '$lib/server/store.js';
import { getActor, logEntry } from '$lib/server/helpers.js';
import { settleNets } from '$lib/engine/settle.js';

export async function PUT({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  const actor = getActor(request);
  const body = await request.json().catch(() => ({}));
  const paid = !!body.paid;
  if (!g0.settlement) return json({ error: 'The game has to be ended first' }, { status: 409 });
  // Don't silently 200 on a transfer that no longer exists (e.g. the plan was
  // re-routed and ids changed) — the client would think it succeeded.
  if (!g0.settlement.transfers.some((x: any) => x.id === params.tid)) {
    return json({ error: 'no such payment' }, { status: 404 });
  }

  // Two-sided confirmation: the receiver confirms they actually got the money.
  // Visual only — it never gates the "settled" status (which still just needs
  // every payment marked paid), so anonymous one-off tables can always close.
  if (body.confirmed !== undefined) {
    const confirmed = !!body.confirmed;
    const game = mutate(id, (g: any) => {
      const t = g.settlement.transfers.find((x: any) => x.id === params.tid);
      t.confirmed = confirmed;
      t.confirmedAt = confirmed ? new Date().toISOString() : null;
      t.confirmedBy = confirmed ? actor.name : null;
      if (confirmed && !t.paid) { t.paid = true; t.paidAt = new Date().toISOString(); t.paidBy = actor.name; }
      g.log.push(logEntry(actor, confirmed ? 'confirm_received' : 'unconfirm_received', { detail: { from: t.fromName, to: t.toName, amount: t.amount } }));
      const allPaid = g.settlement.transfers.every((x: any) => x.paid);
      g.status = (g.settlement.balanced && allPaid) ? 'settled' : 'ended';
    });
    return json(game);
  }

  // "Paid a different amount": an actual amount different from the suggested one.
  const hasAmount = paid && body.amount !== undefined && body.amount !== null && body.amount !== '';
  const customAmount = hasAmount ? Math.round(Number(body.amount) * 100) / 100 : null;
  if (hasAmount && !(Number.isFinite(customAmount) && customAmount! >= 0)) {
    return json({ error: 'Enter a valid amount' }, { status: 400 });
  }

  const game = mutate(id, (g: any) => {
    const t = g.settlement.transfers.find((x: any) => x.id === params.tid);

    if (customAmount !== null) {
      // Lock this payment in at the actual amount, then re-solve what's left.
      t.amount = customAmount;
      t.paid = true;
      t.paidAt = new Date().toISOString();
      t.paidBy = actor.name;

      // Residual = the frozen per-player nets, reduced by every recorded payment.
      // A payer's debt shrinks by what they paid; a receiver's credit shrinks by
      // what they got. Overpaying flips a receiver into being owed change.
      const residual = new Map<string, number>(g.settlement.lines.map((l: any) => [l.playerId, Math.round(l.net * 100)]));
      for (const x of g.settlement.transfers) {
        if (!x.paid) continue;
        const c = Math.round(x.amount * 100);
        residual.set(x.from, (residual.get(x.from) || 0) + c);
        residual.set(x.to, (residual.get(x.to) || 0) - c);
      }
      const nameOf = new Map(g.players.map((p: any) => [p.id, p.name]));
      const fresh = settleNets([...residual].map(([pid, c]) => ({ id: pid, net: c / 100 })));
      // Keep the recorded (paid) payments; replace the rest with the new plan.
      g.settlement.transfers = [
        ...g.settlement.transfers.filter((x: any) => x.paid),
        ...fresh.map((f: any) => ({
          id: uid(8), from: f.from, fromName: nameOf.get(f.from),
          to: f.to, toName: nameOf.get(f.to), amount: f.amount,
          paid: false, paidAt: null, paidBy: null,
        })),
      ];
      g.log.push(logEntry(actor, 'pay_actual', { detail: { from: t.fromName, to: t.toName, amount: customAmount } }));
    } else {
      t.paid = paid;
      t.paidAt = paid ? new Date().toISOString() : null;
      t.paidBy = paid ? actor.name : null;
      if (!paid) { t.confirmed = false; t.confirmedAt = null; t.confirmedBy = null; } // un-marking paid drops any confirmation
      g.log.push(logEntry(actor, paid ? 'mark_paid' : 'mark_unpaid', {
        detail: { from: t.fromName, to: t.toName, amount: t.amount },
      }));
    }

    const allPaid = g.settlement.transfers.every((x: any) => x.paid);
    g.status = (g.settlement.balanced && allPaid) ? 'settled' : 'ended';
  });
  return json(game);
}
