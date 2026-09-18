// momo.js — MTN Mobile Money "Collections" API (request-to-pay).
//
// Flow: a business subscribes -> we ask MTN to prompt the business's phone
// for a Mobile Money PIN -> the business approves on their phone -> MTN
// confirms the transaction -> we mark the subscription active.
//
// Docs: https://momodeveloper.mtn.com  (subscribe to "Collections" first)
// Everything here targets the SANDBOX by default. Switch MOMO_TARGET_ENVIRONMENT
// and MOMO_BASE_URL in your .env once MTN approves your production access.

const { v4: uuidv4 } = require('uuid');

const BASE_URL = process.env.MOMO_BASE_URL || 'https://sandbox.momodeveloper.mtn.com';
const SUBSCRIPTION_KEY = process.env.MOMO_SUBSCRIPTION_KEY;
const API_USER = process.env.MOMO_API_USER;
const API_KEY = process.env.MOMO_API_KEY;
const TARGET_ENV = process.env.MOMO_TARGET_ENVIRONMENT || 'sandbox';

function assertConfigured() {
  if (!SUBSCRIPTION_KEY || !API_USER || !API_KEY) {
    throw new Error(
      'MTN MoMo is not configured. Set MOMO_SUBSCRIPTION_KEY, MOMO_API_USER, ' +
      'and MOMO_API_KEY in your .env (see .env.example for how to get them).'
    );
  }
}

// Step 1: exchange the API user/key for a short-lived access token.
async function getAccessToken() {
  assertConfigured();
  const basicAuth = Buffer.from(`${API_USER}:${API_KEY}`).toString('base64');
  const res = await fetch(`${BASE_URL}/collection/token/`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`MoMo token request failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return data.access_token;
}

// Step 2: ask MTN to prompt the payer's phone to approve a payment.
// `phone` should be in international format without "+", e.g. 2567XXXXXXXX.
// Returns the referenceId you must poll (or receive a callback for).
async function requestToPay({ phone, amount, currency = 'EUR', externalId, payerMessage, payeeNote }) {
  const token = await getAccessToken();
  const referenceId = uuidv4();

  // NOTE: the MTN MoMo sandbox only accepts "EUR" as currency for test
  // transactions. Production access for Uganda uses "UGX" — switch the
  // default once you're approved and testing against the live environment.

  const res = await fetch(`${BASE_URL}/collection/v1_0/requesttopay`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Reference-Id': referenceId,
      'X-Target-Environment': TARGET_ENV,
      'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: String(amount),
      currency,
      externalId,
      payer: { partyIdType: 'MSISDN', partyId: phone },
      payerMessage: payerMessage || 'Swift Market subscription',
      payeeNote: payeeNote || 'Swift Market',
    }),
  });

  if (res.status !== 202) {
    const body = await res.text();
    throw new Error(`MoMo requestToPay failed (${res.status}): ${body}`);
  }
  return referenceId;
}

// Step 3: check whether the payer approved, declined, or hasn't responded yet.
async function getTransactionStatus(referenceId) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}/collection/v1_0/requesttopay/${referenceId}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Target-Environment': TARGET_ENV,
      'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`MoMo status check failed (${res.status}): ${body}`);
  }
  return res.json(); // { status: 'PENDING' | 'SUCCESSFUL' | 'FAILED', ... }
}

module.exports = { requestToPay, getTransactionStatus };
