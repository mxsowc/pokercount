// 5-card hand scoring.
//
// High hands are scored into a comparable integer array:
//   [category, ...tiebreakers]   — larger compares as stronger.
// Categories:
//   8 straight flush, 7 quads, 6 full house, 5 flush,
//   4 straight, 3 trips, 2 two pair, 1 pair, 0 high card.
//
// Low hands (Ace-to-Five, 8-or-better) are scored as a comparable array of
// five ranks sorted descending with Ace = 1 — SMALLER compares as a better
// (stronger) low. Straights and flushes do not count against a low.

import { combinations } from './cards.js';

export const HIGH = {
  STRAIGHT_FLUSH: 8,
  QUADS: 7,
  FULL_HOUSE: 6,
  FLUSH: 5,
  STRAIGHT: 4,
  TRIPS: 3,
  TWO_PAIR: 2,
  PAIR: 1,
  HIGH_CARD: 0,
};

const HIGH_NAMES = {
  8: 'straight flush',
  7: 'four of a kind',
  6: 'full house',
  5: 'flush',
  4: 'straight',
  3: 'three of a kind',
  2: 'two pair',
  1: 'pair',
  0: 'high card',
};

const RANK_WORD = {
  14: 'ace', 13: 'king', 12: 'queen', 11: 'jack', 10: 'ten',
  9: 'nine', 8: 'eight', 7: 'seven', 6: 'six', 5: 'five',
  4: 'four', 3: 'three', 2: 'two', 1: 'ace',
};

/** Human-readable name for a high-hand score array, e.g. "flush, ace high". */
export function highHandName(score) {
  if (!score) return '';
  const cat = score[0];
  const base = HIGH_NAMES[cat];
  switch (cat) {
    case 8:
      return score[1] === 14 ? 'royal flush' : `straight flush, ${RANK_WORD[score[1]]} high`;
    case 7:
      return `four of a kind, ${RANK_WORD[score[1]]}s`;
    case 6:
      return `full house, ${RANK_WORD[score[1]]}s full of ${RANK_WORD[score[2]]}s`;
    case 5:
      return `flush, ${RANK_WORD[score[1]]} high`;
    case 4:
      return `straight, ${RANK_WORD[score[1]]} high`;
    case 3:
      return `three of a kind, ${RANK_WORD[score[1]]}s`;
    case 2:
      return `two pair, ${RANK_WORD[score[1]]}s and ${RANK_WORD[score[2]]}s`;
    case 1:
      return `pair of ${RANK_WORD[score[1]]}s`;
    default:
      return `${RANK_WORD[score[1]]} high`;
  }
}

/** Human-readable name for a low-hand score array, e.g. "8-5-3-2-A low". */
export function lowHandName(score) {
  if (!score) return '';
  const chars = { 1: 'A', 14: 'A' };
  return score.map((r) => chars[r] || String(r)).join('-') + ' low';
}

/** Lexicographic comparison of two numeric arrays. >0 if a is greater. */
export function cmp(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? -Infinity;
    const y = b[i] ?? -Infinity;
    if (x !== y) return x - y;
  }
  return 0;
}

/**
 * Detect a straight from a set of distinct high-ranks.
 * Returns the straight's high card (5 for the wheel A-2-3-4-5), or 0 if none.
 */
function straightHigh(distinctRanksDesc) {
  const ranks = new Set(distinctRanksDesc);
  // Ace plays low for the wheel.
  if (ranks.has(14)) ranks.add(1);
  const sorted = [...ranks].sort((a, b) => b - a);
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] - 1) {
      run++;
      if (run >= 5) return sorted[i] + 4;
    } else {
      run = 1;
    }
  }
  return 0;
}

/** Score exactly five cards as a high hand → comparable array. */
export function scoreHigh5(cards) {
  if (cards.length !== 5) throw new Error('scoreHigh5 needs exactly 5 cards');

  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);
  const isFlush = suits.every((s) => s === suits[0]);

  // Count rank frequencies.
  const counts = new Map();
  for (const r of ranks) counts.set(r, (counts.get(r) || 0) + 1);
  // Sort ranks by (frequency, rank) descending so tiebreakers fall out naturally.
  const byCountThenRank = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });
  const pattern = byCountThenRank.map((e) => e[1]); // e.g. [3,2] for a boat
  const orderedRanks = byCountThenRank.map((e) => e[0]);

  const distinctDesc = [...new Set(ranks)].sort((a, b) => b - a);
  const sHigh = straightHigh(distinctDesc);

  if (isFlush && sHigh) return [HIGH.STRAIGHT_FLUSH, sHigh];
  if (pattern[0] === 4) return [HIGH.QUADS, ...orderedRanks];
  if (pattern[0] === 3 && pattern[1] === 2) return [HIGH.FULL_HOUSE, ...orderedRanks];
  if (isFlush) return [HIGH.FLUSH, ...ranks];
  if (sHigh) return [HIGH.STRAIGHT, sHigh];
  if (pattern[0] === 3) return [HIGH.TRIPS, ...orderedRanks];
  if (pattern[0] === 2 && pattern[1] === 2) return [HIGH.TWO_PAIR, ...orderedRanks];
  if (pattern[0] === 2) return [HIGH.PAIR, ...orderedRanks];
  return [HIGH.HIGH_CARD, ...ranks];
}

/**
 * Score exactly five cards as an 8-or-better low → comparable array, or null
 * if the five cards do not qualify (need 5 distinct ranks, each Ace..8).
 * Smaller array = better low. The wheel A-2-3-4-5 scores [5,4,3,2,1] (nut low).
 */
export function scoreLow8_5(cards) {
  if (cards.length !== 5) throw new Error('scoreLow8_5 needs exactly 5 cards');
  const lowRanks = cards.map((c) => (c.rank === 14 ? 1 : c.rank));
  if (lowRanks.some((r) => r > 8)) return null; // any card above 8 disqualifies
  if (new Set(lowRanks).size !== 5) return null; // pairs disqualify a low
  return lowRanks.sort((a, b) => b - a);
}

/** Best high score over all 5-card subsets of `cards` (length >= 5). */
export function bestHighOf(cards) {
  let best = null;
  for (const combo of combinations(cards, 5)) {
    const s = scoreHigh5(combo);
    if (best === null || cmp(s, best) > 0) best = s;
  }
  return best;
}

/** Best (smallest) qualifying low over all 5-card subsets, or null. */
export function bestLowOf(cards) {
  let best = null;
  for (const combo of combinations(cards, 5)) {
    const s = scoreLow8_5(combo);
    if (s === null) continue;
    if (best === null || cmp(s, best) < 0) best = s;
  }
  return best;
}
