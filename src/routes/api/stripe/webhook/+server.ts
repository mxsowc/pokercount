import { json } from '@sveltejs/kit';
import { verifyWebhook } from '$lib/server/stripe.js';
import { getUser, getByStripeCustomer, setPro } from '$lib/server/users.js';
import { sendEmail, emailConfigured } from '$lib/server/email.js';

// Stripe → us. This is the ONLY thing that flips a user to/from Pro. The client
// success page is cosmetic; entitlement is decided here from signed events.
//
// Handled events:
//   customer.subscription.created|updated  → sync status/plan/renewal onto user.pro
//   customer.subscription.deleted          → revoke Pro
//   invoice.paid                           → email Fatcloud a copy for the books
//   invoice.payment_failed                 → (status handled via subscription.updated)

const plans: Record<string, string> = {
  [process.env.STRIPE_PRICE_MONTHLY || '\0']: 'monthly',
  [process.env.STRIPE_PRICE_YEARLY || '\0']: 'yearly',
};
const planForPrice = (priceId: string) => plans[priceId] || 'monthly';

// Map Stripe subscription status → our coarse status, or null when it means "not Pro".
function mapStatus(s: string): 'active' | 'past_due' | null {
  if (s === 'active' || s === 'trialing') return 'active';
  if (s === 'past_due' || s === 'unpaid') return 'past_due'; // dunning grace
  return null; // canceled | incomplete | incomplete_expired | paused
}

const iso = (unixSeconds?: number | null) =>
  unixSeconds ? new Date(unixSeconds * 1000).toISOString() : null;

function resolveUser(obj: any) {
  const byMeta = obj?.metadata?.userId ? getUser(obj.metadata.userId) : null;
  return byMeta || getByStripeCustomer(obj?.customer);
}

async function notifyFatcloud(invoice: any) {
  const to = process.env.INVOICE_NOTIFY;
  if (!to || !emailConfigured()) return;
  const total = ((invoice?.total ?? 0) / 100).toFixed(2);
  const cur = String(invoice?.currency || 'eur').toUpperCase();
  const link = invoice?.hosted_invoice_url || invoice?.invoice_pdf || '';
  await sendEmail({
    to,
    subject: `potcount Pro — invoice ${invoice?.number || invoice?.id} (${cur} ${total})`,
    text: `A potcount Pro invoice was paid.\n\nCustomer: ${invoice?.customer_email || invoice?.customer_name || invoice?.customer}\nTotal: ${cur} ${total}\nInvoice: ${link}\n\n(Stripe has emailed the customer their copy; the VAT invoice is in the Stripe Dashboard.)`,
  }).catch((e) => console.error('[stripe] Fatcloud invoice copy failed:', e));
}

export async function POST({ request }: { request: Request }) {
  const raw = await request.text(); // RAW body — required for signature verification
  const event = verifyWebhook(raw, request.headers.get('stripe-signature'));
  if (!event) return json({ error: 'invalid signature' }, { status: 400 });

  const obj: any = event.data?.object || {};
  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const u = resolveUser(obj);
        if (!u) break;
        const status = mapStatus(obj.status);
        if (!status) { setPro(u.id, null); break; }
        setPro(u.id, {
          status,
          plan: planForPrice(obj.items?.data?.[0]?.price?.id),
          currentPeriodEnd: iso(obj.current_period_end),
          since: u.pro?.since || new Date().toISOString(),
          grantedBy: 'stripe',
          customerId: obj.customer,
          subscriptionId: obj.id,
        });
        break;
      }
      case 'customer.subscription.deleted': {
        const u = resolveUser(obj);
        if (u) setPro(u.id, null);
        break;
      }
      case 'invoice.paid': {
        await notifyFatcloud(obj);
        break;
      }
    }
  } catch (e) {
    console.error('[stripe] webhook handler error:', e);
    return json({ error: 'handler error' }, { status: 500 }); // Stripe will retry
  }
  return json({ received: true });
}
