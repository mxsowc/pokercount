// Stripe webhook signature verification — the one payment-critical piece we can
// test without a live account. Guards against forged/replayed/tampered events.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
const { verifyWebhook } = await import('../src/lib/server/stripe.js');

/** Build a valid Stripe-Signature header for a body + timestamp. */
function sign(body, t) {
  const v1 = createHmac('sha256', 'whsec_test_secret').update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

test('accepts a correctly signed, fresh payload and returns the parsed event', () => {
  const body = JSON.stringify({ type: 'customer.subscription.updated', id: 'evt_1' });
  const t = Math.floor(Date.now() / 1000);
  const event = verifyWebhook(body, sign(body, t));
  assert.equal(event?.type, 'customer.subscription.updated');
  assert.equal(event?.id, 'evt_1');
});

test('rejects a tampered body (signature no longer matches)', () => {
  const body = JSON.stringify({ type: 'x', id: 'evt_1' });
  const t = Math.floor(Date.now() / 1000);
  const header = sign(body, t);
  const tampered = JSON.stringify({ type: 'x', id: 'evt_HACKED' });
  assert.equal(verifyWebhook(tampered, header), null);
});

test('rejects a stale timestamp (replay outside the 5-min window)', () => {
  const body = JSON.stringify({ type: 'x' });
  const t = Math.floor(Date.now() / 1000) - 600; // 10 min old
  assert.equal(verifyWebhook(body, sign(body, t)), null);
});

test('rejects a wrong secret, and missing/garbage headers', () => {
  const body = JSON.stringify({ type: 'x' });
  const t = Math.floor(Date.now() / 1000);
  const badSig = `t=${t},v1=${createHmac('sha256', 'wrong').update(`${t}.${body}`).digest('hex')}`;
  assert.equal(verifyWebhook(body, badSig), null);
  assert.equal(verifyWebhook(body, null), null);
  assert.equal(verifyWebhook(body, 'garbage'), null);
});
