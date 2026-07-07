// Build an exportable win/loss statement from a user's computed stats.
//
// The engine (computeUserStats) already does the money-correct work: converts
// every game into the player's display currency, freezes per-game net + buy-in,
// and hands back a full dated `ledger`. Here we only *shape* that into a CSV a
// spreadsheet (or an accountant) can read — one summary block, then one row per
// game, oldest first. Nothing here recomputes money.

import { money, fmtSigned } from './money';

type LedgerRow = {
  id: string;
  name: string;
  at: string;
  unit: string;
  net: number;
  invested: number;
  hours: number | null;
  status: string;
  money: boolean;
};

type Stats = {
  unit: string;
  gamesPlayed: number;
  otherGames: number;
  totalProfit: number;
  avgProfit: number;
  avgBuyIn: number;
  profitablePct: number;
  best: { net: number } | null;
  worst: { net: number } | null;
  streak?: { current: number; kind: 'win' | 'loss' | 'none' } | null;
  hourly?: { rate: number } | null;
  ledger?: LedgerRow[];
};

type User = { handle: string; displayName?: string };

/** ISO timestamp → YYYY-MM-DD (falls back to the raw string if unparseable). */
export function ymd(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}

/** ISO timestamp → a friendly "4 Jan 2026" for the printable statement. */
export function prettyDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function streakLabel(s: Stats['streak']): string {
  if (!s || !s.current || s.kind === 'none') return '—';
  return `${s.current}${s.kind === 'win' ? 'W' : 'L'}`;
}

// RFC-4180-ish quoting: wrap in quotes and double any embedded quote whenever the
// field holds a comma, quote or newline. Leading-zero-safe (we never touch ids).
function csvCell(v: string | number): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csvRow = (cells: (string | number)[]) => cells.map(csvCell).join(',');

/** Build the full statement as a CSV string: a summary block, a blank line, then
 *  the dated per-game ledger. Amounts in the table are plain signed numbers (so a
 *  spreadsheet can total them) with a separate Currency column. */
export function buildStatementCSV(user: User, stats: Stats): string {
  const u = stats.unit;
  const rows: string[] = [];
  rows.push(csvRow([`potcount statement — @${user.handle}`]));
  rows.push(csvRow(['Generated', ymd(new Date().toISOString())]));
  rows.push(csvRow(['Display currency', u]));
  rows.push(csvRow(['Games played', stats.gamesPlayed]));
  rows.push(csvRow(['Total profit', fmtSigned(stats.totalProfit, u)]));
  rows.push(csvRow(['Average / game', stats.gamesPlayed ? fmtSigned(stats.avgProfit, u) : '—']));
  rows.push(csvRow(['Average buy-in', stats.gamesPlayed ? money(stats.avgBuyIn, u) : '—']));
  rows.push(csvRow(['Win rate', stats.gamesPlayed ? `${stats.profitablePct}%` : '—']));
  rows.push(csvRow(['Best night', stats.best ? fmtSigned(stats.best.net, u) : '—']));
  rows.push(csvRow(['Worst night', stats.worst ? fmtSigned(stats.worst.net, u) : '—']));
  rows.push(csvRow(['Current streak', streakLabel(stats.streak)]));
  if (stats.hourly) rows.push(csvRow(['Per hour', fmtSigned(stats.hourly.rate, u)]));
  if (stats.otherGames) rows.push(csvRow(['Other-unit games', `${stats.otherGames} (kept in their own unit below)`]));
  rows.push('');
  rows.push(csvRow(['Date', 'Game', 'ID', 'Currency', 'Buy-in', 'Net']));
  for (const r of stats.ledger ?? []) {
    rows.push(csvRow([
      ymd(r.at),
      r.name,
      r.id,
      r.unit,
      r.invested.toFixed(2),
      (r.net >= 0 ? '+' : '') + r.net.toFixed(2),
    ]));
  }
  return rows.join('\r\n');
}

/** Trigger a client-side file download of `content` as `filename`. */
export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function statementFilename(handle: string, ext: string): string {
  const day = ymd(new Date().toISOString());
  return `potcount-${handle}-${day}.${ext}`;
}
