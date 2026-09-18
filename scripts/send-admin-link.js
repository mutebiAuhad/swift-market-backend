// scripts/send-admin-link.js
// Run this once after deploying (and again any time you rotate the token):
//   node scripts/send-admin-link.js
// It emails your one, secret admin panel link to ADMIN_EMAIL. Don't post
// this link anywhere public — anyone with it can reach the admin login form
// (they'd still need the admin email + password to actually get in, but
// the link itself should stay private).

require('dotenv').config();
const mailer = require('../mailer');

async function main() {
  if (!process.env.ADMIN_ACCESS_TOKEN) {
    console.error('Set ADMIN_ACCESS_TOKEN in your .env first (a long random string — try `openssl rand -hex 24`).');
    process.exit(1);
  }
  if (!process.env.PUBLIC_URL) {
    console.error('Set PUBLIC_URL in your .env first, e.g. https://swiftmarket.ug');
    process.exit(1);
  }
  const link = `${process.env.PUBLIC_URL}/admin-panel?token=${process.env.ADMIN_ACCESS_TOKEN}`;
  await mailer.sendMail({
    to: process.env.ADMIN_EMAIL,
    subject: 'Your Swift Market admin link',
    html: `<p>Your private admin panel link:</p><p><a href="${link}">${link}</a></p><p>Keep this link to yourself.</p>`,
  });
  console.log('Sent (or logged, if SMTP is not yet configured). Link:', link);
}

main();
