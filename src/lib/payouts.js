// Tournament payout structures. Home-game standard: winner-take-all for tiny
// fields, paying roughly the top third (top-heavy) as the field grows. These are
// PROPOSED DEFAULTS — the host can edit the split per game. Percentages sum to 100.

/** Proposed payout % per place (index 0 = 1st) for an n-player field.
 *  @param {number} n @returns {number[]} */
export function proposePayouts(n) {
  const c = Math.max(1, Math.floor(n || 0));
  if (c <= 3) return [100];
  if (c <= 6) return [65, 35];
  if (c <= 9) return [50, 30, 20];
  if (c <= 15) return [40, 25, 20, 15];
  return [35, 22, 15, 12, 9, 7];
}

/** Split a prize pool (in integer cents) across places by percentage, rounding to
 *  whole cents and giving any rounding remainder to 1st, so the payouts sum EXACTLY
 *  to the pool (zero-sum settlement depends on this). Percentages need not total
 *  100 — they're applied proportionally, so the pool is always fully distributed.
 *  @param {number} poolCents @param {number[]} pcts @returns {number[]} cents per place */
export function payoutCents(poolCents, pcts) {
  const pool = Math.max(0, Math.round(poolCents));
  const list = (pcts || []).map((p) => Math.max(0, Number(p) || 0));
  const total = list.reduce((s, p) => s + p, 0);
  if (!total) return list.map(() => 0);
  const out = list.map((p) => Math.floor((pool * p) / total));
  const remainder = pool - out.reduce((s, v) => s + v, 0);
  if (out.length) out[0] += remainder; // odd cents to the winner
  return out;
}

/** Validate an edited split for the UI: coerce to numbers ≥ 0 and report the sum.
 *  @param {number[]} pcts @returns {{ list: number[], sum: number, valid: boolean }} */
export function normalizePayouts(pcts) {
  const list = (pcts || []).map((p) => Math.max(0, Number(p) || 0));
  const sum = Math.round(list.reduce((s, p) => s + p, 0) * 100) / 100;
  return { list, sum, valid: Math.abs(sum - 100) < 0.01 && list.some((p) => p > 0) };
}
