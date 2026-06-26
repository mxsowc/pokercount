// First-party, cookieless acquisition tracking. We remember — once per device,
// in localStorage — how someone FIRST arrived (their first-touch source), so when
// they later open a game we can attribute that game to where it came from. No
// cookies, no third party, nothing sent anywhere except attached to a game the
// user themselves creates. The server re-sanitises before storing.

import { browser } from '$app/environment';

const KEY = 'pc_acq';

export type Acq = {
  /** Campaign tag from ?ref= / ?utm_source= / ?utm_campaign= (e.g. "reddit"). */
  ref: string | null;
  /** External referrer hostname (e.g. "google.com"), or null for direct/internal. */
  referrer: string | null;
  /** The first path on this site they landed on (e.g. "/poker-chip-tracker"). */
  landing: string | null;
  /** First-touch timestamp (ms). */
  at: number;
};

/** Record the first-touch source, once. Safe to call on every page load — it
 *  no-ops if we've already captured this device's first visit.
 *  @param pathname e.g. $page.url.pathname  @param search e.g. $page.url.search */
export function captureAcq(pathname: string, search: string): void {
  if (!browser) return;
  try {
    if (localStorage.getItem(KEY)) return; // first touch only — never overwrite
    const params = new URLSearchParams(search || '');
    const tag = params.get('ref') || params.get('utm_source') || params.get('utm_campaign') || '';
    let referrer: string | null = null;
    try {
      if (document.referrer) {
        const host = new URL(document.referrer).host;
        if (host && host !== location.host) referrer = host; // external only
      }
    } catch { /* malformed referrer — ignore */ }
    const acq: Acq = {
      ref: tag ? tag.toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 40) || null : null,
      referrer: referrer ? referrer.toLowerCase().replace(/[^a-z0-9.:-]/g, '').slice(0, 80) || null : null,
      landing: (pathname || '/').toLowerCase().replace(/[^a-z0-9/_-]/g, '').slice(0, 80) || '/',
      at: Date.now(),
    };
    localStorage.setItem(KEY, JSON.stringify(acq));
  } catch { /* storage blocked (private mode) — tracking is best-effort */ }
}

/** The stored first-touch source, or null. Attach to a game on creation. */
export function getAcq(): Acq | null {
  if (!browser) return null;
  try {
    const s = localStorage.getItem(KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}
