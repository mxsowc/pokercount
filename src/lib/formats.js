// Poker variants offered for public/open games. Shared by the create form (the
// dropdown), the store (default + validation), and the listing editor. NLH is the
// default — the standard game — so an unset/unknown value falls back to it.

/** @type {string[]} */
export const FORMATS = ['NLH', 'NLH Tournament', 'PLO', 'PLO5', 'PLO6', 'LHE', 'Mixed', 'Other'];

const BY_UPPER = /** @type {Record<string,string>} */ (
  Object.fromEntries(FORMATS.map((f) => [f.toUpperCase(), f]))
);

/** Normalize free input to a known format label; unknown/empty → 'NLH'.
 *  @param {unknown} f @returns {string} */
export function normFormat(f) {
  return BY_UPPER[String(f || '').trim().toUpperCase()] || 'NLH';
}

/** Does this format denote a tournament (vs a cash game)? Used to auto-set an open
 *  game's mode from its chosen format. @param {unknown} f @returns {boolean} */
export function isTournamentFormat(f) {
  return /tournament/i.test(String(f || ''));
}
