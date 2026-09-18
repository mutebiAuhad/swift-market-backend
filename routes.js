const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { signToken, requireRole } = require('./auth');
const momo = require('./momo');
const flutterwave = require('./flutterwave');
const chatbot = require('./chatbot');
const mailer = require('./mailer');
const { upload, urlFor } = require('./uploads');

const router = express.Router();

const FREE_LAUNCH_SLOTS = Number(process.env.FREE_LAUNCH_SLOTS || 10);
const WEEKLY_FEE_UGX = Number(process.env.WEEKLY_FEE_UGX || 50000);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const CONSENT_VERSION = '2026-09-1';

function publicBusiness(biz) {
  return {
    id: biz.id, name: biz.name, contact: biz.contact, email: biz.email,
    status: biz.status, freeSlot: !!biz.free_slot, chatEnabled: !!biz.chat_enabled,
    autoRenew: !!biz.auto_renew, subscriptionExpiresAt: biz.subscription_expires_at,
    profilePhotoUrl: biz.profile_photo_url,
  };
}
function publicCustomer(c) {
  return {
    id: c.id, name: c.name, email: c.email, phone: c.phone,
    profilePhotoUrl: c.profile_photo_url, marketingOptIn: !!c.marketing_opt_in,
    consentAcceptedAt: c.consent_accepted_at,
  };
}

// ============================= BUSINESS AUTH ==============================

router.post('/auth/business/register', (req, res) => {
  const { name, contact, email, recoveryEmail, password, autoRenew } = req.body || {};
  if (!name || !contact || !email || !recoveryEmail || !password || password.length < 6) {
    return res.status(400).json({ error: 'name, contact, email, recoveryEmail, and a password of 6+ characters are required' });
  }
  const existing = db.prepare('SELECT id FROM businesses WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

  const freeCount = db.prepare('SELECT COUNT(*) AS n FROM businesses WHERE free_slot = 1').get().n;
  const freeSlot = freeCount < FREE_LAUNCH_SLOTS ? 1 : 0;
  const now = Date.now();
  const expires = freeSlot ? now + 30 * WEEK_MS / 7 * 30 : now; // free slot: ~1 month grace

  const id = uuidv4();
  const passwordHash = bcrypt.hashSync(password, 10);
  db.prepare(`
    INSERT INTO businesses (id, name, contact, email, recovery_email, password_hash, status, free_slot, chat_enabled, auto_renew, subscription_expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?, ?, ?)
  `).run(id, name, contact, email, recoveryEmail, passwordHash, freeSlot, autoRenew ? 1 : 0, expires, now);

  const token = signToken({ sub: id, role: 'business' });
  res.status(201).json({ token, business: publicBusiness(db.prepare('SELECT * FROM businesses WHERE id = ?').get(id)) });
});

router.post('/auth/business/login', (req, res) => {
  const { email, password } = req.body || {};
  const biz = db.prepare('SELECT * FROM businesses WHERE email = ?').get(email);
  if (!biz || !bcrypt.compareSync(password || '', biz.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password' });
  }
  const token = signToken({ sub: biz.id, role: 'business' });
  res.json({ token, business: publicBusiness(biz) });
});

router.get('/auth/business/me', requireRole('business'), (req, res) => {
  const biz = db.prepare('SELECT * FROM businesses WHERE id = ?').get(req.user.sub);
  if (!biz) return res.status(404).json({ error: 'Not found' });
  res.json({ business: publicBusiness(biz) });
});

router.post('/auth/business/photo', requireRole('business'), upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No valid image uploaded (jpg, png, webp — 5MB max)' });
  const url = urlFor(req, req.file.filename);
  db.prepare('UPDATE businesses SET profile_photo_url = ? WHERE id = ?').run(url, req.user.sub);
  res.json({ url });
});

// Forgot password — businesses identify with the last 8 characters of their
// Business ID plus the recovery email given at registration (not their
// everyday login email), then get a one-time code emailed to that address.
router.post('/auth/business/forgot', async (req, res) => {
  const { idLast8, recoveryEmail } = req.body || {};
  if (!idLast8 || !recoveryEmail) return res.status(400).json({ error: 'idLast8 and recoveryEmail are required' });
  const biz = db.prepare(`SELECT * FROM businesses WHERE recovery_email = ? AND substr(id, -8) = ?`).get(recoveryEmail, idLast8);
  // Always respond the same way whether or not a match was found, so this
  // endpoint can't be used to guess valid business IDs or emails.
  if (biz) {
    const code = String(crypto.randomInt(100000, 999999));
    db.prepare(`
      INSERT INTO password_resets (id, account_type, account_id, code_hash, expires_at, created_at)
      VALUES (?, 'business', ?, ?, ?, ?)
    `).run(uuidv4(), biz.id, bcrypt.hashSync(code, 10), Date.now() + 15 * 60 * 1000, Date.now());
    await mailer.sendMail({
      to: recoveryEmail, subject: 'Swift Market — password reset code',
      html: `<p>Your recovery code is <strong>${code}</strong>. It expires in 15 minutes.</p>`,
    });
  }
  res.json({ ok: true, message: 'If those details match an account, a recovery code has been emailed.' });
});

router.post('/auth/business/reset', (req, res) => {
  const { idLast8, recoveryEmail, code, newPassword } = req.body || {};
  if (!idLast8 || !recoveryEmail || !code || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'idLast8, recoveryEmail, code, and a new password of 6+ characters are required' });
  }
  const biz = db.prepare(`SELECT * FROM businesses WHERE recovery_email = ? AND substr(id, -8) = ?`).get(recoveryEmail, idLast8);
  if (!biz) return res.status(400).json({ error: 'Invalid details or code' });
  const reset = db.prepare(`
    SELECT * FROM password_resets WHERE account_type = 'business' AND account_id = ? AND used = 0
    ORDER BY created_at DESC LIMIT 1
  `).get(biz.id);
  if (!reset || reset.expires_at < Date.now() || !bcrypt.compareSync(code, reset.code_hash)) {
    return res.status(400).json({ error: 'Invalid or expired code' });
  }
  db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(reset.id);
  db.prepare('UPDATE businesses SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), biz.id);
  res.json({ ok: true });
});

// ============================= CUSTOMER AUTH ===============================

router.post('/auth/customer/register', (req, res) => {
  const { name, email, phone, password, consentAccepted, marketingOptIn } = req.body || {};
  if (!name || !email || !password || password.length < 6) {
    return res.status(400).json({ error: 'name, email, and a password of 6+ characters are required' });
  }
  if (!consentAccepted) {
    return res.status(400).json({ error: 'You must accept the cookie and data-use agreement to create an account' });
  }
  const existing = db.prepare('SELECT id FROM customers WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'An account with this email already exists' });
  const id = uuidv4();
  db.prepare(`
    INSERT INTO customers (id, name, email, phone, password_hash, consent_accepted_at, consent_version, marketing_opt_in, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, email, phone || '', bcrypt.hashSync(password, 10), Date.now(), CONSENT_VERSION, marketingOptIn ? 1 : 0, Date.now());
  const token = signToken({ sub: id, role: 'customer' });
  res.status(201).json({ token, customer: publicCustomer(db.prepare('SELECT * FROM customers WHERE id = ?').get(id)) });
});

router.post('/auth/customer/login', (req, res) => {
  const { email, password } = req.body || {};
  const c = db.prepare('SELECT * FROM customers WHERE email = ?').get(email);
  if (!c || !bcrypt.compareSync(password || '', c.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password' });
  }
  const token = signToken({ sub: c.id, role: 'customer' });
  res.json({ token, customer: publicCustomer(c) });
});

router.get('/auth/customer/me', requireRole('customer'), (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.user.sub);
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json({ customer: publicCustomer(c) });
});

router.post('/auth/customer/photo', requireRole('customer'), upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No valid image uploaded (jpg, png, webp — 5MB max)' });
  const url = urlFor(req, req.file.filename);
  db.prepare('UPDATE customers SET profile_photo_url = ? WHERE id = ?').run(url, req.user.sub);
  res.json({ url });
});

router.post('/auth/customer/forgot', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email is required' });
  const c = db.prepare('SELECT * FROM customers WHERE email = ?').get(email);
  if (c) {
    const code = String(crypto.randomInt(100000, 999999));
    db.prepare(`
      INSERT INTO password_resets (id, account_type, account_id, code_hash, expires_at, created_at)
      VALUES (?, 'customer', ?, ?, ?, ?)
    `).run(uuidv4(), c.id, bcrypt.hashSync(code, 10), Date.now() + 15 * 60 * 1000, Date.now());
    await mailer.sendMail({
      to: email, subject: 'Swift Market — password reset code',
      html: `<p>Your recovery code is <strong>${code}</strong>. It expires in 15 minutes.</p>`,
    });
  }
  res.json({ ok: true, message: 'If that email has an account, a recovery code has been sent.' });
});

router.post('/auth/customer/reset', (req, res) => {
  const { email, code, newPassword } = req.body || {};
  if (!email || !code || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'email, code, and a new password of 6+ characters are required' });
  }
  const c = db.prepare('SELECT * FROM customers WHERE email = ?').get(email);
  if (!c) return res.status(400).json({ error: 'Invalid details or code' });
  const reset = db.prepare(`
    SELECT * FROM password_resets WHERE account_type = 'customer' AND account_id = ? AND used = 0
    ORDER BY created_at DESC LIMIT 1
  `).get(c.id);
  if (!reset || reset.expires_at < Date.now() || !bcrypt.compareSync(code, reset.code_hash)) {
    return res.status(400).json({ error: 'Invalid or expired code' });
  }
  db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(reset.id);
  db.prepare('UPDATE customers SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), c.id);
  res.json({ ok: true });
});

// ================================ ADMIN AUTH ==============================
// Real authentication is still email + password. The admin page itself is
// also only reachable via a secret link (see server.js /admin-panel route)
// so it isn't discoverable by browsing the site — that link should only
// ever be shared with you, by email, never posted publicly.

router.post('/admin/login', (req, res) => {
  const { email, password } = req.body || {};
  const ok = email === process.env.ADMIN_EMAIL &&
    bcrypt.compareSync(password || '', process.env.ADMIN_PASSWORD_HASH || '');
  if (!ok) return res.status(401).json({ error: 'Incorrect email or password' });
  const token = signToken({ sub: 'admin', role: 'admin' });
  res.json({ token });
});

router.get('/admin/businesses', requireRole('admin'), (req, res) => {
  const rows = db.prepare('SELECT * FROM businesses ORDER BY created_at DESC').all();
  res.json({ businesses: rows.map(b => ({ ...publicBusiness(b), fullId: b.id })) });
});

router.get('/admin/customers', requireRole('admin'), (req, res) => {
  const rows = db.prepare('SELECT * FROM customers ORDER BY created_at DESC').all();
  res.json({ customers: rows.map(publicCustomer) });
});

router.post('/admin/businesses/:id/approve', requireRole('admin'), (req, res) => {
  db.prepare(`UPDATE businesses SET status = 'active', subscription_expires_at = ? WHERE id = ?`)
    .run(Date.now() + WEEK_MS, req.params.id);
  res.json({ ok: true });
});

router.post('/admin/businesses/:id/suspend', requireRole('admin'), (req, res) => {
  db.prepare(`UPDATE businesses SET status = 'suspended' WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

router.get('/admin/payments', requireRole('admin'), (req, res) => {
  res.json({ payments: db.prepare('SELECT * FROM payments ORDER BY created_at DESC').all() });
});

router.get('/admin/orders', requireRole('admin'), (req, res) => {
  res.json({ orders: db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all() });
});

// ================================= LISTINGS ===============================

router.get('/listings', (req, res) => {
  const rows = db.prepare(`
    SELECT l.*, b.name AS business_name, b.contact AS business_contact, b.status AS business_status,
           (SELECT ROUND(AVG(rating), 1) FROM reviews WHERE business_id = b.id) AS business_rating,
           (SELECT COUNT(*) FROM reviews WHERE business_id = b.id) AS business_review_count
    FROM listings l JOIN businesses b ON b.id = l.business_id
    WHERE l.active = 1 AND b.status = 'active'
    ORDER BY l.created_at DESC
  `).all();
  res.json({ listings: rows });
});

router.get('/my/listings', requireRole('business'), (req, res) => {
  res.json({ listings: db.prepare('SELECT * FROM listings WHERE business_id = ? ORDER BY created_at DESC').all(req.user.sub) });
});

router.post('/my/listings', requireRole('business'), (req, res) => {
  const { title, price, description, stockQty } = req.body || {};
  if (!title || !price) return res.status(400).json({ error: 'title and price are required' });
  const id = uuidv4();
  db.prepare(`
    INSERT INTO listings (id, business_id, title, price, description, stock_qty, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `).run(id, req.user.sub, title, Number(price), description || '', Number(stockQty || 0), Date.now());
  res.status(201).json({ id });
});

router.patch('/my/listings/:id', requireRole('business'), (req, res) => {
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing || listing.business_id !== req.user.sub) return res.status(404).json({ error: 'Not found' });
  const { title, price, description, active, stockQty } = req.body || {};
  db.prepare(`
    UPDATE listings SET
      title = COALESCE(?, title), price = COALESCE(?, price), description = COALESCE(?, description),
      active = COALESCE(?, active), stock_qty = COALESCE(?, stock_qty)
    WHERE id = ?
  `).run(title, price, description, active === undefined ? undefined : (active ? 1 : 0), stockQty, req.params.id);
  res.json({ ok: true });
});

router.post('/my/listings/:id/photo', requireRole('business'), upload.single('photo'), (req, res) => {
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing || listing.business_id !== req.user.sub) return res.status(404).json({ error: 'Not found' });
  if (!req.file) return res.status(400).json({ error: 'No valid image uploaded (jpg, png, webp — 5MB max)' });
  const url = urlFor(req, req.file.filename);
  db.prepare('UPDATE listings SET photo_url = ? WHERE id = ?').run(url, req.params.id);
  res.json({ url });
});

router.post('/my/chat/toggle', requireRole('business'), (req, res) => {
  const { on } = req.body || {};
  db.prepare('UPDATE businesses SET chat_enabled = ? WHERE id = ?').run(on ? 1 : 0, req.user.sub);
  res.json({ ok: true });
});

router.post('/my/auto-renew', requireRole('business'), (req, res) => {
  const { on, phone } = req.body || {};
  if (on && !phone && !db.prepare('SELECT subscription_momo_phone FROM businesses WHERE id = ?').get(req.user.sub)?.subscription_momo_phone) {
    return res.status(400).json({ error: 'Provide a Mobile Money phone number to enable auto-renewal' });
  }
  if (phone) {
    db.prepare('UPDATE businesses SET auto_renew = ?, subscription_momo_phone = ? WHERE id = ?').run(on ? 1 : 0, phone, req.user.sub);
  } else {
    db.prepare('UPDATE businesses SET auto_renew = ? WHERE id = ?').run(on ? 1 : 0, req.user.sub);
  }
  res.json({ ok: true });
});

// ============================ SHOPPING ASSISTANT (BOT) =====================
// Buyers must be signed in as customers to chat or order — this keeps a
// real identity behind every booking, which protects both the buyer and
// the business if something needs to be disputed later.

router.get('/listings/:id/messages', requireRole('customer'), (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM messages WHERE listing_id = ? AND customer_id = ? ORDER BY created_at ASC LIMIT 200
  `).all(req.params.id, req.user.sub);
  res.json({ messages: rows });
});

router.post('/listings/:id/chat', requireRole('customer'), async (req, res) => {
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });
  const business = db.prepare('SELECT * FROM businesses WHERE id = ?').get(listing.business_id);
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text is required' });

  const history = db.prepare(`
    SELECT * FROM messages WHERE listing_id = ? AND customer_id = ? ORDER BY created_at ASC LIMIT 20
  `).all(req.params.id, req.user.sub);

  db.prepare(`INSERT INTO messages (id, listing_id, customer_id, sender, sender_name, text, created_at) VALUES (?, ?, ?, 'customer', ?, ?, ?)`)
    .run(uuidv4(), req.params.id, req.user.sub, 'You', text, Date.now());

  try {
    const result = await chatbot.askAboutListing({ listing, business, history, message: text });
    db.prepare(`INSERT INTO messages (id, listing_id, customer_id, sender, sender_name, text, created_at) VALUES (?, ?, ?, 'bot', 'Swift Market Assistant', ?, ?)`)
      .run(uuidv4(), req.params.id, req.user.sub, result.reply, Date.now());
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: 'The shopping assistant is unavailable right now: ' + e.message });
  }
});

// ================================= REVIEWS =================================

router.get('/businesses/:id/reviews', (req, res) => {
  const reviews = db.prepare(`
    SELECT r.*, c.name AS customer_name FROM reviews r JOIN customers c ON c.id = r.customer_id
    WHERE r.business_id = ? ORDER BY r.created_at DESC
  `).all(req.params.id);
  const avg = db.prepare('SELECT ROUND(AVG(rating), 1) AS avg, COUNT(*) AS count FROM reviews WHERE business_id = ?').get(req.params.id);
  res.json({ reviews, average: avg.avg, count: avg.count });
});

router.post('/businesses/:id/reviews', requireRole('customer'), (req, res) => {
  const { rating, comment } = req.body || {};
  const r = Number(rating);
  if (!r || r < 1 || r > 5) return res.status(400).json({ error: 'rating must be between 1 and 5' });
  // One review per customer per business — keep it simple and honest.
  const existing = db.prepare('SELECT id FROM reviews WHERE business_id = ? AND customer_id = ?').get(req.params.id, req.user.sub);
  if (existing) {
    db.prepare('UPDATE reviews SET rating = ?, comment = ?, created_at = ? WHERE id = ?').run(r, comment || '', Date.now(), existing.id);
    return res.json({ ok: true, updated: true });
  }
  db.prepare(`INSERT INTO reviews (id, business_id, customer_id, rating, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(uuidv4(), req.params.id, req.user.sub, r, comment || '', Date.now());
  res.status(201).json({ ok: true });
});

// ============================ ORDERS & CHECKOUT =============================
// Customers must sign in to order. Payment happens on Flutterwave's hosted
// page (cards, MTN MoMo, Airtel Money) so nobody but Flutterwave ever sees
// card details, and the business's share is paid out directly via their
// linked subaccount — the platform never holds customer funds.

router.post('/orders', requireRole('customer'), async (req, res) => {
  const { listingId, quantity } = req.body || {};
  const qty = Number(quantity || 1);
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(listingId);
  if (!listing || !listing.active) return res.status(404).json({ error: 'Listing not available' });
  if (listing.stock_qty < qty) return res.status(400).json({ error: 'Not enough stock available' });
  const business = db.prepare('SELECT * FROM businesses WHERE id = ?').get(listing.business_id);
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.user.sub);

  const amount = listing.price * qty;
  const orderId = uuidv4();
  const txRef = 'order_' + orderId;
  db.prepare(`
    INSERT INTO orders (id, listing_id, business_id, customer_id, quantity, amount, payment_status, flutterwave_tx_ref, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
  `).run(orderId, listingId, listing.business_id, req.user.sub, qty, amount, txRef, Date.now());

  try {
    const link = await flutterwave.createCheckout({
      txRef, amount, customerEmail: customer.email, customerName: customer.name,
      redirectUrl: `${process.env.PUBLIC_URL || ''}/order-complete.html?ref=${txRef}`,
      subaccountId: business.flutterwave_subaccount_id || undefined,
      narration: `${qty} x ${listing.title}`,
    });
    res.json({ orderId, checkoutUrl: link });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: 'Could not start checkout: ' + e.message });
  }
});

// Called after the customer returns from Flutterwave AND by Flutterwave's
// webhook — always re-verify server-side rather than trusting the redirect.
router.get('/orders/verify/:txRef', async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE flutterwave_tx_ref = ?').get(req.params.txRef);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.payment_status === 'PAID') return res.json({ status: 'PAID' });
  const { transaction_id } = req.query;
  if (!transaction_id) return res.status(400).json({ error: 'transaction_id is required' });
  try {
    const verified = await flutterwave.verifyTransaction(transaction_id);
    if (verified.status === 'successful' && verified.tx_ref === req.params.txRef && verified.amount >= order.amount) {
      const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(order.listing_id);
      db.prepare('UPDATE orders SET payment_status = ?, payment_method = ? WHERE id = ?')
        .run('PAID', verified.payment_type, order.id);
      db.prepare('UPDATE listings SET stock_qty = MAX(0, stock_qty - ?) WHERE id = ?').run(order.quantity, order.listing_id);
      return res.json({ status: 'PAID' });
    }
    res.json({ status: 'FAILED' });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: 'Could not verify payment: ' + e.message });
  }
});

router.get('/my/orders', requireRole('customer'), (req, res) => {
  res.json({ orders: db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC').all(req.user.sub) });
});
router.get('/my/business-orders', requireRole('business'), (req, res) => {
  res.json({ orders: db.prepare('SELECT * FROM orders WHERE business_id = ? ORDER BY created_at DESC').all(req.user.sub) });
});

// ============================ SUBSCRIPTION (MTN MoMo) =======================
// Business-to-platform subscription payment stays as a direct MTN MoMo
// request-to-pay (no split needed — the whole amount is the platform's fee).

router.post('/payments/subscribe', requireRole('business'), async (req, res) => {
  const biz = db.prepare('SELECT * FROM businesses WHERE id = ?').get(req.user.sub);
  if (!biz) return res.status(404).json({ error: 'Not found' });
  if (biz.free_slot) return res.status(400).json({ error: 'This business has a free launch slot — no payment needed.' });
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone is required, e.g. 2567XXXXXXXX' });
  const externalId = uuidv4();
  try {
    const referenceId = await momo.requestToPay({
      phone, amount: WEEKLY_FEE_UGX, externalId,
      payerMessage: 'Swift Market weekly subscription', payeeNote: `Subscription for ${biz.name}`,
    });
    db.prepare(`
      INSERT INTO payments (id, business_id, amount, phone, provider_reference, status, purpose, created_at)
      VALUES (?, ?, ?, ?, ?, 'PENDING', 'subscription', ?)
    `).run(uuidv4(), biz.id, WEEKLY_FEE_UGX, phone, referenceId, Date.now());
    res.json({ referenceId, message: 'Check your phone to approve the payment, then poll /payments/status/:referenceId' });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: 'Could not reach MTN MoMo. ' + e.message });
  }
});

router.get('/payments/status/:referenceId', requireRole('business'), async (req, res) => {
  const payment = db.prepare('SELECT * FROM payments WHERE provider_reference = ?').get(req.params.referenceId);
  if (!payment || payment.business_id !== req.user.sub) return res.status(404).json({ error: 'Not found' });
  try {
    const result = await momo.getTransactionStatus(req.params.referenceId);
    if (result.status === 'SUCCESSFUL' && payment.status !== 'SUCCESSFUL') {
      db.prepare(`UPDATE payments SET status = 'SUCCESSFUL' WHERE id = ?`).run(payment.id);
      db.prepare(`UPDATE businesses SET status = 'active', subscription_expires_at = ? WHERE id = ?`)
        .run(Date.now() + WEEK_MS, payment.business_id);
    } else if (result.status === 'FAILED') {
      db.prepare(`UPDATE payments SET status = 'FAILED' WHERE id = ?`).run(payment.id);
    }
    res.json({ status: result.status });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: 'Could not reach MTN MoMo. ' + e.message });
  }
});

module.exports = router;
