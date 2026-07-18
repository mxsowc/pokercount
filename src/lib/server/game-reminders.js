// Pre-game reminders. A scheduled game (one you RSVP'd to, or were approved into)
// pings every seated, account-linked player ~24h before and ~2h before it starts.
// In-app always; a transactional email too when email is configured (this isn't
// marketing — you signed up for the game — so it ignores the newsletter opt-in).
//
// Fires each window at most once, deduped via notification history, so the hourly
// housekeeping tick can call this freely.

import { allGames } from './store.js';
import { getUser } from './users.js';
import { notify, hasRecentGameNotif } from './notifications.js';
import { emailConfigured, sendEmail, siteOrigin } from './email.js';

const HOUR = 60 * 60 * 1000;
const esc = (/** @type {unknown} */ s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));

/** Notify seated players of scheduled games entering the 24h / 2h pre-game window.
 *  @param {number} [nowMs] @returns {number} reminders sent */
export function remindUpcomingGames(nowMs = Date.now()) {
  let sent = 0;
  for (const g of allGames()) {
    if (g.status !== 'scheduled' || !g.scheduledFor) continue;
    const when = new Date(g.scheduledFor).getTime();
    if (!Number.isFinite(when) || when <= nowMs) continue; // already started / lapsed
    const hoursLeft = (when - nowMs) / HOUR;

    // Exactly one window per tick; withinMs > band width so each fires once.
    let type = null, withinMs = 0, lead = '';
    if (hoursLeft <= 2) { type = 'game_reminder_2h'; withinMs = 6 * HOUR; lead = 'in ~2 hours'; }
    else if (hoursLeft <= 24) { type = 'game_reminder_24h'; withinMs = 30 * HOUR; lead = 'tomorrow'; }
    if (!type) continue;

    for (const p of g.players || []) {
      if (!p.userId) continue; // anonymous seat — nobody to ping
      if (hasRecentGameNotif(p.userId, g.id, type, withinMs)) continue;
      notify(p.userId, { type, gameId: g.id, gameCode: g.code, text: `“${g.name}” starts ${lead}` });
      sent++;
      if (emailConfigured()) {
        const u = getUser(p.userId);
        if (u?.email) {
          const url = `${siteOrigin()}/game?g=${g.id}`;
          sendEmail({
            to: u.email,
            subject: `Reminder: “${g.name}” starts ${lead}`,
            html: `<p>Hi ${esc(u.displayName || u.handle)},</p><p>Your home game <b>${esc(g.name)}</b> starts <b>${lead}</b>.</p><p><a href="${url}">Open the game →</a></p>`,
            text: `Your home game "${g.name}" starts ${lead}.\n${url}`,
          }).catch((e) => console.error('[reminder] email failed:', e instanceof Error ? e.message : e));
        }
      }
    }
  }
  if (sent > 0) console.log(`[reminder] sent ${sent} upcoming-game reminder(s)`);
  return sent;
}
