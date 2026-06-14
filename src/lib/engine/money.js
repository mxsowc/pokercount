// Integer-chip division. Poker is played in whole chips, so every split must
// account for the remainder ("odd chips"). We never produce fractional chips.

/**
 * Divide an integer `amount` among `n` recipients given in PRIORITY ORDER.
 * Each recipient gets floor(amount / n); the remainder is handed out one chip
 * at a time to the earliest recipients in priority order.
 *
 * Returns an array of integer amounts aligned with the priority order.
 *
 * The caller decides priority:
 *   - splitting a pot among tied winners → seat order (first to act first),
 *     which is the standard "odd chip goes left of the button" rule;
 *   - splitting a pot across run-it-twice runs or double boards → run/board
 *     order.
 */
export function divide(amount, n) {
  if (n <= 0) throw new Error('divide needs at least one recipient');
  if (!Number.isInteger(amount)) throw new Error('amount must be an integer');
  const base = Math.floor(amount / n);
  let remainder = amount - base * n;
  const shares = new Array(n).fill(base);
  for (let i = 0; remainder > 0; i++, remainder--) shares[i] += 1;
  return shares;
}
