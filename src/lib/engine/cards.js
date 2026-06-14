// Card parsing and combinatorics.
//
// A card is written as a two-char string: rank + suit.
//   ranks: 2 3 4 5 6 7 8 9 T J Q K A   (case-insensitive)
//   suits: c d h s                      (case-insensitive)
// e.g. "As", "Td", "9c", "2h".

const RANK_TO_VALUE = {
  2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9,
  T: 10, J: 11, Q: 12, K: 13, A: 14,
};

const VALUE_TO_RANK = Object.fromEntries(
  Object.entries(RANK_TO_VALUE).map(([k, v]) => [v, k]),
);

const SUITS = new Set(['c', 'd', 'h', 's']);

/**
 * @typedef {{ rank: number, suit: string, str: string }} Card
 *   rank is the high value 2..14 (Ace = 14). For low games the ace is also
 *   read as 1 where appropriate (see evaluate.js).
 */

/** Parse a single card string into a Card. */
export function parseCard(str) {
  if (typeof str !== 'string' || str.length !== 2) {
    throw new Error(`Invalid card: ${JSON.stringify(str)}`);
  }
  const rankChar = str[0].toUpperCase();
  const suit = str[1].toLowerCase();
  const rank = RANK_TO_VALUE[rankChar];
  if (rank === undefined) throw new Error(`Invalid rank in card: ${str}`);
  if (!SUITS.has(suit)) throw new Error(`Invalid suit in card: ${str}`);
  return { rank, suit, str: rankChar + suit };
}

/** Parse an array (or space-separated string) of cards. */
export function parseCards(cards) {
  if (cards == null) return [];
  const list = typeof cards === 'string' ? cards.trim().split(/\s+/) : cards;
  return list.filter(Boolean).map(parseCard);
}

export function cardToString(card) {
  return VALUE_TO_RANK[card.rank] + card.suit;
}

/** Verify no duplicate cards exist across the supplied groups. Throws if so. */
export function assertNoDuplicates(...groups) {
  const seen = new Map();
  for (const group of groups) {
    for (const card of group) {
      const key = card.str;
      if (seen.has(key)) {
        throw new Error(`Duplicate card in deal: ${key}`);
      }
      seen.set(key, true);
    }
  }
}

/** All k-sized combinations of an array (order-independent). */
export function combinations(arr, k) {
  const result = [];
  const n = arr.length;
  if (k > n || k < 0) return result;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    result.push(idx.map((i) => arr[i]));
    let i = k - 1;
    while (i >= 0 && idx[i] === i + n - k) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
  return result;
}

export { RANK_TO_VALUE, VALUE_TO_RANK };
