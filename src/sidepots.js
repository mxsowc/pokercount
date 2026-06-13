// Build the main pot and side pots from each player's total contribution.
//
// Principles:
//   - A player can only win chips they matched. A short all-in caps how much
//     of each opponent's stack is contestable against them → side pots.
//   - A folded player's chips REMAIN in the pots they fed, but a folded player
//     is never ELIGIBLE to win any pot.
//   - The portion of the top bet that no one matched is uncalled and returns
//     to the bettor BEFORE any pots are built — it is never "won".

/**
 * @typedef {{ id: string, contributed: number, folded?: boolean }} Contributor
 * @typedef {{ amount: number, eligible: string[] }} Pot
 * @typedef {{ pots: Pot[], returned: { id: string, amount: number } | null }} PotStructure
 */

/**
 * @param {Contributor[]} players
 * @returns {PotStructure}
 */
export function buildPots(players) {
  for (const p of players) {
    if (!Number.isInteger(p.contributed) || p.contributed < 0) {
      throw new Error(`Bad contribution for ${p.id}: ${p.contributed}`);
    }
  }

  // Work on a copy of remaining (uncommitted-to-a-layer) contributions.
  const remaining = new Map(players.map((p) => [p.id, p.contributed]));
  const folded = new Map(players.map((p) => [p.id, !!p.folded]));

  // 1) Return the uncalled top bet. The largest contribution above the
  //    second-largest is unmatched — but only if exactly ONE player holds the
  //    maximum (a tie at the top means it was matched).
  let returned = null;
  const amounts = players.map((p) => p.contributed);
  const max = Math.max(...amounts, 0);
  const topPlayers = players.filter((p) => p.contributed === max);
  if (max > 0 && topPlayers.length === 1) {
    const second = players
      .filter((p) => p.id !== topPlayers[0].id)
      .reduce((m, p) => Math.max(m, p.contributed), 0);
    const excess = max - second;
    if (excess > 0) {
      returned = { id: topPlayers[0].id, amount: excess };
      remaining.set(topPlayers[0].id, second);
    }
  }

  // 2) Peel off pot layers from the smallest remaining stake upward.
  const pots = [];
  while (true) {
    const active = [...remaining.entries()].filter(([, v]) => v > 0);
    if (active.length === 0) break;
    const level = Math.min(...active.map(([, v]) => v));

    let amount = 0;
    const contributors = [];
    for (const [id] of active) {
      remaining.set(id, remaining.get(id) - level);
      amount += level;
      contributors.push(id);
    }
    const eligible = contributors.filter((id) => !folded.get(id));

    if (eligible.length === 0) {
      // Degenerate: every contributor to this layer folded. This cannot arise
      // from legal betting (the bettor who built the layer is eligible), but we
      // guard rather than silently vanish chips: represent it as a zero-eligible
      // pot carrying its contributors, which resolve() refunds pro rata. No bet
      // here was "uncalled", so `returned` is deliberately left untouched.
      pots.push({ amount, eligible: [], orphanContributors: contributors });
      continue;
    }

    // Merge consecutive layers that share the same eligible set (cosmetic;
    // keeps the pot list short without changing any award).
    const last = pots[pots.length - 1];
    if (last && sameSet(last.eligible, eligible)) {
      last.amount += amount;
    } else {
      pots.push({ amount, eligible });
    }
  }

  return { pots, returned };
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}
