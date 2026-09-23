const cron = require('node-cron');
const { prepare } = require('./db');
const { sendMail } = require('./mailer');

function startCron() {
  // Every hour: flip anyone past their subscription_expires_at to 'expired' so
  // requireActiveSubscription starts blocking them immediately, and email a
  // heads-up to anyone expiring within the next 24 hours.
  cron.schedule('0 * * * *', async () => {
    try {
      const expiring = await prepare(
        `SELECT * FROM users WHERE status = 'active' AND subscription_expires_at < now() + interval '24 hours'
         AND subscription_expires_at > now()`
      ).all();
      for (const user of expiring) {
        await sendMail({
          to: user.email,
          subject: 'Your Swift Market subscription renews soon',
          html: `<p>Hi ${user.display_name},</p><p>Your subscription expires within 24 hours. Renew from your account page to keep uploading, downloading and commenting.</p>`
        });
      }

      const result = await prepare(
        `UPDATE users SET status = 'expired' WHERE status = 'active' AND subscription_expires_at < now()`
      ).run();
      if (result.changes) console.log(`[cron] Expired ${result.changes} lapsed subscription(s).`);
    } catch (err) {
      console.error('[cron] subscription sweep failed:', err.message);
    }
  });
  console.log('[cron] Subscription expiry job scheduled (hourly).');
}

module.exports = { startCron };
