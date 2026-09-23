const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { prepare } = require('./db');
const { signToken, optionalAuth, requireAuth, requireRole } = require('./auth');
const { upload, uploadProof, signedDownloadUrl, deleteAsset } = require('./cloudinary');
const { createCheckoutSession, constructWebhookEvent, MONTHLY_PRICE_USD, stripe } = require('./stripe');
const { sendMail } = require('./mailer');
const totp = require('./totp');

const router = express.Router();

// Wraps async route handlers so a thrown/rejected error becomes a clean 500
// instead of crashing the process.
const ah = fn => (req, res, next) => fn(req, res, next).catch(next);

function publicUser(u) {
  return {
    id: u.id, email: u.email, displayName: u.display_name, status: u.status,
    subscriptionExpiresAt: u.subscription_expires_at, createdAt: u.created_at
  };
}

function isActive(u) {
  return u.status === 'active' && u.subscription_expires_at && new Date(u.subscription_expires_at) > new Date();
}

// Loads the full user row onto req.currentUser for routes that need subscription state.
const loadUser = ah(async (req, res, next) => {
  if (!req.auth || req.auth.role !== 'user') return res.status(401).json({ error: 'Login required.' });
  const user = await prepare('SELECT * FROM users WHERE id = ?').get(req.auth.id);
  if (!user) return res.status(401).json({ error: 'Account not found.' });
  if (user.is_banned) return res.status(403).json({ error: 'This account has been suspended.' });
  req.currentUser = user;
  next();
});

const requireActiveSubscription = (req, res, next) => {
  if (!isActive(req.currentUser)) {
    return res.status(402).json({ error: 'An active subscription is required for this action.' });
  }
  next();
};

/* ---------------------------- USER AUTH ---------------------------- */

router.post('/auth/register', ah(async (req, res) => {
  const { email, password, displayName } = req.body || {};
  if (!email || !password || !displayName) return res.status(400).json({ error: 'Email, password and display name are required.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const existing = await prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) return res.status(409).json({ error: 'An account with that email already exists.' });

  const hash = await bcrypt.hash(password, 12);
  const user = await prepare(
    `INSERT INTO users (email, password_hash, display_name, status)
     VALUES (?, ?, ?, 'pending_payment') RETURNING *`
  ).get(email.toLowerCase().trim(), hash, displayName.trim());

  const token = signToken({ id: user.id, role: 'user' });
  res.status(201).json({ token, user: publicUser(user) });
}));

router.post('/auth/login', ah(async (req, res) => {
  const { email, password } = req.body || {};
  const user = await prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase().trim());
  if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  if (user.is_banned) return res.status(403).json({ error: 'This account has been suspended.' });
  const token = signToken({ id: user.id, role: 'user' });
  res.json({ token, user: publicUser(user) });
}));

router.get('/auth/me', requireAuth, loadUser, (req, res) => {
  res.json({ user: publicUser(req.currentUser), isActive: isActive(req.currentUser) });
});

router.post('/auth/forgot', ah(async (req, res) => {
  const { email } = req.body || {};
  const user = await prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase().trim());
  // Always respond the same way whether or not the account exists, to avoid leaking who has an account.
  if (user) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await prepare('INSERT INTO password_resets (user_id, code, expires_at) VALUES (?, ?, ?)').run(user.id, code, expiresAt);
    await sendMail({
      to: user.email,
      subject: 'Swift Market password reset code',
      html: `<p>Your password reset code is <b>${code}</b>. It expires in 30 minutes.</p>`
    });
  }
  res.json({ ok: true, message: 'If that email has an account, a reset code has been sent.' });
}));

router.post('/auth/reset', ah(async (req, res) => {
  const { email, code, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  const user = await prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase().trim());
  if (!user) return res.status(400).json({ error: 'Invalid code.' });
  const reset = await prepare(
    `SELECT * FROM password_resets WHERE user_id = ? AND code = ? AND used = false AND expires_at > now() ORDER BY created_at DESC LIMIT 1`
  ).get(user.id, code);
  if (!reset) return res.status(400).json({ error: 'Invalid or expired code.' });
  const hash = await bcrypt.hash(newPassword, 12);
  await prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  await prepare('UPDATE password_resets SET used = true WHERE id = ?').run(reset.id);
  res.json({ ok: true });
}));

/* ---------------------------- SUBSCRIPTION / PAYMENTS ---------------------------- */

router.get('/subscription/bank-details', ah(async (req, res) => {
  const rows = await prepare(`SELECT key, value FROM admin_settings WHERE key LIKE 'bank_%'`).all();
  const details = Object.fromEntries(rows.map(r => [r.key, r.value]));
  res.json({
    bankName: details.bank_name || null,
    accountName: details.bank_account_name || null,
    accountNumber: details.bank_account_number || null,
    swiftCode: details.bank_swift || null,
    instructions: details.bank_instructions || null,
    amountUsd: MONTHLY_PRICE_USD
  });
}));

router.post('/subscription/checkout', requireAuth, loadUser, ah(async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Card payments are not configured yet.' });
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const session = await createCheckoutSession({
    userId: req.currentUser.id,
    email: req.currentUser.email,
    successUrl: `${base}/account.html?checkout=success`,
    cancelUrl: `${base}/account.html?checkout=cancelled`
  });
  await prepare('UPDATE users SET stripe_customer_id = COALESCE(stripe_customer_id, ?) WHERE id = ?').run(session.customer, req.currentUser.id);
  res.json({ url: session.url });
}));

// Mounted with express.raw() in server.js BEFORE the json body parser, since Stripe
// requires the exact raw request body to verify the webhook signature.
router.post('/subscription/webhook', ah(async (req, res) => {
  let event;
  try {
    event = constructWebhookEvent(req.body, req.headers['stripe-signature']);
  } catch (err) {
    console.error('[stripe webhook] signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata && session.metadata.userId;
    if (userId) {
      const expiresAt = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
      await prepare(
        `UPDATE users SET status = 'active', subscription_expires_at = ?, stripe_subscription_id = ? WHERE id = ?`
      ).run(expiresAt, session.subscription, userId);
      await prepare(
        `INSERT INTO payments (user_id, amount_usd, method, status, stripe_session_id) VALUES (?, ?, 'stripe', 'completed', ?)`
      ).run(userId, MONTHLY_PRICE_USD, session.id);
    }
  }

  if (event.type === 'invoice.paid') {
    const invoice = event.data.object;
    const user = await prepare('SELECT * FROM users WHERE stripe_subscription_id = ?').get(invoice.subscription);
    if (user) {
      const expiresAt = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
      await prepare(`UPDATE users SET status = 'active', subscription_expires_at = ? WHERE id = ?`).run(expiresAt, user.id);
      await prepare(
        `INSERT INTO payments (user_id, amount_usd, method, status, stripe_invoice_id) VALUES (?, ?, 'stripe', 'completed', ?)`
      ).run(user.id, MONTHLY_PRICE_USD, invoice.id);
    }
  }

  if (event.type === 'invoice.payment_failed' || event.type === 'customer.subscription.deleted') {
    const obj = event.data.object;
    const subId = obj.subscription || obj.id;
    await prepare(`UPDATE users SET status = 'expired' WHERE stripe_subscription_id = ?`).run(subId);
  }

  res.json({ received: true });
}));

router.post('/subscription/bank-transfer', requireAuth, loadUser, uploadProof.single('proof'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Please attach a screenshot or photo of your payment proof.' });
  await prepare(
    `INSERT INTO payments (user_id, amount_usd, method, status, proof_file_url, reference_note)
     VALUES (?, ?, 'bank_transfer', 'pending', ?, ?)`
  ).run(req.currentUser.id, MONTHLY_PRICE_USD, req.file.path, (req.body && req.body.note) || null);
  res.status(201).json({ ok: true, message: 'Payment submitted. Your account will be activated once the administrator verifies it.' });
}));

router.get('/subscription/status', requireAuth, loadUser, (req, res) => {
  res.json({ status: req.currentUser.status, isActive: isActive(req.currentUser), expiresAt: req.currentUser.subscription_expires_at });
});

/* ---------------------------- MEDIA ---------------------------- */

router.get('/media', optionalAuth, ah(async (req, res) => {
  const type = ['photo', 'video'].includes(req.query.type) ? req.query.type : null;
  const limit = Math.min(Number(req.query.limit) || 24, 60);
  const offset = Number(req.query.offset) || 0;
  const rows = type
    ? await prepare(
        `SELECT m.*, u.display_name AS uploader_name FROM media m JOIN users u ON u.id = m.user_id
         WHERE m.type = ? ORDER BY m.created_at DESC LIMIT ? OFFSET ?`
      ).all(type, limit, offset)
    : await prepare(
        `SELECT m.*, u.display_name AS uploader_name FROM media m JOIN users u ON u.id = m.user_id
         ORDER BY m.created_at DESC LIMIT ? OFFSET ?`
      ).all(limit, offset);
  res.json({ media: rows });
}));

router.get('/media/:id', optionalAuth, ah(async (req, res) => {
  const item = await prepare(
    `SELECT m.*, u.display_name AS uploader_name FROM media m JOIN users u ON u.id = m.user_id WHERE m.id = ?`
  ).get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found.' });
  await prepare('UPDATE media SET views_count = views_count + 1 WHERE id = ?').run(item.id);
  const comments = await prepare(
    `SELECT c.*, u.display_name AS author_name FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.media_id = ? ORDER BY c.created_at ASC`
  ).all(item.id);
  res.json({ media: item, comments });
}));

router.post('/media', requireAuth, loadUser, requireActiveSubscription, upload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received.' });
  const isVideo = req.file.mimetype.startsWith('video/');
  const item = await prepare(
    `INSERT INTO media (user_id, type, file_url, public_id, thumbnail_url, title, description)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`
  ).get(
    req.currentUser.id, isVideo ? 'video' : 'photo', req.file.path, req.file.filename,
    isVideo ? req.file.path.replace(/\.\w+$/, '.jpg') : req.file.path,
    (req.body && req.body.title) || 'Untitled', (req.body && req.body.description) || null
  );
  res.status(201).json({ media: item });
}));

router.get('/media/:id/download', requireAuth, loadUser, requireActiveSubscription, ah(async (req, res) => {
  const item = await prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found.' });
  const url = signedDownloadUrl(item.public_id, item.type === 'video' ? 'video' : 'image');
  await prepare('UPDATE media SET downloads_count = downloads_count + 1 WHERE id = ?').run(item.id);
  res.json({ url });
}));

router.delete('/media/:id', requireAuth, loadUser, ah(async (req, res) => {
  const item = await prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found.' });
  if (item.user_id !== req.currentUser.id) return res.status(403).json({ error: 'Not authorized.' });
  await deleteAsset(item.public_id, item.type === 'video' ? 'video' : 'image');
  await prepare('DELETE FROM media WHERE id = ?').run(item.id);
  res.json({ ok: true });
}));

/* ---------------------------- COMMENTS ---------------------------- */

router.post('/media/:id/comments', requireAuth, loadUser, requireActiveSubscription, ah(async (req, res) => {
  const { content } = req.body || {};
  if (!content || !content.trim()) return res.status(400).json({ error: 'Comment cannot be empty.' });
  const media = await prepare('SELECT id FROM media WHERE id = ?').get(req.params.id);
  if (!media) return res.status(404).json({ error: 'Media not found.' });
  const comment = await prepare(
    `INSERT INTO comments (media_id, user_id, content) VALUES (?, ?, ?) RETURNING *`
  ).get(req.params.id, req.currentUser.id, content.trim().slice(0, 2000));
  res.status(201).json({ comment: { ...comment, author_name: req.currentUser.display_name } });
}));

router.delete('/comments/:id', requireAuth, loadUser, ah(async (req, res) => {
  const comment = await prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!comment) return res.status(404).json({ error: 'Not found.' });
  if (comment.user_id !== req.currentUser.id) return res.status(403).json({ error: 'Not authorized.' });
  await prepare('DELETE FROM comments WHERE id = ?').run(comment.id);
  res.json({ ok: true });
}));

/* ---------------------------- ADMIN ---------------------------- */

router.post('/admin/login', ah(async (req, res) => {
  const { email, password, totpToken } = req.body || {};
  if (email !== process.env.ADMIN_EMAIL) return res.status(401).json({ error: 'Incorrect email or password.' });
  const ok = await bcrypt.compare(password || '', process.env.ADMIN_PASSWORD_HASH || '');
  if (!ok) return res.status(401).json({ error: 'Incorrect email or password.' });

  if (process.env.ADMIN_TOTP_SECRET) {
    if (!totpToken || !totp.verifyToken(process.env.ADMIN_TOTP_SECRET, totpToken)) {
      return res.status(401).json({ error: 'Invalid or missing 2FA code.' });
    }
  }
  const token = signToken({ id: 'admin', role: 'admin' }, '12h');
  res.json({ token });
}));

router.get('/admin/me', requireAuth, requireRole('admin'), (req, res) => res.json({ ok: true }));

router.get('/admin/settings', requireAuth, requireRole('admin'), ah(async (req, res) => {
  const rows = await prepare('SELECT key, value FROM admin_settings').all();
  res.json({ settings: Object.fromEntries(rows.map(r => [r.key, r.value])) });
}));

router.put('/admin/settings', requireAuth, requireRole('admin'), ah(async (req, res) => {
  const allowed = ['bank_name', 'bank_account_name', 'bank_account_number', 'bank_swift', 'bank_instructions'];
  const updates = req.body || {};
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      await prepare(
        `INSERT INTO admin_settings (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
      ).run(key, String(updates[key]));
    }
  }
  res.json({ ok: true });
}));

router.get('/admin/payments', requireAuth, requireRole('admin'), ah(async (req, res) => {
  const status = req.query.status || 'pending';
  const rows = await prepare(
    `SELECT p.*, u.email, u.display_name FROM payments p JOIN users u ON u.id = p.user_id
     WHERE p.status = ? ORDER BY p.created_at DESC`
  ).all(status);
  res.json({ payments: rows });
}));

router.post('/admin/payments/:id/approve', requireAuth, requireRole('admin'), ah(async (req, res) => {
  const payment = await prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
  if (!payment) return res.status(404).json({ error: 'Not found.' });
  const expiresAt = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
  await prepare(`UPDATE users SET status = 'active', subscription_expires_at = ? WHERE id = ?`).run(expiresAt, payment.user_id);
  await prepare(`UPDATE payments SET status = 'approved', reviewed_by = 'admin', reviewed_at = now() WHERE id = ?`).run(payment.id);
  res.json({ ok: true });
}));

router.post('/admin/payments/:id/reject', requireAuth, requireRole('admin'), ah(async (req, res) => {
  await prepare(`UPDATE payments SET status = 'rejected', reviewed_by = 'admin', reviewed_at = now() WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
}));

router.get('/admin/users', requireAuth, requireRole('admin'), ah(async (req, res) => {
  const rows = await prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  res.json({ users: rows.map(publicUser).map((u, i) => ({ ...u, isBanned: rows[i].is_banned })) });
}));

router.post('/admin/users/:id/ban', requireAuth, requireRole('admin'), ah(async (req, res) => {
  await prepare('UPDATE users SET is_banned = true WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

router.post('/admin/users/:id/unban', requireAuth, requireRole('admin'), ah(async (req, res) => {
  await prepare('UPDATE users SET is_banned = false WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

router.get('/admin/media', requireAuth, requireRole('admin'), ah(async (req, res) => {
  const rows = await prepare(
    `SELECT m.*, u.display_name AS uploader_name, u.email AS uploader_email FROM media m
     JOIN users u ON u.id = m.user_id ORDER BY m.created_at DESC LIMIT 200`
  ).all();
  res.json({ media: rows });
}));

router.delete('/admin/media/:id', requireAuth, requireRole('admin'), ah(async (req, res) => {
  const item = await prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found.' });
  await deleteAsset(item.public_id, item.type === 'video' ? 'video' : 'image');
  await prepare('DELETE FROM media WHERE id = ?').run(item.id);
  res.json({ ok: true });
}));

router.delete('/admin/comments/:id', requireAuth, requireRole('admin'), ah(async (req, res) => {
  await prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

router.get('/admin/stats', requireAuth, requireRole('admin'), ah(async (req, res) => {
  const [{ count: totalUsers }] = await prepare('SELECT COUNT(*)::int AS count FROM users').all();
  const [{ count: activeUsers }] = await prepare(
    `SELECT COUNT(*)::int AS count FROM users WHERE status = 'active' AND subscription_expires_at > now()`
  ).all();
  const [{ count: pendingPayments }] = await prepare(`SELECT COUNT(*)::int AS count FROM payments WHERE status = 'pending'`).all();
  const [{ count: totalMedia }] = await prepare('SELECT COUNT(*)::int AS count FROM media').all();
  const [{ sum: revenue }] = await prepare(`SELECT COALESCE(SUM(amount_usd),0)::float AS sum FROM payments WHERE status IN ('completed','approved')`).all();
  res.json({ totalUsers, activeUsers, pendingPayments, totalMedia, revenueUsd: revenue });
}));

router.get('/admin/totp/setup', requireAuth, requireRole('admin'), ah(async (req, res) => {
  const secret = totp.generateSecret();
  const qr = await totp.secretToQrDataUrl(secret.otpauth_url);
  // Not persisted here on purpose — admin must put ADMIN_TOTP_SECRET into env vars
  // themselves after scanning, so the secret is never stored in the database.
  res.json({ base32: secret.base32, qr });
}));

module.exports = router;
