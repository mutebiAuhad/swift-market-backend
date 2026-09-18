// cron.js — runs hourly. Three jobs:
//  1. Reminds/charges businesses whose subscription is about to expire and
//     have auto-renew on (MTN MoMo still requires the business to approve
//     the prompt on their phone — this automates sending that prompt, not
//     a silent charge, since MoMo doesn't support truly silent debits).
//  2. Reconciles any subscription payment MoMo hasn't confirmed yet.
//  3. Suspends businesses whose subscription lapsed without renewal.

const cron = require('node-cron');
const db = require('./db');
const momo = require('./momo');
const mailer = require('./mailer');
const { v4: uuidv4 } = require('uuid');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000; // start trying 24h before expiry
const WEEKLY_FEE_UGX = Number(process.env.WEEKLY_FEE_UGX || 50000);

async function remindAndChargeRenewals() {
  const now = Date.now();
  const dueSoon = db.prepare(`
    SELECT * FROM businesses
    WHERE status = 'active' AND auto_renew = 1 AND free_slot = 0
      AND subscription_expires_at IS NOT NULL
      AND subscription_expires_at <= ?
      AND (renewal_reminder_sent_at IS NULL OR renewal_reminder_sent_at < ?)
  `).all(now + REMINDER_WINDOW_MS, now - 12 * 60 * 60 * 1000); // don't re-nag more than every 12h

  for (const biz of dueSoon) {
    db.prepare('UPDATE businesses SET renewal_reminder_sent_at = ? WHERE id = ?').run(now, biz.id);

    if (!biz.subscription_momo_phone) {
      await mailer.sendMail({
        to: biz.recovery_email || biz.email,
        subject: 'Swift Market — your subscription renews soon',
        html: `<p>Hi ${biz.name},</p><p>Your Swift Market subscription expires soon. Add a Mobile Money number in your dashboard so renewal can be requested automatically, or pay manually before it lapses.</p>`,
      });
      continue;
    }

    try {
      const externalId = uuidv4();
      const referenceId = await momo.requestToPay({
        phone: biz.subscription_momo_phone,
        amount: WEEKLY_FEE_UGX,
        externalId,
        payerMessage: 'Swift Market subscription renewal',
        payeeNote: `Renewal for ${biz.name}`,
      });
      db.prepare(`
        INSERT INTO payments (id, business_id, amount, phone, provider_reference, status, purpose, created_at)
        VALUES (?, ?, ?, ?, ?, 'PENDING', 'subscription', ?)
      `).run(uuidv4(), biz.id, WEEKLY_FEE_UGX, biz.subscription_momo_phone, referenceId, now);
      await mailer.sendMail({
        to: biz.recovery_email || biz.email,
        subject: 'Swift Market — approve your renewal payment',
        html: `<p>Hi ${biz.name},</p><p>We've sent a Mobile Money prompt to ${biz.subscription_momo_phone} to renew your weekly subscription (${WEEKLY_FEE_UGX} UGX). Please approve it on your phone.</p>`,
      });
    } catch (e) {
      console.error('[cron] renewal charge failed for', biz.id, e.message);
    }
  }
}

async function reconcilePendingSubscriptionPayments() {
  const pending = db.prepare(`SELECT * FROM payments WHERE status = 'PENDING' AND purpose = 'subscription'`).all();
  for (const payment of pending) {
    try {
      const result = await momo.getTransactionStatus(payment.provider_reference);
      if (result.status === 'SUCCESSFUL') {
        db.prepare(`UPDATE payments SET status = 'SUCCESSFUL' WHERE id = ?`).run(payment.id);
        const biz = db.prepare('SELECT * FROM businesses WHERE id = ?').get(payment.business_id);
        const base = biz.subscription_expires_at && biz.subscription_expires_at > Date.now() ? biz.subscription_expires_at : Date.now();
        db.prepare(`UPDATE businesses SET status = 'active', subscription_expires_at = ? WHERE id = ?`).run(base + WEEK_MS, payment.business_id);
      } else if (result.status === 'FAILED') {
        db.prepare(`UPDATE payments SET status = 'FAILED' WHERE id = ?`).run(payment.id);
      }
    } catch (e) {
      console.error('[cron] could not check payment', payment.id, e.message);
    }
  }
}

async function suspendLapsedSubscriptions() {
  const now = Date.now();
  const lapsed = db.prepare(`
    SELECT * FROM businesses WHERE status = 'active' AND free_slot = 0
      AND subscription_expires_at IS NOT NULL AND subscription_expires_at < ?
  `).all(now - 6 * 60 * 60 * 1000); // 6h grace period past expiry
  for (const biz of lapsed) {
    db.prepare(`UPDATE businesses SET status = 'suspended' WHERE id = ?`).run(biz.id);
    await mailer.sendMail({
      to: biz.recovery_email || biz.email,
      subject: 'Swift Market — subscription lapsed',
      html: `<p>Hi ${biz.name},</p><p>Your subscription has lapsed and your listings are now hidden from the marketplace. Log in and pay to reactivate.</p>`,
    });
  }
}

function start() {
  // Every hour, on the hour.
  cron.schedule('0 * * * *', async () => {
    try {
      await remindAndChargeRenewals();
      await reconcilePendingSubscriptionPayments();
      await suspendLapsedSubscriptions();
    } catch (e) {
      console.error('[cron] job failed:', e);
    }
  });
  console.log('Subscription renewal cron job scheduled (hourly).');
}

module.exports = { start };
