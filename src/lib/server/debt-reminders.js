// 24-hour debt reminders. When a game has ENDED and a settlement transfer is
// still unpaid a full day later, nudge BOTH accounts involved: the debtor ("you
// still owe …", offering an "already paid?" action) and the creditor ("you're
// still owed …", offering "already received?"). A forgotten debt shouldn't just
// sit there silently.
//
// Reminders repeat at most weekly per transfer (deduped via notification
// history) and only reach seats linked to an account — there's nobody to ping
// on an anonymous seat. The confirmations these nudges drive feed each player's
// settlement-speed stat (a payment counts once the receiver confirms it).

import { allGames } from './store.js';
import { notify, hasRecentDebtNotif } from './notifications.js';

const DUE_MS = 24 * 60 * 60 * 1000; // start reminding a day after the game ended

/** A compact money label for the fallback text (the UI re-formats from amount +
 *  unit). Symbols hug the number; word units like "chips"/"BB" sit after it.
 *  @param {number} amount @param {string} unit @returns {string} */
function money(amount, unit) {
  const u = unit || '€';
  const n = Number(amount);
  const s = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return /^[€$£¥₿]/.test(u) ? `${u}${s}` : `${s} ${u}`;
}

/** Scan ended games for still-unpaid settlement transfers older than 24h and
 *  notify both linked parties (once, then at most weekly).
 *  @returns {number} notifications sent */
export function remindUnsettledDebts() {
  const now = Date.now();
  let sent = 0;
  for (const g of allGames()) {
    // 'settled' means every transfer is already paid, so only 'ended' games can
    // still owe anything.
    if (g.status !== 'ended' || !g.settlement?.transfers?.length) continue;
    const endedMs = new Date(g.settlement.computedAt || g.updatedAt).getTime();
    if (!Number.isFinite(endedMs) || now - endedMs < DUE_MS) continue; // not due yet
    const byId = new Map((g.players || []).map((p) => [p.id, p]));
    for (const t of g.settlement.transfers) {
      if (t.paid) continue; // this leg is handled
      const debtor = byId.get(t.from);
      const creditor = byId.get(t.to);
      const amt = money(t.amount, g.unit);
      // Debtor — "you still owe …"
      if (debtor?.userId && !hasRecentDebtNotif(debtor.userId, t.id, 'debt_owe')) {
        notify(debtor.userId, {
          type: 'debt_owe', actorName: creditor?.name || t.toName,
          gameId: g.id, gameCode: g.code, transferId: t.id, amount: t.amount, unit: g.unit,
          text: `You still owe ${amt} to ${creditor?.name || t.toName}`,
        });
        sent++;
      }
      // Creditor — "you're still owed …" (skip if they were already asked to
      // confirm this transfer, whether by a prior reminder or a debtor's claim).
      if (creditor?.userId && !hasRecentDebtNotif(creditor.userId, t.id, ['debt_owed', 'debt_confirm'])) {
        notify(creditor.userId, {
          type: 'debt_owed', actorName: debtor?.name || t.fromName,
          gameId: g.id, gameCode: g.code, transferId: t.id, amount: t.amount, unit: g.unit,
          text: `You're still owed ${amt} from ${debtor?.name || t.fromName}`,
        });
        sent++;
      }
    }
  }
  if (sent > 0) console.log(`[debt] sent ${sent} settlement reminder(s)`);
  return sent;
}
