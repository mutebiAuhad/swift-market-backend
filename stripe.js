const Stripe = require('stripe');

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
if (!stripe) console.error('[stripe] STRIPE_SECRET_KEY not set — automated card payments disabled until configured.');

const MONTHLY_PRICE_USD = Number(process.env.SUBSCRIPTION_PRICE_USD || 40);

// Creates the recurring $40/month Price on the fly against a Product we look up or create.
// Cached after first call so we don't hit the API on every checkout.
let cachedPriceId = null;
async function getOrCreateMonthlyPrice() {
  if (cachedPriceId) return cachedPriceId;
  if (process.env.STRIPE_PRICE_ID) {
    cachedPriceId = process.env.STRIPE_PRICE_ID;
    return cachedPriceId;
  }
  const product = await stripe.products.create({ name: 'Swift Market Subscription' });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: Math.round(MONTHLY_PRICE_USD * 100),
    currency: 'usd',
    recurring: { interval: 'month' }
  });
  cachedPriceId = price.id;
  return cachedPriceId;
}

async function createCheckoutSession({ userId, email, successUrl, cancelUrl }) {
  const priceId = await getOrCreateMonthlyPrice();
  return stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: email,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { userId }
  });
}

function constructWebhookEvent(rawBody, signature) {
  return stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
}

module.exports = { stripe, createCheckoutSession, constructWebhookEvent, MONTHLY_PRICE_USD };
