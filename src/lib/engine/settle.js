// Home-game settlement: turn buy-ins / top-ups / final stacks into a minimal
// list of payments ("A pays B $30"). Pure and dependency-free so the same code
// runs on the server and in the browser.
//
// All money is handled in integer minor units (cents) internally to avoid
// floating-point drift, then converted back to major units in the output.

// Non-numeric input (e.g. a bad finalStack like "xyz") would yield NaN and
// silently poison the discrepancy/balanced flags, so coerce it to 0 cents.
const toCents = (x) => { const c = Math.round(Number(x) * 100); return Number.isFinite(c) ? c : 0; };
const toMajor = (c) => c / 100;

/**
 * @param {Array<{id:string,name:string}>} players
 * @param {Array<{playerId:string,amount:number}>} transactions  buy-ins + top-ups
 * @param {Record<string, number|null|undefined>} finalStacks  cash-out per player
 * @returns {{
 *   lines: Array<{playerId,name,invested,finalStack,net}>,
 *   transfers: Array<{from:string,fromName:string,to:string,toName:string,amount:number}>,
 *   totalInvested: number,
 *   totalFinal: number,
 *   discrepancy: number,   // totalFinal - totalInvested; should be 0
 *   balanced: boolean,
 * }}
 */
export function computeSettlement(players, transactions, finalStacks = {}) {
  const investedCents = new Map(players.map((p) => [p.id, 0]));
  for (const tx of transactions) {
    if (!investedCents.has(tx.playerId)) continue;
    investedCents.set(tx.playerId, investedCents.get(tx.playerId) + toCents(tx.amount));
  }

  const lines = players.map((p) => {
    const invested = investedCents.get(p.id) || 0;
    const raw = finalStacks[p.id];
    const hasFinal = raw !== null && raw !== undefined && raw !== '';
    const finalStack = hasFinal ? toCents(raw) : 0;
    return {
      playerId: p.id,
      name: p.name,
      invested: toMajor(invested),
      finalStack: hasFinal ? toMajor(finalStack) : null,
      net: toMajor(finalStack - invested),
      _investedC: invested,
      _finalC: finalStack,
      _netC: finalStack - invested,
    };
  });

  const totalInvestedC = lines.reduce((s, l) => s + l._investedC, 0);
  const totalFinalC = lines.reduce((s, l) => s + l._finalC, 0);
  const discrepancyC = totalFinalC - totalInvestedC;

  const transfers = minimizeTransfers(lines).map((t) => ({
    from: t.from,
    fromName: byId(players, t.from),
    to: t.to,
    toName: byId(players, t.to),
    amount: toMajor(t.amount),
  }));

  return {
    lines: lines.map(({ _investedC, _finalC, _netC, ...l }) => l),
    transfers,
    totalInvested: toMajor(totalInvestedC),
    totalFinal: toMajor(totalFinalC),
    discrepancy: toMajor(discrepancyC),
    balanced: discrepancyC === 0,
  };
}

function byId(players, id) {
  const p = players.find((x) => x.id === id);
  return p ? p.name : id;
}

/**
 * Greedy minimal-transaction settlement. Repeatedly match the player who is owed
 * the most with the player who owes the most. Produces at most (n-1) transfers.
 * If books don't balance (a miscount), the residual simply isn't fully settled —
 * the caller surfaces `discrepancy` so players can recount.
 */
function minimizeTransfers(lines) {
  // Work in cents; copy net balances we can mutate.
  const creditors = lines
    .filter((l) => l._netC > 0)
    .map((l) => ({ id: l.playerId, amt: l._netC }))
    .sort((a, b) => b.amt - a.amt);
  const debtors = lines
    .filter((l) => l._netC < 0)
    .map((l) => ({ id: l.playerId, amt: -l._netC }))
    .sort((a, b) => b.amt - a.amt);

  const transfers = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amt, creditors[j].amt);
    if (pay > 0) {
      transfers.push({ from: debtors[i].id, to: creditors[j].id, amount: pay });
    }
    debtors[i].amt -= pay;
    creditors[j].amt -= pay;
    if (debtors[i].amt === 0) i++;
    if (creditors[j].amt === 0) j++;
  }
  return transfers;
}
