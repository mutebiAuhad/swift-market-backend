# Swift Market — backend

A real, deployable marketplace: businesses register and subscribe, list
products with photos and stock counts, get an AI shopping assistant on
each listing, and customers browse, chat, review, and pay by card, MTN
Mobile Money, or Airtel Money through Flutterwave's secure checkout.

## 1. Install

```bash
npm install
cp .env.example .env
```

Fill in `.env` — every value is explained inline. You will need accounts
with the following before things fully work (the app runs and shows
sensible errors if any of these are missing, so you can set it up
gradually):

| Need | Where to get it | Powers |
|---|---|---|
| SMTP credentials | A Gmail "app password" or a provider like SendGrid | Password recovery emails, the admin link |
| MTN MoMo Collections API keys | https://momodeveloper.mtn.com | Business subscription payments |
| Flutterwave secret key | https://dashboard.flutterwave.com | Customer checkout: cards, MTN MoMo, Airtel Money |
| Anthropic API key | https://console.anthropic.com | The shopping assistant chatbot |

Generate the two secrets:
```bash
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 24   # ADMIN_ACCESS_TOKEN
node -e "console.log(require('bcryptjs').hashSync('YourStrongPassword123', 10))"   # ADMIN_PASSWORD_HASH
```

## 2. Run locally

```bash
npm start
```
Visit http://localhost:3000. The admin panel is at
`http://localhost:3000/admin-panel?token=YOUR_ADMIN_ACCESS_TOKEN` — it
returns a plain 404 without the correct token, by design.

Once `PUBLIC_URL`, `ADMIN_ACCESS_TOKEN`, and SMTP are set, email yourself
the admin link instead of copying it manually:
```bash
node scripts/send-admin-link.js
```

## 3. Deploy it for real

You said you're comfortable deploying yourself, so in short:

1. **Push this folder to a GitHub repo** (private is fine).
2. **Host it** — Render.com or Railway.app both have a free/cheap tier
   that runs a Node app from a GitHub repo in a few clicks. Set every
   variable from `.env` in their dashboard's environment settings (never
   commit your real `.env`).
3. **Persistent storage matters**: SQLite (`swiftmarket.db`) and uploaded
   photos live on local disk. Most free hosting tiers wipe local disk on
   every redeploy. Before real customers show up, either:
   - attach a persistent volume/disk on your host (Render and Railway
     both offer this for a small monthly fee), or
   - move `db.js` to Postgres (the query style here translates closely)
     and move `uploads.js` to an S3-compatible bucket (Cloudinary,
     Backblaze B2, or AWS S3 all work and have generous free tiers).
4. **Buy your domain** and point its DNS at your host (an A record or
   CNAME, per your host's instructions), then set `PUBLIC_URL` to match.
5. **Switch MTN MoMo and Flutterwave from sandbox/test to live keys**
   once you're ready to accept real money — both require your business
   registration documents for approval, which takes MTN in particular a
   few business days.

## 4. How money moves (and why it's set up this way)

- **Business → platform (subscription)**: direct MTN MoMo request-to-pay.
  The business approves on their own phone; nothing but the fee moves.
- **Customer → business (an order)**: Flutterwave's hosted checkout page.
  The customer never gives their card or mobile money PIN to Swift
  Market's own server — only to Flutterwave, which is a licensed payment
  processor. If a business is linked as a Flutterwave "subaccount" (see
  `flutterwave.js`), their share of the sale is paid out to them directly
  and automatically; the platform's commission (`PLATFORM_COMMISSION_PERCENT`
  in `.env`) is kept automatically too. This is the standard, safer
  pattern for a marketplace — money never sits in one party's personal
  account waiting to be manually forwarded.
- Every payment is **re-verified server-side** with the provider before
  an order is marked paid — the code never trusts a redirect URL alone,
  since that could be faked.

## 5. Legal and compliance — read this before launch

This code handles the mechanics; it does not replace legal advice.
Before accepting real customers and real money:

- **Terms of Service and a full Privacy Policy**, reviewed by a lawyer
  familiar with Uganda's **Data Protection and Privacy Act, 2019**. The
  in-app notice (`showPolicy()` in `app.js`) is a plain-language summary
  only.
- **Consumer protection**: Uganda's Consumer Protection Act and general
  contract law will apply to what businesses sell through you — consider
  who is liable if a product is faked, damaged, or never delivered, and
  say so clearly in your terms.
- **KYC on businesses**: consider requiring a national ID or business
  registration certificate before activating a business, so the platform
  can respond if a business defrauds customers.
- **Data you now hold**: names, emails, phone numbers, photos, and
  payment references for every customer and business. Under Uganda's
  law you're expected to register as a data controller with the
  Personal Data Protection Office and to state clearly what you use the
  data for — the consent banner and registration checkbox here give you
  the technical hook, but the actual data-use description in
  `showPolicy()` should be adapted to what your business genuinely
  does with the data (a lawyer should sign off on it).

## 6. What's still a placeholder

- **Auto-renewal charging**: the `auto_renew` flag and
  `subscription_expires_at` field are tracked, but there's no scheduled
  job that automatically charges a saved payment method yet — MTN MoMo
  requires the payer to approve each request-to-pay on their phone, so
  "automatic" renewal in practice means the business gets a reminder
  and a one-tap approval, not a silent charge. A `node-cron` job that
  checks for expiring subscriptions and fires a fresh `requestToPay`
  a day before expiry is a reasonable next addition.
- **Image storage**: local disk, as noted above — fine for testing, not
  for production traffic.
