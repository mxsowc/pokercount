import { json } from '@sveltejs/kit';
import { sessionUser } from '$lib/server/helpers.js';
import { createCheckoutSession, stripeConfigured } from '$lib/server/stripe.js';
import { isPro } from '$lib/server/users.js';

const ORIGIN = () => process.env.ORIGIN || 'https://potcount.com';
const priceFor = (plan: string) =>
  (plan === 'yearly' ? process.env.STRIPE_PRICE_YEARLY : process.env.STRIPE_PRICE_MONTHLY) || '';

// Start a Pro subscription: returns a hosted Stripe Checkout URL to redirect to.
export async function POST({ request }: { request: Request }) {
  if (!stripeConfigured()) return json({ error: 'Payments are not enabled yet.' }, { status: 503 });
  const su = sessionUser(request);
  if (!su) return json({ error: 'Sign in first.' }, { status: 401 });
  if (isPro(su) && su.pro?.plan !== 'comp') return json({ error: "You're already Pro." }, { status: 400 });

  const { plan } = await request.json().catch(() => ({}));
  const priceId = priceFor(plan);
  if (!priceId) return json({ error: 'Unknown plan.' }, { status: 400 });

  try {
    const s = await createCheckoutSession({
      priceId,
      customerId: su.pro?.customerId,       // reuse the Stripe customer if we've seen them
      customerEmail: (su as any).email || undefined,
      userId: su.id,
      successUrl: `${ORIGIN()}/account?pro=success`,
      cancelUrl: `${ORIGIN()}/account?pro=cancel`,
    });
    return json({ url: s.url });
  } catch (e: any) {
    return json({ error: e?.message || 'Could not start checkout.' }, { status: 400 });
  }
}
