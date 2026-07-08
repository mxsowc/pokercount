// One-time server initialization — called from hooks.server.ts.
import { init as initStore, reapStaleGames, reapAbandonedGames, backfillSettleConfirmations } from './store.js';
import { init as initUsers } from './users.js';
import { init as initSocial } from './social.js';
import { init as initReactions } from './reactions.js';
import { init as initComments } from './comments.js';
import { init as initNotifications } from './notifications.js';
import { remindUnsettledDebts } from './debt-reminders.js';
import { initAuth } from './auth.js';
import { emailConfigured } from './email.js';
import { sendDueMonthlySummaries } from './summary.js';

let done = false;

export function ensureInit() {
  if (done) return;
  initAuth();
  const usersLoaded = initUsers();
  const socialLoaded = initSocial();
  const reactionsLoaded = initReactions();
  const commentsLoaded = initComments();
  initNotifications();
  const gamesLoaded = initStore();
  // One-time: seed the new "avg settle time" stat for historical games (marks past
  // debts paid+confirmed ~1 day after the game). Marker-guarded, so it's a no-op
  // after the first boot and never touches games created afterwards.
  backfillSettleConfirmations();
  console.log(`potcount ready (${gamesLoaded} game(s), ${usersLoaded} user(s), ${socialLoaded} follow(s), ${reactionsLoaded} reaction set(s), ${commentsLoaded} comment thread(s))`);

  // Housekeeping, hourly: first delete abandoned tables (not real, 24h+ old),
  // then auto-close any game left active with no activity for 12h+ (order matters
  // — reap junk before bothering to settle/close it), then remind both sides of
  // any debt still unpaid 24h after a game ended.
  const housekeep = () => { reapAbandonedGames(); reapStaleGames(); remindUnsettledDebts(); };
  housekeep();
  setInterval(housekeep, 3_600_000); // every hour

  // Monthly summary emails — only if email is configured. Each subscribed user is
  // sent at most once per 30 days (stamped on the account), so a frequent tick is
  // cheap: nearly everyone is skipped by the cadence guard.
  if (emailConfigured()) {
    const mailSummaries = () => { sendDueMonthlySummaries().catch((e) => console.error('[summary] tick failed:', e)); };
    setTimeout(mailSummaries, 60_000);          // shortly after boot
    setInterval(mailSummaries, 6 * 3_600_000);  // then every 6 hours
  } else {
    console.log('[init] email not configured (set RESEND_API_KEY) — monthly summaries off');
  }

  done = true;
}
