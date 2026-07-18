import { json } from '@sveltejs/kit';
import { stripeConfigured } from '$lib/server/stripe.js';

// Public client identifiers the sign-in buttons need in the browser. Safe to
// expose: these are public app IDs, not secrets. A null value simply hides the
// corresponding button until the env var is set.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || null;
const APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID || null;

export function GET() {
  return json({
    googleClientId: GOOGLE_CLIENT_ID,
    appleClientId: APPLE_CLIENT_ID,
    // Whether the Pro purchase UI should show (keys present). Not a secret.
    proEnabled: stripeConfigured(),
    proPrice: { monthly: process.env.PRO_PRICE_MONTHLY || '€3.99', yearly: process.env.PRO_PRICE_YEARLY || '€29.99' },
  });
}
