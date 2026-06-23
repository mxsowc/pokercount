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
 * Minimal-transaction settlement.
 *
 * The fewest payments that clear a balanced set of nets is
 *   (players with a non-zero net) − (max number of disjoint subsets that each
 *    sum to zero).
 * Every such zero-sum subset can settle on its own, so we first split the players
 * into the MOST independent zero-sum groups, then settle each group greedily
 * (a group with no internal zero-sum subset needs exactly groupSize−1 payments).
 * This is provably optimal — plain "largest owes → largest owed" greedy is not
 * (e.g. nets [+3,−3,−2,−4,+3,+2,+1] greedy = 6 payments, optimum = 4).
 *
 * Finding the max zero-sum partition is NP-hard (subset-sum), but home games are
 * tiny, so an exact bitmask search is instant up to the cap below; above it, or
 * when the books don't balance (a miscount), we fall back to plain greedy — still
 * ≤ n−1 payments, with the unsettled remainder surfaced via `discrepancy`.
 */
const OPTIMAL_CAP = 14; // ≤14 non-zero players → exact optimum; above → greedy

function minimizeTransfers(lines) {
  const bal = lines.filter((l) => l._netC !== 0).map((l) => ({ id: l.playerId, amt: l._netC }));
  const n = bal.length;
  if (n === 0) return [];

  const total = bal.reduce((s, b) => s + b.amt, 0);
  // Only the balanced, small-enough case can be split into zero-sum groups.
  const groups =
    total === 0 && n <= OPTIMAL_CAP ? maxZeroSumPartition(bal) : [bal.map((_, i) => i)];

  const transfers = [];
  for (const g of groups) settleGroupGreedy(g.map((i) => bal[i]), transfers);
  return transfers;
}

/** Largest-owes → largest-owed within one group. Exact, non-negative amounts. */
function settleGroupGreedy(members, out) {
  const creditors = members.filter((m) => m.amt > 0).map((m) => ({ id: m.id, amt: m.amt })).sort((a, b) => b.amt - a.amt);
  const debtors = members.filter((m) => m.amt < 0).map((m) => ({ id: m.id, amt: -m.amt })).sort((a, b) => b.amt - a.amt);
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amt, creditors[j].amt);
    if (pay > 0) out.push({ from: debtors[i].id, to: creditors[j].id, amount: pay });
    debtors[i].amt -= pay;
    creditors[j].amt -= pay;
    if (debtors[i].amt === 0) i++;
    if (creditors[j].amt === 0) j++;
  }
}

/**
 * Split a balanced set of nets into the maximum number of disjoint zero-sum
 * subsets, via memoised bitmask search. Returns groups as arrays of indices.
 */
function maxZeroSumPartition(bal) {
  const n = bal.length;
  const FULL = (1 << n) - 1;
  // Pre-sum every subset.
  const sum = new Array(1 << n).fill(0);
  for (let m = 1; m <= FULL; m++) {
    const low = m & -m;
    const idx = 31 - Math.clz32(low);
    sum[m] = sum[m ^ low] + bal[idx].amt;
  }
  // solve(mask) → { count, choice }: the zero-sum subset to peel off `mask`
  // (containing its lowest member) that maximises the total group count.
  const memo = new Map();
  function solve(mask) {
    if (mask === 0) return { count: 0, choice: 0 };
    const cached = memo.get(mask);
    if (cached) return cached;
    const low = mask & -mask;
    let best = { count: -Infinity, choice: 0 };
    for (let s = mask; s > 0; s = (s - 1) & mask) {
      if ((s & low) === 0 || sum[s] !== 0) continue;
      const rest = solve(mask ^ s).count + 1;
      if (rest > best.count) best = { count: rest, choice: s };
    }
    memo.set(mask, best);
    return best;
  }

  const groups = [];
  let mask = FULL;
  while (mask) {
    const { choice } = solve(mask);
    const g = [];
    for (let i = 0; i < n; i++) if (choice & (1 << i)) g.push(i);
    groups.push(g);
    mask ^= choice;
  }
  return groups;
}
