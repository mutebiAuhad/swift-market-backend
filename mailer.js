// mailer.js — sends real emails (password recovery codes, the admin link).
//
// Uses SMTP via nodemailer. Works with a Gmail "app password", or any
// transactional email service (SendGrid, Mailgun, Postmark, etc — just
// point SMTP_HOST/PORT/USER/PASS at whichever one you choose). Gmail's
// personal SMTP is fine for testing but has sending limits; for a real
// business, a dedicated transactional email provider is more reliable.

const nodemailer = require('nodemailer');

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

async function sendMail({ to, subject, html }) {
  const t = getTransporter();
  if (!t) {
    // No SMTP configured yet — log instead of failing, so local dev still works.
    console.log(`[mailer] SMTP not configured. Would have sent to ${to}:\nSubject: ${subject}\n${html}`);
    return { simulated: true };
  }
  return t.sendMail({
    from: process.env.SMTP_FROM || `"Swift Market" <${process.env.SMTP_USER}>`,
    to, subject, html,
  });
}

module.exports = { sendMail };
