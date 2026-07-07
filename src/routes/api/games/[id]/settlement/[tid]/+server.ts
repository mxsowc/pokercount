import { json } from '@sveltejs/kit';
import { getGame, mutate, uid } from '$lib/server/store.js';
import { sessionUser, getActor, logEntry, httpError, withProfiles, isMoney } from '$lib/server/helpers.js';
import { notify, hasRecentDebtNotif } from '$lib/server/notifications.js';
import { settleNets } from '$lib/engine/settle.js';

function moneyLabel(amount: number, unit: string): string {
  const u = unit || '€';
  const s = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return /^[€$£¥₿]/.test(u) ? `${u}${s}` : `${s} ${u}`;
}

export async function PUT({ request, params }) {
  const id = params.id.toUpperCase();
  const g0 = getGame(id);
  if (!g0) return json({ error: 'game not found' }, { status: 404 });
  const su = sessionUser(request);
  const actor = su ? { id: 'user:' + su.id, name: su.displayName } : getActor(request);
  const body = await request.json().catch(() => ({}));
  const paid = !!body.paid;
  if (!g0.settlement) return json({ error: 'The game has to be ended first' }, { status: 409 });
  if (!g0.settlement.transfers.some((x: any) => x.id === params.tid)) {
    return json({ error: 'no such payment' }, { status: 404 });
  }

  if (body.confirmed !== undefined) {
    const confirmed = !!body.confirmed;
    let game: any;
    try {
      game = mutate(id, (g: any) => {
        if (!g.settlement) throw httpError(409, 'The game has to be ended first');
        const t = g.settlement.transfers.find((x: any) => x.id === params.tid);
        if (!t) throw httpError(404, 'no such payment');
        if (confirmed) {
          // Only the receiver may confirm an account-linked payee's receipt —
          // enforced even for anonymous callers, so dropping the session cookie
          // can't be used to self-confirm a debt and game the payment-speed stat.
          // (A payee with no account has nobody to confirm → one-sided is allowed.)
          const payee = g.players.find((p: any) => p.id === t.to);
          if (payee?.userId && (!su || payee.userId !== su.id)) throw httpError(403, 'Only the receiver can confirm a payment.');
        }
        t.confirmed = confirmed;
        t.confirmedAt = confirmed ? new Date().toISOString() : null;
        t.confirmedBy = confirmed ? actor.name : null;
        if (confirmed && !t.paid) { t.paid = true; t.paidAt = new Date().toISOString(); t.paidBy = actor.name; }
        g.log.push(logEntry(actor, confirmed ? 'confirm_received' : 'unconfirm_received', { detail: { from: t.fromName, to: t.toName, amount: t.amount } }));
        const allPaid = g.settlement.transfers.every((x: any) => x.paid);
        g.status = allPaid ? 'settled' : 'ended';
      });
    } catch (e: any) {
      return json({ error: e.message || 'failed' }, { status: e.status || 400 });
    }
    if (confirmed) {
      const t = game.settlement.transfers.find((x: any) => x.id === params.tid);
      const payer = game.players.find((p: any) => p.id === t?.from);
      if (t && payer?.userId) {
        notify(payer.userId, {
          type: 'debt_confirmed', actorId: actor.id, actorName: t.toName,
          gameId: game.id, gameCode: game.code, transferId: t.id, amount: t.amount, unit: game.unit,
          text: `${t.toName} confirmed receiving your ${moneyLabel(t.amount, game.unit)}`,
        });
      }
    }
    return json(withProfiles(game));
  }

  const hasAmount = paid && body.amount !== undefined && body.amount !== null && body.amount !== '';
  const customAmount = hasAmount ? Math.round(Number(body.amount) * 100) / 100 : null;
  if (hasAmount && (!isMoney(customAmount) || customAmount! < 0)) {
    return json({ error: 'Enter a valid amount' }, { status: 400 });
  }

  let game: any;
  try {
    game = mutate(id, (g: any) => {
      if (!g.settlement) throw httpError(409, 'The game has to be ended first');
      const t = g.settlement.transfers.find((x: any) => x.id === params.tid);
      if (!t) throw httpError(404, 'no such payment');

      if (customAmount !== null) {
        t.amount = customAmount;
        t.paid = true;
        t.paidAt = new Date().toISOString();
        t.paidBy = actor.name;

        const residual = new Map<string, number>(g.settlement.lines.map((l: any) => [l.playerId, Math.round(l.net * 100)]));
        for (const x of g.settlement.transfers) {
          if (!x.paid) continue;
          const c = Math.round(x.amount * 100);
          residual.set(x.from, (residual.get(x.from) || 0) + c);
          residual.set(x.to, (residual.get(x.to) || 0) - c);
        }
        const nameOf = new Map(g.players.map((p: any) => [p.id, p.name]));
        const fresh = settleNets([...residual].map(([pid, c]) => ({ id: pid, net: c / 100 })));
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
        if (!paid) { t.confirmed = false; t.confirmedAt = null; t.confirmedBy = null; }
        g.log.push(logEntry(actor, paid ? 'mark_paid' : 'mark_unpaid', {
          detail: { from: t.fromName, to: t.toName, amount: t.amount },
        }));
      }

      if (t.paid && t.confirmed !== true) {
        const payee = g.players.find((p: any) => p.id === t.to);
        if (!payee?.userId) {
          t.confirmed = true;
          t.confirmedAt = new Date().toISOString();
          t.confirmedBy = actor.name;
        }
      }

      const allPaid = g.settlement.transfers.every((x: any) => x.paid);
      g.status = allPaid ? 'settled' : 'ended';
    });
  } catch (e: any) {
    return json({ error: e.message || 'failed' }, { status: e.status || 400 });
  }

  const t = game.settlement.transfers.find((x: any) => x.id === params.tid);
  if (t?.paid && !t.confirmed) {
    const payee = game.players.find((p: any) => p.id === t.to);
    const payer = game.players.find((p: any) => p.id === t.from);
    if (payee?.userId && !hasRecentDebtNotif(payee.userId, t.id, 'debt_confirm')) {
      notify(payee.userId, {
        type: 'debt_confirm', actorId: actor.id, actorName: t.fromName,
        gameId: game.id, gameCode: game.code, transferId: t.id, amount: t.amount, unit: game.unit,
        text: `${payer?.name || t.fromName} says they paid you ${moneyLabel(t.amount, game.unit)} — did you get it?`,
      });
    }
  }
  return json(withProfiles(game));
}
