// Exact equity by exhaustive enumeration, at any street.
//
// Given a known board (3 = flop, 4 = turn, 5 = river) plus each player's hole
// cards, we deal out EVERY possible combination of the remaining board cards,
// score each, and average. Because we enumerate all C(remaining, k) runouts the
// result is exact, not a Monte-Carlo estimate.
//
//   high-only:  "equity" = chance to win the pot (ties split).
//   hi-lo (8):  "equity" = expected SHARE of the pot, because the pot splits
//               high/low. We also report scoop / win-high / win-low rates.
//
// Hand strength uses the same evaluator the pot engine does (Hold'em best-5-of-7,
// Omaha exactly 2+3; low = 8-or-better), which is already test-covered.

import { parseCard, parseCards, combinations, assertNoDuplicates } from './cards.js';
import { bestHigh, bestLow } from './select.js';
import { cmp } from './evaluate.js';

const RANKS = '23456789TJQKA';
const SUITS = 'cdhs';
function fullDeck() {
  const d = [];
  for (const r of RANKS) for (const s of SUITS) d.push(r + s);
  return d;
}

// Pot share for ONE complete 5-card board. Returns share[] summing to 1, plus
// who won high / low this runout.
function shareForBoard(game, holes, board, hiLo) {
  const n = holes.length;
  const share = new Array(n).fill(0);

  let best = null, highWinners = [];
  for (let i = 0; i < n; i++) {
    const s = bestHigh(holes[i], board, game);
    const c = best === null ? 1 : cmp(s, best);
    if (c > 0) { best = s; highWinners = [i]; }
    else if (c === 0) highWinners.push(i);
  }

  if (!hiLo) {
    const sh = 1 / highWinners.length;
    for (const i of highWinners) share[i] += sh;
    return { share, highWinners, lowWinners: [] };
  }

  // 8-or-better low: smallest qualifying low wins; ties quarter the low half.
  let lowBest = null, lowWinners = [];
  for (let i = 0; i < n; i++) {
    const s = bestLow(holes[i], board, game);
    if (s === null) continue;
    if (lowBest === null || cmp(s, lowBest) < 0) { lowBest = s; lowWinners = [i]; }
    else if (cmp(s, lowBest) === 0) lowWinners.push(i);
  }

  if (lowWinners.length === 0) {
    // No qualifying low → high scoops the whole pot.
    const sh = 1 / highWinners.length;
    for (const i of highWinners) share[i] += sh;
    return { share, highWinners, lowWinners: [] };
  }

  const hsh = 0.5 / highWinners.length;
  for (const i of highWinners) share[i] += hsh;
  const lsh = 0.5 / lowWinners.length;
  for (const i of lowWinners) share[i] += lsh;
  return { share, highWinners, lowWinners };
}

/**
 * @param {object} o
 * @param {'holdem'|'omaha'} o.game
 * @param {Array<{id:string, hole:string|string[]}>} o.players  (>= 2)
 * @param {string|string[]} o.board  3, 4 or 5 known board cards
 * @param {boolean} [o.hiLo]
 * @returns {{ runouts:number, street:string, cardsToCome:number,
 *            equity:Array<{id, equity, scoop, winHigh, winLow}> }}
 */
export function equityAt({ game, players, board, hiLo = false, dead = [] }) {
  const known = parseCards(board);
  if (known.length < 3 || known.length > 5) throw new Error('board must be 3–5 cards');
  if (!players || players.length < 2) throw new Error('need at least two players');
  const holes = players.map((p) => parseCards(p.hole));

  // No card may appear twice across the board and every hole — otherwise we'd
  // enumerate impossible runouts and return fabricated equity. (resolve() guards
  // its deals the same way.)
  assertNoDuplicates(known, ...holes);

  // `dead` = cards dealt elsewhere (e.g. a sibling board in a double-board hand)
  // that are out of the deck but not part of THIS board. Removing them keeps the
  // runout enumeration honest — without it each board is computed against a fresh
  // deck and the two boards' equities overlap and are individually wrong.
  const used = new Set([...known, ...holes.flat(), ...parseCards(dead)].map((c) => c.str));
  const deck = fullDeck().filter((s) => !used.has(s)).map(parseCard);
  const toCome = 5 - known.length;
  const runs = toCome === 0 ? [[]] : combinations(deck, toCome);

  const n = players.length;
  const potShare = new Array(n).fill(0);
  const scoop = new Array(n).fill(0);
  const winHigh = new Array(n).fill(0);
  const winLow = new Array(n).fill(0);

  for (const extra of runs) {
    const r = shareForBoard(game, holes, known.concat(extra), hiLo);
    for (let i = 0; i < n; i++) {
      potShare[i] += r.share[i];
      if (r.share[i] >= 1 - 1e-12) scoop[i] += 1; // took the whole pot this runout
    }
    for (const i of r.highWinners) winHigh[i] += 1;
    for (const i of r.lowWinners) winLow[i] += 1;
  }

  const total = runs.length || 1;
  return {
    runouts: runs.length,
    street: known.length === 3 ? 'flop' : known.length === 4 ? 'turn' : 'river',
    cardsToCome: toCome,
    equity: players.map((p, i) => ({
      id: p.id,
      equity: potShare[i] / total,
      scoop: scoop[i] / total,
      winHigh: winHigh[i] / total,
      winLow: winLow[i] / total,
    })),
  };
}

// Back-compat: high-only flop equity (used by older callers/tests).
export function flopEquity({ game, players, flop }) {
  const flop3 = parseCards(flop).slice(0, 3).map((c) => c.str);
  const r = equityAt({ game, players, board: flop3, hiLo: false });
  return { runouts: r.runouts, equity: r.equity.map((e) => ({ id: e.id, equity: e.equity })) };
}
