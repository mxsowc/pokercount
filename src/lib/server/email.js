// Outbound email — a thin, provider-agnostic sender. The default backend is
// Resend's HTTP API (no SDK, just fetch), selected via env so swapping to
// Postmark/SES later is a one-function change. Dormant until configured: with no
// API key set, sends are skipped (and logged), so the app runs fine without email
// in dev / self-host — exactly like Google/Apple sign-in are env-gated.
//
// Env:
//   RESEND_API_KEY  — enables sending (without it, email is off)
//   EMAIL_FROM      — From header, e.g. "potcount <summary@potcount.com>"
//   ORIGIN          — site origin for links in emails (adapter-node already uses it)

const RESEND_KEY = process.env.RESEND_API_KEY || '';
const FROM = process.env.EMAIL_FROM || 'potcount <noreply@potcount.com>';

/** Whether outbound email is configured (an API key is present). */
export function emailConfigured() {
  return !!RESEND_KEY;
}

/** Absolute site origin for links inside emails (no trailing slash). */
export function siteOrigin() {
  return (process.env.ORIGIN || 'https://potcount.com').replace(/\/+$/, '');
}

/** Send one email. Resolves true if accepted by the provider, false if email
 *  isn't configured (no-op). Throws on a provider error so callers can log it.
 *  @param {{ to: string, subject: string, html: string, text?: string, headers?: Record<string,string> }} msg
 *  @returns {Promise<boolean>} */
export async function sendEmail({ to, subject, html, text, headers }) {
  if (!RESEND_KEY) {
    console.warn(`[email] skipped (RESEND_API_KEY unset): "${subject}" → ${to}`);
    return false;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, text, headers }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`email send failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  return true;
}
