// Shared domain types for potcount. Referenced from the server `.js` modules via
// JSDoc (`@typedef {import('../types').Game} Game`) so the untyped data/auth/money
// layer is type-checked without converting every file to TypeScript.

export type GameStatus = 'active' | 'ended' | 'settled';
export type TxType = 'buyin' | 'topup';

export interface Player {
  id: string;
  name: string;
  /** Account id, if this seat is linked to a signed-in user. */
  userId?: string;
}

export interface Transaction {
  id: string;
  playerId: string;
  amount: number;
  type: TxType;
  at: string;
  /** Display name of whoever created or last edited this entry. */
  by?: string;
}

export interface Transfer {
  id: string;
  from: string;
  to: string;
  fromName: string;
  toName: string;
  amount: number;
  paid: boolean;
  paidAt: string | null;
  paidBy: string | null;
  /** Two-sided confirmation: `paid` is the payer's claim; `confirmed` is the
   *  receiver confirming they actually got it. Visual only — never gates settling. */
  confirmed?: boolean;
  confirmedAt?: string | null;
  confirmedBy?: string | null;
}

export interface SettlementLine {
  playerId: string;
  name: string;
  invested: number;
  finalStack: number | null;
  net: number;
}

export interface Settlement {
  computedAt: string;
  lines: SettlementLine[];
  transfers: Transfer[];
  totalInvested: number;
  totalFinal: number;
  discrepancy: number;
  balanced: boolean;
}

export interface LogEntry {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  action: string;
  playerId?: string;
  playerName?: string | null;
  detail?: Record<string, unknown>;
}

export interface Game {
  /** Immutable internal id (the map key + filename + what shared links use). Never shown. */
  id: string;
  /** Human-facing 4–6 digit code, reusable once the game closes. Shown to players. */
  code: string;
  name: string;
  unit: string;
  /** The table's standard buy-in, captured at creation; seeds the quick-buy / bulk amount. */
  defaultBuyIn?: number;
  status: GameStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
  players: Player[];
  transactions: Transaction[];
  finalStacks: Record<string, number>;
  /** Optional hours each seat reports playing — powers that player's €/hr stat.
   *  Set per-account by the seat's owner; absent = they didn't enter it (the
   *  game is then simply not counted toward their hourly rate). Keyed by playerId. */
  hours?: Record<string, number>;
  log: LogEntry[];
  /** Device/actor id that opened the game (host). */
  hostId?: string;
  /** Account id of the owner, if created while signed in. */
  ownerId?: string;
  /** True for games created after host tokens existed (host proven by signed token). */
  tokenedHost?: boolean;
  /** Host locked the table: nobody new can self-join by code; the host adds players. */
  locked?: boolean;
  settlement?: Settlement;
  /** Prior settlements, archived (not destroyed) each time the game is reopened —
   *  so a locked-in result can't be quietly rewritten after it's been shared. */
  receipts?: Array<Settlement & { archivedAt: string }>;
  /** Optional series tag for recurring game groups. */
  series?: string | null;
  /** First-party, cookieless acquisition: where the creator first arrived from
   *  (campaign tag / external referrer host / first landing path). Set once at
   *  creation; absent on games created before source-tracking shipped. */
  acquisition?: { ref: string | null; referrer: string | null; landing: string | null };
  /** Post-game peer-voted awards. Outer key = award key (see $lib/awards), inner
   *  map = voterUserId → votedPlayerId. e.g. votes.hardestToRead[voter] = player. */
  votes?: Record<string, Record<string, string>>;
  /** Optional "nit game" side game: while `on`, every seated player holds a
   *  button until they win a pot (their id goes in `cleared`). When exactly one
   *  holder remains, that player has lost the nit game. No money attached. */
  nitGame?: { on: boolean; cleared: string[] };
}

/** Payload accepted by createGame. */
export interface NewGameInput {
  name?: string;
  unit?: string;
  players?: { name?: string }[];
  code?: string;
  defaultBuyIn?: number;
  series?: string | null;
}

export interface User {
  id: string;
  handle: string;
  displayName: string;
  avatar: string | null;
  /** True once the user uploads a custom photo, so OAuth sign-in won't overwrite it. */
  avatarCustom?: boolean;
  /** Last photo from the OAuth provider, kept so "use my Google photo" can restore it. */
  oauthAvatar?: string | null;
  /** Who can see this profile/stats: 'public' | 'members' | 'private'. Defaults 'public'. */
  privacy?: string;
  /** Home city (free text) — powers the by-city leaderboard and finding local players. */
  city?: string | null;
  /** How the account was originally created: 'local' (handle + PIN) | 'google' | 'apple'. */
  provider: string;
  providerSub: string | null;
  /** OAuth identities linked AFTER signup, in addition to the primary one above.
   *  Lets a PIN user add Google/Apple (and vice-versa) as extra ways to sign in.
   *  Each is also indexed so signing in with it resolves to this same account. */
  linkedProviders?: Array<{ provider: string; sub: string; linkedAt: string }>;
  pinHash: string | null;
  needsHandle?: boolean;
  /** Stored privately (never in PublicUser); used for account contact + opt-in newsletter. */
  email?: string | null;
  /** Subscribed to the monthly summary email. Auto-enrolled on account creation
   *  when an email is present; one-click unsubscribe sets it false. */
  newsletter?: boolean;
  /** When the last monthly summary email was sent (rolling 30-day cadence). */
  lastSummaryEmailAt?: string | null;
  // Optional onboarding answers (private — never in PublicUser).
  ageRange?: string | null;
  country?: string | null;
  heardFrom?: string | null;
  /** Set once the user completes or skips onboarding, so it isn't shown again. */
  onboardedAt?: string | null;
  /** Last time we saw this user signed in (throttled), for the active-users metric. */
  lastSeenAt?: string | null;
  createdAt: string;
}

/** Public-safe view of a user (never includes pinHash). */
export interface PublicUser {
  id: string;
  handle: string;
  displayName: string;
  avatar: string | null;
  provider: string;
  /** Who can see this profile/stats: 'public' | 'members' | 'private'. */
  privacy?: string;
  /** Home city (free text), if set — shown on the profile + drives city leaderboards. */
  city?: string | null;
  needsHandle: boolean;
  /** Whether onboarding has been completed/skipped (so the client can prompt once). */
  onboarded?: boolean;
}

/** Who made a change — a signed-in account or an anonymous device. */
export interface Actor {
  id: string;
  name: string;
}

/** An Error carrying an HTTP status the API layer turns into a response code. */
export interface HttpError extends Error {
  status?: number;
}
