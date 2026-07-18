import { json } from '@sveltejs/kit';
import { sessionUser } from '$lib/server/helpers.js';
import { createPortalSession, stripeConfigured } from '$lib/server/stripe.js';

const ORIGIN = () => process.env.ORIGIN || 'https://potcount.com';

// Open the Stripe Billing Customer Portal — update card, view invoices, or cancel.
export async function POST({ request }: { request: Request }) {
  if (!stripeConfigured()) return json({ error: 'Payments are not enabled yet.' }, { status: 503 });
  const su = sessionUser(request);
  if (!su) return json({ error: 'Sign in first.' }, { status: 401 });
  const customerId = su.pro?.customerId;
  if (!customerId) return json({ error: 'No subscription to manage.' }, { status: 400 });

  try {
    const s = await createPortalSession({ customerId, returnUrl: `${ORIGIN()}/account` });
    return json({ url: s.url });
  } catch (e: any) {
    return json({ error: e?.message || 'Could not open the billing portal.' }, { status: 400 });
  }
}
