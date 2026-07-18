// Reasons for the profile "Report player" flow — the single source of truth,
// shared by the report modal (client) and the report endpoint (server
// validation). Tuned to what actually goes wrong in home poker: money disputes,
// cheating, abuse, fakes. `key`s are permanent once shipped (stored on each
// report); labels/order/emoji are free to change.
export interface ReportReason {
  key: string;
  emoji: string;
  label: string;
}

export const REPORT_REASONS: ReportReason[] = [
  { key: 'unpaid',        emoji: '💸', label: "Didn't pay up / welched on a debt" },
  { key: 'cheating',      emoji: '🃏', label: 'Cheating or collusion' },
  { key: 'harassment',    emoji: '😠', label: 'Harassment or abusive behaviour' },
  { key: 'impersonation', emoji: '🎭', label: 'Fake profile / impersonation' },
  { key: 'spam',          emoji: '📢', label: 'Spam or a scam' },
  { key: 'underage',      emoji: '🔞', label: 'Appears to be under 18' },
  { key: 'other',         emoji: '⚠️', label: 'Something else' },
];

export const REPORT_REASON_KEYS = new Set(REPORT_REASONS.map((r) => r.key));
export const reasonLabel = (key: string): string =>
  REPORT_REASONS.find((r) => r.key === key)?.label || key;
