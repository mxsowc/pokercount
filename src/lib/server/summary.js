// Monthly summary email — "here's your poker month". Reuses the same stats engine
// the profile page uses, but over a rolling LAST-30-DAYS window (not all time),
// and renders an email-client-safe HTML message. Sent at most once per 30 days
// per user (idempotent across restarts via lastSummaryEmailAt on the account).

import { allGames } from './store.js';
import { allUsers, markSummarySent } from './users.js';
import { computeUserStats } from '../engine/stats.js';
import { converter } from './fx.js';
import { emailConfigured, sendEmail, siteOrigin } from './email.js';
import { signUnsubToken } from './auth.js';

const DAY = 86_400_000;
const round2 = (/** @type {number} */ n) => Math.round(n * 100) / 100;

/** When a game's result "happened": its settlement time if closed, else last
 *  activity. @param {any} g @returns {number} ms epoch (NaN if unparseable) */
const resultTime = (g) => Date.parse(g.settlement?.computedAt || g.updatedAt || g.createdAt || '');

/** Build a user's last-30-days summary, or null if they have no finished result
 *  in the window (so we never email an empty summary). Also diffs the previous 30
 *  days for a simple trend. Currency is the user's display unit (chips/other units
 *  are excluded from the money totals, surfaced as `otherGames`).
 *  @param {string} userId
 *  @param {number} [nowMs] @param {any[]} [games] @param {Function} [conv]
 *  @returns {null | { unit:string, gamesPlayed:number, totalProfit:number, avgProfit:number,
 *    profitablePct:number, best:any, worst:any, streak:any, hourly:any, otherGames:number,
 *    deltaVsPrev:number|null }} */
export function buildMonthlySummary(userId, nowMs = Date.now(), games = allGames(), conv = converter()) {
  const inWindow = (/** @type {any} */ g, /** @type {number} */ from, /** @type {number} */ to) => {
    const t = resultTime(g);
    return Number.isFinite(t) && t >= from && t < to;
  };
  const cur = games.filter((g) => inWindow(g, nowMs - 30 * DAY, nowMs));
  const s = computeUserStats(cur, userId, conv);
  if (!s.gamesPlayed) return null; // nothing finished in the last 30 days

  const prev = games.filter((g) => inWindow(g, nowMs - 60 * DAY, nowMs - 30 * DAY));
  const sPrev = computeUserStats(prev, userId, conv);

  return {
    unit: s.unit,
    gamesPlayed: s.gamesPlayed,
    totalProfit: s.totalProfit,
    avgProfit: s.avgProfit,
    profitablePct: s.profitablePct,
    best: s.best,        // { id, name, net } | null
    worst: s.worst,      // { id, name, net } | null
    streak: s.streak,    // { current, kind, longestWin, longestLoss }
    hourly: s.hourly,    // { rate, hours, games } | null
    otherGames: s.otherGames,
    deltaVsPrev: sPrev.gamesPlayed ? round2(s.totalProfit - sPrev.totalProfit) : null,
  };
}

// ---- rendering ---------------------------------------------------------------

const esc = (/** @type {unknown} */ s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));

/** Money in the summary's display unit (always a real currency symbol). */
function fmt(/** @type {number} */ n, /** @type {string} */ unit) {
  const v = Math.abs(round2(n));
  const num = Number.isInteger(v) ? String(v) : v.toFixed(2);
  return (n < 0 ? '−' : '') + unit + num;
}
function fmtSigned(/** @type {number} */ n, /** @type {string} */ unit) {
  return (n < 0 ? '−' : '+') + unit + (Number.isInteger(Math.abs(round2(n))) ? String(Math.abs(round2(n))) : Math.abs(round2(n)).toFixed(2));
}

const ACCENT = '#d96f43', INK = '#11140f', MUTED = '#6b7280', WIN = '#2f9e5e', LOSE = '#d3463a', LINE = '#e7e5e1';

/** Render the monthly summary email for `user` from a built summary.
 *  @param {any} user @param {NonNullable<ReturnType<typeof buildMonthlySummary>>} s
 *  @returns {{ subject: string, html: string, text: string }} */
export function renderSummaryEmail(user, s) {
  const unit = s.unit;
  const up = s.totalProfit >= 0;
  const origin = siteOrigin();
  const unsub = `${origin}/unsubscribe?u=${encodeURIComponent(user.id)}&t=${signUnsubToken(user.id)}`;
  const profile = `${origin}/u/${encodeURIComponent(user.handle)}`;
  const name = esc(user.displayName || user.handle);
  const games = `${s.gamesPlayed} game${s.gamesPlayed === 1 ? '' : 's'}`;

  const subject = `Your potcount month: ${fmtSigned(s.totalProfit, unit)} over ${games}`;

  // Plain-text fallback (some clients prefer it / accessibility).
  const lines = [
    `Hi ${user.displayName || user.handle},`,
    ``,
    `Your last 30 days on potcount — ${up ? 'up' : 'down'} ${fmt(Math.abs(s.totalProfit), unit)} across ${games}.`,
    ``,
    `Total profit: ${fmtSigned(s.totalProfit, unit)}`,
    `Average / game: ${fmtSigned(s.avgProfit, unit)}`,
    `Profitable nights: ${s.profitablePct}%`,
    s.best ? `Best night: ${s.best.name} (${fmtSigned(s.best.net, unit)})` : null,
    s.worst ? `Worst night: ${s.worst.name} (${fmtSigned(s.worst.net, unit)})` : null,
    s.streak?.current > 0 ? `Current streak: ${s.streak.current}${s.streak.kind === 'win' ? ' wins' : ' losses'}` : null,
    s.hourly ? `Hourly: ${fmtSigned(s.hourly.rate, unit)}/h over ${s.hourly.hours}h` : null,
    s.deltaVsPrev != null ? `Vs the previous 30 days: ${fmtSigned(s.deltaVsPrev, unit)}` : null,
    s.otherGames > 0 ? `(${s.otherGames} game${s.otherGames === 1 ? '' : 's'} in chips/other units aren't included in the totals.)` : null,
    ``,
    `See your full profile: ${profile}`,
    ``,
    `You get this because you have a potcount account. Unsubscribe: ${unsub}`,
  ].filter((l) => l != null);
  const text = lines.join('\n');

  // A stat cell for the 2×2 grid.
  const cell = (/** @type {string} */ label, /** @type {string} */ value, /** @type {string} */ color) => `
    <td width="50%" style="padding:6px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:12px;">
        <tr><td style="padding:14px 16px;text-align:center;">
          <div style="font-size:22px;font-weight:800;color:${color};font-family:Georgia,'Times New Roman',serif;">${value}</div>
          <div style="font-size:12px;color:${MUTED};margin-top:4px;">${label}</div>
        </td></tr>
      </table>
    </td>`;

  const nightRow = (/** @type {string} */ label, /** @type {any} */ n) => n ? `
    <tr>
      <td style="padding:8px 0;color:${MUTED};font-size:14px;">${label}</td>
      <td style="padding:8px 0;text-align:right;font-size:14px;"><b style="color:${INK};">${esc(n.name)}</b>
        <span style="color:${n.net >= 0 ? WIN : LOSE};font-weight:700;">&nbsp;${fmtSigned(n.net, unit)}</span></td>
    </tr>` : '';

  const extras = [
    s.streak?.current > 0
      ? `<tr><td style="padding:8px 0;color:${MUTED};font-size:14px;">Current streak</td><td style="padding:8px 0;text-align:right;font-size:14px;font-weight:700;color:${s.streak.kind === 'win' ? WIN : LOSE};">${s.streak.kind === 'win' ? '🔥' : '❄️'} ${s.streak.current}${s.streak.kind === 'win' ? 'W' : 'L'}</td></tr>`
      : '',
    s.hourly
      ? `<tr><td style="padding:8px 0;color:${MUTED};font-size:14px;">Per hour</td><td style="padding:8px 0;text-align:right;font-size:14px;font-weight:700;color:${s.hourly.rate >= 0 ? WIN : LOSE};">${fmtSigned(s.hourly.rate, unit)}/h <span style="color:${MUTED};font-weight:400;">· ${s.hourly.hours}h</span></td></tr>`
      : '',
    s.deltaVsPrev != null
      ? `<tr><td style="padding:8px 0;color:${MUTED};font-size:14px;">Vs previous 30 days</td><td style="padding:8px 0;text-align:right;font-size:14px;font-weight:700;color:${s.deltaVsPrev >= 0 ? WIN : LOSE};">${fmtSigned(s.deltaVsPrev, unit)}</td></tr>`
      : '',
  ].join('');

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"></head>
<body style="margin:0;background:#f4f3f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3f0;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid ${LINE};border-radius:18px;overflow:hidden;">
        <tr><td style="padding:24px 24px 8px;">
          <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:${ACCENT};font-weight:700;">potcount · your month</div>
          <div style="font-size:24px;font-weight:800;color:${INK};margin-top:6px;">Hi ${name} 👋</div>
          <div style="font-size:16px;color:${MUTED};margin-top:4px;">Last 30 days — you're <b style="color:${up ? WIN : LOSE};">${up ? 'up' : 'down'} ${fmt(Math.abs(s.totalProfit), unit)}</b> across ${games}.</div>
        </td></tr>
        <tr><td style="padding:8px 18px 4px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>${cell('total profit', fmtSigned(s.totalProfit, unit), up ? WIN : LOSE)}${cell('avg / game', fmtSigned(s.avgProfit, unit), s.avgProfit >= 0 ? WIN : LOSE)}</tr>
            <tr>${cell('% profitable', s.profitablePct + '%', INK)}${cell('games played', String(s.gamesPlayed), INK)}</tr>
          </table>
        </td></tr>
        <tr><td style="padding:12px 24px 4px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${LINE};">
            ${nightRow('🏆 Best night', s.best)}
            ${nightRow('💸 Worst night', s.worst)}
            ${extras}
          </table>
        </td></tr>
        ${s.otherGames > 0 ? `<tr><td style="padding:0 24px;"><div style="font-size:12px;color:${MUTED};">${s.otherGames} game${s.otherGames === 1 ? '' : 's'} in chips / other units aren't included in the totals.</div></td></tr>` : ''}
        <tr><td style="padding:20px 24px 24px;" align="center">
          <a href="${profile}" style="display:inline-block;background:${ACCENT};color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:12px;">See your full stats →</a>
        </td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
        <tr><td style="padding:16px 24px;text-align:center;font-size:12px;color:${MUTED};line-height:1.6;">
          You're getting this because you have a potcount account, which includes a monthly summary.<br>
          <a href="${unsub}" style="color:${MUTED};text-decoration:underline;">Unsubscribe</a> · <a href="${origin}/account" style="color:${MUTED};text-decoration:underline;">Email settings</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject, html, text };
}

// ---- sending -----------------------------------------------------------------

/** Send the monthly summary to every eligible user who's due (subscribed, has an
 *  email, and hasn't been sent one in the last 30 days). Skips users with nothing
 *  to report (but still stamps them so we don't recompute every tick). Safe to
 *  call repeatedly. @param {number} [nowMs] @returns {Promise<number>} sent count */
export async function sendDueMonthlySummaries(nowMs = Date.now()) {
  if (!emailConfigured()) return 0;
  const games = allGames();
  const conv = converter();
  let sent = 0;
  for (const u of allUsers()) {
    if (!u.email || !u.newsletter) continue;
    const last = u.lastSummaryEmailAt ? Date.parse(u.lastSummaryEmailAt) : 0;
    if (Number.isFinite(last) && nowMs - last < 30 * DAY) continue; // sent recently
    const summary = buildMonthlySummary(u.id, nowMs, games, conv);
    if (!summary) { markSummarySent(u.id, nowMs); continue; } // no games this month — don't email an empty one
    try {
      const { subject, html, text } = renderSummaryEmail(u, summary);
      const unsub = `${siteOrigin()}/unsubscribe?u=${encodeURIComponent(u.id)}&t=${signUnsubToken(u.id)}`;
      await sendEmail({
        to: u.email, subject, html, text,
        headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      });
      markSummarySent(u.id, nowMs);
      sent++;
    } catch (e) {
      console.error(`[summary] send failed for @${u.handle}:`, e instanceof Error ? e.message : e);
    }
  }
  if (sent) console.log(`[summary] sent ${sent} monthly summary email(s)`);
  return sent;
}
