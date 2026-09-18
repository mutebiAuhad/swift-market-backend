// flutterwave.js — one processor covering cards, MTN Mobile Money, and
// Airtel Money for Uganda, so customers get a single secure checkout page
// hosted by Flutterwave (card numbers never touch our server — important
// for PCI-DSS compliance and for keeping this legally and practically safe).
//
// Money splitting: each business should be onboarded as a Flutterwave
// "Subaccount" (see their dashboard: Settings > Subaccounts, or the
// /v3/subaccounts API). When you create a payment, passing that
// subaccount id sends the business's share straight to them, and the
// platform keeps a small commission automatically — nobody has to trust
// the platform to manually forward the money.
//
// Docs: https://developer.flutterwave.com

const SECRET_KEY = process.env.FLW_SECRET_KEY;
const BASE_URL = 'https://api.flutterwave.com/v3';
const PLATFORM_COMMISSION_PERCENT = Number(process.env.PLATFORM_COMMISSION_PERCENT || 5);

function assertConfigured() {
  if (!SECRET_KEY) {
    throw new Error('Flutterwave is not configured. Set FLW_SECRET_KEY in your .env.');
  }
}

// Create a hosted checkout link for one order.
async function createCheckout({ txRef, amount, currency = 'UGX', customerEmail, customerName, redirectUrl, subaccountId, narration }) {
  assertConfigured();
  const payload = {
    tx_ref: txRef,
    amount,
    currency,
    redirect_url: redirectUrl,
    customer: { email: customerEmail, name: customerName },
    customizations: { title: 'Swift Market', description: narration || 'Order payment' },
    // Restrict to the channels the site currently supports:
    payment_options: 'card,mobilemoneyuganda',
  };
  if (subaccountId) {
    payload.subaccounts = [{ id: subaccountId, transaction_split_ratio: 100 - PLATFORM_COMMISSION_PERCENT }];
  }
  const res = await fetch(`${BASE_URL}/payments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (data.status !== 'success') throw new Error(data.message || 'Could not start checkout');
  return data.data.link; // send the customer here
}

// Verify a transaction after Flutterwave redirects/webhooks back to us.
// ALWAYS verify server-side before marking an order paid — never trust the
// redirect query params alone, since those can be faked by a browser.
async function verifyTransaction(transactionId) {
  assertConfigured();
  const res = await fetch(`${BASE_URL}/transactions/${transactionId}/verify`, {
    headers: { Authorization: `Bearer ${SECRET_KEY}` },
  });
  const data = await res.json();
  if (data.status !== 'success') throw new Error(data.message || 'Verification failed');
  return data.data; // includes status, amount, currency, tx_ref, payment_type
}

// Register a business as a payout subaccount so their share of each sale
// goes directly to their own mobile money line or bank account.
async function createSubaccount({ businessName, accountBank, accountNumber, splitType = 'percentage' }) {
  assertConfigured();
  const res = await fetch(`${BASE_URL}/subaccounts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      account_bank: accountBank,       // Flutterwave bank code, or MTN/Airtel mobile money code
      account_number: accountNumber,   // the business's receiving phone number or account
      business_name: businessName,
      split_type: splitType,
      split_value: (100 - PLATFORM_COMMISSION_PERCENT) / 100,
    }),
  });
  const data = await res.json();
  if (data.status !== 'success') throw new Error(data.message || 'Could not create payout account');
  return data.data.id;
}

module.exports = { createCheckout, verifyTransaction, createSubaccount };
