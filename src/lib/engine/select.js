// Apply game rules to choose a player's best high and best low hand from
// their hole cards plus the community board.
//
//   holdem: use any 5 of (hole ∪ community).
//   omaha : use EXACTLY 2 hole cards + EXACTLY 3 community cards.
//
// Omaha's "exactly two" rule is the crucial difference: you cannot play the
// board, and you may use a different pair of hole cards for the high and the
// low. These functions enforce that.

import { combinations } from './cards.js';
import { scoreHigh5, scoreLow8_5, cmp } from './evaluate.js';

/** Enumerate every legal 5-card hand for the game type. */
function legalHands(hole, community, game) {
  if (game === 'holdem') {
    const pool = [...hole, ...community];
    if (pool.length < 5) return [];
    return combinations(pool, 5);
  }
  if (game === 'omaha') {
    if (hole.length < 2 || community.length < 3) return [];
    const hands = [];
    for (const h of combinations(hole, 2)) {
      for (const c of combinations(community, 3)) {
        hands.push([...h, ...c]);
      }
    }
    return hands;
  }
  throw new Error(`Unknown game type: ${game}`);
}

/** Best high score for a player, or null if no legal hand. */
export function bestHigh(hole, community, game) {
  let best = null;
  for (const hand of legalHands(hole, community, game)) {
    const s = scoreHigh5(hand);
    if (best === null || cmp(s, best) > 0) best = s;
  }
  return best;
}

/** Best (smallest) qualifying 8-or-better low for a player, or null. */
export function bestLow(hole, community, game) {
  let best = null;
  for (const hand of legalHands(hole, community, game)) {
    const s = scoreLow8_5(hand);
    if (s === null) continue;
    if (best === null || cmp(s, best) < 0) best = s;
  }
  return best;
}
