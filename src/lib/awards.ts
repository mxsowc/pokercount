// End-of-night awards players vote each other for after a game. This array is the
// SINGLE SOURCE OF TRUTH — add/remove/reorder here and every surface follows: the
// voting card (game page), the badge pills (account + public profile), and the
// vote endpoint's validation. Votes are stored on the game as
// `game.votes[key][voterUserId] = votedPlayerId` (see Game.votes in types.ts).
//
// IMPORTANT: a `key` is permanent once shipped — renaming it orphans every past
// vote stored under the old key. Changing an `emoji`, `label`, or `q` is free.

export interface Award {
  key: string;
  emoji: string;
  label: string;
  /** The voting prompt shown on the end-of-night card. */
  q: string;
}

export const AWARDS: Award[] = [
  { key: 'hardestToRead',  emoji: '🎭', label: 'Best poker face',   q: 'Who was impossible to read?' },
  { key: 'mostTilted',     emoji: '🌋', label: 'Most frustrated',   q: 'Who was playing most on tilt?' },
  { key: 'biggestBluff',   emoji: '🃏', label: 'Biggest bluff',     q: 'Who faked the best hand?' },
  { key: 'biggestSuckout', emoji: '🍀', label: 'Luckiest winner',   q: 'Who got the luckiest win?' },
  { key: 'callingStation', emoji: '📞', label: 'Called everything',  q: 'Who never folded?' },
];

/** Valid award keys — for validating the vote endpoint's `category`. */
export const AWARD_KEYS = new Set(AWARDS.map((a) => a.key));
