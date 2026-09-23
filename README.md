# Swift Market — Photo & Video Subscription Platform

Anyone can browse photos and videos without an account. To upload, download, or comment,
a visitor creates an account and pays a **$40/month** subscription — either instantly by
card (Stripe) or by bank transfer that you approve manually. You are the only person with
access to the admin panel.

## 1. What you need before deploying

| Service | Why | Get it at |
|---|---|---|
| Render (or similar host) | Runs the Node.js server | render.com |
| Neon (or Render's own Postgres) | Database | neon.tech |
| Cloudinary | Stores every uploaded photo/video (**required** — see note below) | cloudinary.com (free tier is fine to start) |
| Stripe | Automated card subscriptions | stripe.com |
| An SMTP provider (optional) | Password-reset emails, expiry reminders | e.g. Gmail app password, SendGrid, Resend |

**Why Cloudinary is required, not optional:** Render's disk is wiped on every restart
and redeploy. If photos/videos were saved to local disk like a normal file upload, they
would silently disappear the next time your service restarts. Cloudinary stores them
somewhere permanent instead.

## 2. Environment variables

Copy `.env.example` and fill in every value. The important ones to get right:

- **`DATABASE_URL`** — from Neon, must include `?sslmode=require`.
- **`JWT_SECRET`** — any long random string (e.g. `openssl rand -hex 32`).
- **`ADMIN_EMAIL`** / **`ADMIN_PASSWORD_HASH`** — run:
  ```
  node scripts/hash-password.js "your-chosen-password"
  ```
  and paste the output into `ADMIN_PASSWORD_HASH`.
- **`ADMIN_ACCESS_TOKEN`** — any long random string. This is the secret in your admin
  link: `https://your-app.onrender.com/admin-panel?token=THIS_VALUE`. Keep it private —
  it's not linked anywhere on the public site.
- **`CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET`** — from your
  Cloudinary dashboard's "Account Details" page.
- **`STRIPE_SECRET_KEY`** — from your Stripe dashboard (use a test key first, switch to
  live once you've tested a full payment).
- **`STRIPE_WEBHOOK_SECRET`** — after deploying, go to Stripe Dashboard → Developers →
  Webhooks → Add endpoint → point it at `https://your-app.onrender.com/api/subscription/webhook`,
  subscribe it to `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`,
  and `customer.subscription.deleted`. Stripe will show you the signing secret — that's
  this value.
- **`BLOCKED_COUNTRY_CODES`** — defaults to the East African Community (Uganda, Kenya,
  Tanzania, Rwanda, Burundi, South Sudan, DR Congo, Somalia). Change if needed.

## 3. Deploying on Render

1. Push this code to a GitHub repo.
2. Render → New → Web Service → connect the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Add every environment variable from step 2 in Render's "Environment" tab.
5. Deploy. Watch the **Logs** tab — you should see `[db] Connected to Postgres.` and
   `[server] Swift Market listening on port ...`. If you see a FATAL line instead, it
   will tell you exactly which step failed.

## 4. Setting your bank details for manual transfers

1. Visit `https://your-app.onrender.com/admin-panel?token=YOUR_ADMIN_ACCESS_TOKEN`.
2. Log in with `ADMIN_EMAIL` / your password.
3. Go to **Bank settings** and fill in your account details. These appear to users on
   their Account page as an alternative to paying by card.

## 5. Approving bank-transfer payments

When a user pays into your bank account and uploads a proof-of-payment screenshot, it
appears under **Pending payments** in the admin panel along with their note/reference.
Check it against your actual bank statement, then click **Approve** (activates their
account for 30 days) or **Reject**.

## 6. Turning on 2FA for your own admin login

In the admin panel, go to **Admin security** → **Generate 2FA secret**, scan the QR code
into Google Authenticator or Authy, then set `ADMIN_TOTP_SECRET` in Render's environment
variables to the secret shown and redeploy. From then on, every admin login requires the
6-digit code from your authenticator app in addition to your password.

## 7. How security is handled

- Passwords are hashed with bcrypt (never stored in plain text).
- All sessions use signed, expiring JWTs.
- The admin panel is not linked anywhere on the public site and requires a secret token
  in the URL just to load the login page, plus your real credentials (and optionally
  2FA) to do anything.
- Login, registration, and admin-login endpoints are rate-limited against brute-forcing.
- Downloads require an active subscription and are served via short-lived (10-minute)
  signed Cloudinary URLs rather than permanent public links.
- `helmet` sets standard protective HTTP headers; all database queries use parameterized
  placeholders (no SQL injection surface).
- The whole site is blocked at the network level for visitors whose IP resolves to a
  blocked country, before any page or API route runs.

## 8. Known limitations, honestly

- **Geo-blocking is IP-based**, which is the standard approach but is not unbeatable —
  someone using a VPN with an exit node outside the blocked countries will get through.
  This is a limitation of IP geolocation in general, not something specific to this build.
- **Right-click-saving a publicly viewable photo/video is still technically possible**,
  the same way it is on almost any website. What "download" actually gates is the
  original-quality file via the signed-URL endpoint — it doesn't watermark or otherwise
  restrict what's rendered on the page for a casual viewer. Real DRM-grade protection
  would need a much heavier video-streaming pipeline; say if you want to explore that.
- **Manual bank transfers are, by nature, manually reviewed** — there's no automatic
  proof-of-payment verification, since that depends on your specific bank.
- **Monthly bank-transfer renewals are also manual**: a user paying by bank transfer
  will need to submit a new proof each month; Stripe subscribers renew automatically.

## 9. Local development

You won't be able to fully run this without real Cloudinary/Stripe/Postgres credentials
(all three are external services), but for a quick sanity check:

```
npm install
cp .env.example .env   # fill in at least DATABASE_URL, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD_HASH, ADMIN_ACCESS_TOKEN
npm start
```
