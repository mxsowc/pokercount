// Minimal Stripe client over fetch — no SDK dependency (same approach as email.js).
// Subscriptions via hosted Checkout; management via the Billing Customer Portal;
// the source of truth for Pro status is the signature-verified webhook (never the
// client). All amounts/taxes are handled by Stripe (Stripe Tax computes VAT).

import { createHmac, timingSafeEqual } from 'node:crypto';

const API = 'https://api.stripe.com/v1';
const key = () => process.env.STRIPE_SECRET_KEY || '';

/** Whether payments are wired up (keys present). The Pro purchase UI is gated on
 *  this, so nothing shows until you set the env vars. */
export const stripeConfigured = () => !!key() && !!process.env.STRIPE_WEBHOOK_SECRET;

// Stripe wants application/x-www-form-urlencoded with bracketed nested keys, e.g.
// line_items[0][price]=price_123.
function encode(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === 'object') encode(item, `${key}[${i}]`, out);
        else out.append(`${key}[${i}]`, String(item));
      });
    } else if (v && typeof v === 'object') {
      encode(v, key, out);
    } else {
      out.append(key, String(v));
    }
  }
  return out;
}

async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: encode(body).toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `Stripe ${path} failed (${res.status})`);
  return json;
}

/** Hosted subscription Checkout Session. Returns { url } to redirect the buyer to.
 *  @param {{priceId:string, customerId?:string, customerEmail?:string, userId:string, successUrl:string, cancelUrl:string}} o */
export function createCheckoutSession({ priceId, customerId, customerEmail, userId, successUrl, cancelUrl }) {
  const body = {
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: userId,
    allow_promotion_codes: true,
    // VAT: let Stripe Tax compute the correct rate and let the buyer enter a VAT id.
    automatic_tax: { enabled: true },
    tax_id_collection: { enabled: true },
    // Stamp our user id on both the session and the subscription, so the webhook
    // can resolve the account with zero ambiguity.
    metadata: { userId },
    subscription_data: { metadata: { userId } },
  };
  if (customerId) { body.customer = customerId; body.customer_update = { name: 'auto', address: 'auto' }; }
  else if (customerEmail) body.customer_email = customerEmail;
  return post('/checkout/sessions', body);
}

/** Billing Customer Portal session (update card / cancel / see invoices). */
export function createPortalSession({ customerId, returnUrl }) {
  return post('/billing_portal/sessions', { customer: customerId, return_url: returnUrl });
}

/** Verify a Stripe-Signature header against the raw request body. Returns the
 *  parsed event on success, else null. Implements Stripe's v1 scheme:
 *  HMAC-SHA256 over `${timestamp}.${rawBody}`, timing-safe, with a 5-min replay window.
 *  @param {string} rawBody @param {string | null} sigHeader */
export function verifyWebhook(rawBody, sigHeader) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
  if (!secret || !sigHeader) return null;
  /** @type {Record<string,string>} */
  const parts = {};
  for (const kv of sigHeader.split(',')) { const i = kv.indexOf('='); if (i > 0) parts[kv.slice(0, i)] = kv.slice(i + 1); }
  const t = parts.t, v1 = parts.v1;
  if (!t || !v1) return null;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return null; // stale → reject (replay guard)
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(v1);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try { return JSON.parse(rawBody); } catch { return null; }
}
