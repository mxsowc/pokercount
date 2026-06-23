// The pot-resolution engine.
//
// Every variant decomposes into the same nested structure:
//
//   for each POT LAYER (main + side pots):
//     split the layer across BOARDS        (double board → halves)
//     split each board's share across RUNS  (run-it-twice → per-run fractions)
//       run ONE showdown for that (board, run) segment among eligible players
//         high-only:  best high takes it (ties split)
//         hi-lo:      best high takes half, best qualifying low takes half
//                     (no qualifier → high scoops; tied low → quartering)
//
// Straddles, antes and blinds never appear here: they are just contributions
// that fed the pots, already accounted for in buildPots().

import { parseCards, assertNoDuplicates } from './cards.js';
import { cmp, highHandName, lowHandName } from './evaluate.js';
import { bestHigh, bestLow } from './select.js';
import { buildPots } from './sidepots.js';
import { divide } from './money.js';

/**
 * @param {object} input
 * @param {'holdem'|'omaha'} input.game
 * @param {boolean} [input.hiLo]  Split high / 8-or-better low.
 * @param {Array<{id:string, hole?:string|string[], contributed:number, folded?:boolean}>} input.players
 *        Array order is action order: index 0 acts first (first seat left of the
 *        button). This drives odd-chip assignment.
 * @param {Array} [input.boards]  Double board: 1 or 2 entries. Each entry is a
 *        runout, an array of runouts, or { runs: [runout, ...] }.
 * @param {string|string[]} [input.board]      Shorthand: single board, single run.
 * @param {Array} [input.runs]    Shorthand: single board, multiple runs (RIT).
 * @returns {{
 *   returned: {id:string, amount:number}|null,
 *   pots: Array<{amount:number, eligible:string[]}>,
 *   awards: Record<string, number>,
 *   total: number,
 *   breakdown: Array<object>,
 * }}
 */
export function resolve(input) {
  const game = input.game;
  if (game !== 'holdem' && game !== 'omaha') {
    throw new Error(`game must be 'holdem' or 'omaha', got ${game}`);
  }
  const hiLo = !!input.hiLo;

  const players = input.players.map((p, index) => ({
    id: p.id,
    index, // action order = odd-chip priority
    hole: parseCards(p.hole),
    contributed: p.contributed,
    folded: !!p.folded,
  }));
  const byId = new Map(players.map((p) => [p.id, p]));

  const boards = normalizeBoards(input); // [{ runs: [Card[]...] }, ...]
  const numBoards = boards.length;

  // Validate each runout against hole cards (no card used twice in one deal).
  for (const b of boards) {
    for (const runout of b.runs) {
      assertNoDuplicates(...players.map((p) => p.hole), runout);
    }
  }

  const { pots, returned } = buildPots(players);

  const awards = Object.fromEntries(players.map((p) => [p.id, 0]));
  if (returned) awards[returned.id] += returned.amount;

  const breakdown = [];

  pots.forEach((pot, potIndex) => {
    if (pot.eligible.length === 0) {
      // Orphan layer (see sidepots.js); return chips to contributors.
      const contributors = pot.orphanContributors || [];
      const shares = divide(pot.amount, Math.max(contributors.length, 1));
      contributors.forEach((id, i) => (awards[id] += shares[i]));
      return;
    }

    // Split this pot across boards (double board → equal halves).
    const boardShares = divide(pot.amount, numBoards);

    boards.forEach((board, boardIndex) => {
      const boardAmount = boardShares[boardIndex];
      // Split this board's share across runs (run-it-twice → fractions).
      const runShares = divide(boardAmount, board.runs.length);

      board.runs.forEach((runout, runIndex) => {
        const segmentAmount = runShares[runIndex];
        const eligible = pot.eligible.map((id) => byId.get(id));
        const result = showdown(segmentAmount, eligible, runout, game, hiLo);
        for (const [id, amt] of Object.entries(result.awards)) {
          awards[id] += amt;
        }
        breakdown.push({
          pot: potIndex,
          board: boardIndex,
          run: runIndex,
          amount: segmentAmount,
          shares: result.awards, // exact per-player cents won from this segment
          ...result.detail,
        });
      });
    });
  });

  const total = Object.values(awards).reduce((a, b) => a + b, 0);
  return {
    returned,
    pots: pots.map((p) => ({ amount: p.amount, eligible: p.eligible })),
    awards,
    total,
    breakdown,
  };
}

/** Resolve one (board, run) showdown for a single pot segment. */
function showdown(amount, eligible, runout, game, hiLo) {
  if (amount === 0) return { awards: {}, detail: { highWinners: [], lowWinners: [] } };

  // Walkover: only one eligible player → they take the segment, no cards needed.
  if (eligible.length === 1) {
    const id = eligible[0].id;
    return {
      awards: { [id]: amount },
      detail: { highWinners: [id], lowWinners: [], highHand: 'uncontested', walkover: true },
    };
  }

  // Players must have hole cards to contest a multiway showdown.
  for (const p of eligible) {
    if (p.hole.length === 0) {
      throw new Error(`Player ${p.id} reached showdown without hole cards`);
    }
  }

  // Best high among eligible players. A player who can't form a legal hand (too
  // few hole cards for the game) yields a null score — fail loudly rather than
  // let it reach cmp() as a cryptic null-deref.
  const highScores = eligible.map((p) => {
    const score = bestHigh(p.hole, runout, game);
    if (score === null) throw new Error(`Player ${p.id} cannot form a hand at showdown (too few cards)`);
    return { p, score };
  });
  const highWinners = topByCmp(highScores, (a, b) => cmp(a, b)); // ties included
  const highHand = highHandName(highWinners[0].score);

  if (!hiLo) {
    const awards = {};
    const shares = divide(amount, highWinners.length);
    highWinners
      .sort((a, b) => a.p.index - b.p.index)
      .forEach((w, i) => (awards[w.p.id] = (awards[w.p.id] || 0) + shares[i]));
    return {
      awards,
      detail: { highWinners: highWinners.map((w) => w.p.id), lowWinners: [], highHand },
    };
  }

  // Hi-Lo: best qualifying 8-or-better low among eligible players.
  const lowScores = eligible
    .map((p) => ({ p, score: bestLow(p.hole, runout, game) }))
    .filter((e) => e.score !== null);

  const awards = {};
  if (lowScores.length === 0) {
    // No qualifying low → high scoops the whole segment.
    const shares = divide(amount, highWinners.length);
    highWinners
      .sort((a, b) => a.p.index - b.p.index)
      .forEach((w, i) => (awards[w.p.id] = (awards[w.p.id] || 0) + shares[i]));
    return {
      awards,
      detail: { highWinners: highWinners.map((w) => w.p.id), lowWinners: [], highHand, scoop: true },
    };
  }

  // Split into halves; the odd chip goes to the high side (priority [high, low]).
  const [highHalf, lowHalf] = divide(amount, 2);

  const highShares = divide(highHalf, highWinners.length);
  highWinners
    .sort((a, b) => a.p.index - b.p.index)
    .forEach((w, i) => (awards[w.p.id] = (awards[w.p.id] || 0) + highShares[i]));

  const lowWinners = topByCmp(lowScores, (a, b) => -cmp(a, b)); // smaller low is better
  const lowShares = divide(lowHalf, lowWinners.length); // tied low → quartering
  lowWinners
    .sort((a, b) => a.p.index - b.p.index)
    .forEach((w, i) => (awards[w.p.id] = (awards[w.p.id] || 0) + lowShares[i]));

  return {
    awards,
    detail: {
      highWinners: highWinners.map((w) => w.p.id),
      lowWinners: lowWinners.map((w) => w.p.id),
      highHand,
      lowHand: lowHandName(lowWinners[0].score),
    },
  };
}

/**
 * Return all entries tied for the best score. `better(a, b) > 0` means a is
 * strictly better than b.
 */
function topByCmp(entries, better) {
  let best = null;
  for (const e of entries) {
    if (best === null || better(e.score, best.score) > 0) best = e;
  }
  return entries.filter((e) => better(e.score, best.score) === 0);
}

/** Normalize the many board/run input shorthands into [{ runs: Card[][] }]. */
function normalizeBoards(input) {
  const toRunout = (x) => parseCards(x);

  if (input.boards) {
    return input.boards.map((entry) => {
      if (entry && Array.isArray(entry.runs)) {
        return { runs: entry.runs.map(toRunout) };
      }
      // A bare runout (array of card strings or a space-separated string).
      return { runs: [toRunout(entry)] };
    });
  }
  if (input.runs) {
    return [{ runs: input.runs.map(toRunout) }];
  }
  const single = input.board ?? input.community ?? [];
  return [{ runs: [toRunout(single)] }];
}
