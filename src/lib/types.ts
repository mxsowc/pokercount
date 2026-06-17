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
  id: string;
  name: string;
  unit: string;
  status: GameStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
  players: Player[];
  transactions: Transaction[];
  finalStacks: Record<string, number>;
  log: LogEntry[];
  /** Device/actor id that opened the game (host). */
  hostId?: string;
  /** Account id of the owner, if created while signed in. */
  ownerId?: string;
  /** True for games created after host tokens existed (host proven by signed token). */
  tokenedHost?: boolean;
  settlement?: Settlement;
}

/** Payload accepted by createGame. */
export interface NewGameInput {
  name?: string;
  unit?: string;
  players?: { name?: string }[];
  code?: string;
}

export interface User {
  id: string;
  handle: string;
  displayName: string;
  avatar: string | null;
  provider: string;
  providerSub: string | null;
  pinHash: string | null;
  needsHandle?: boolean;
  createdAt: string;
}

/** Public-safe view of a user (never includes pinHash). */
export interface PublicUser {
  id: string;
  handle: string;
  displayName: string;
  avatar: string | null;
  provider: string;
  needsHandle: boolean;
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
