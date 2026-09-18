// db.js — SQLite storage for Swift Market.
//
// SQLite is used here because it's file-based and simple to run on a small
// VPS or a single Render/Railway instance. IMPORTANT: many free hosting
// tiers wipe local disk on every deploy or restart. Before you go live with
// real customers, either (a) attach a persistent disk on your host, or
// (b) swap this file for a Postgres connection (the query shapes below are
// close enough to Postgres that the rest of the app won't need to change
// much). This file is the only place that touches the database directly.

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database('/data/swiftmarket.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS businesses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    contact TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    recovery_email TEXT,
    password_hash TEXT NOT NULL,
    profile_photo_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending',   -- pending | active | suspended
    free_slot INTEGER NOT NULL DEFAULT 0,
    chat_enabled INTEGER NOT NULL DEFAULT 0,
    auto_renew INTEGER NOT NULL DEFAULT 0,
    subscription_expires_at INTEGER,
    subscription_momo_phone TEXT,          -- phone charged automatically on renewal
    renewal_reminder_sent_at INTEGER,
    flutterwave_subaccount_id TEXT,       -- set once the business links a payout account
    payout_momo_phone TEXT,
    payout_airtel_phone TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    password_hash TEXT NOT NULL,
    profile_photo_url TEXT,
    consent_accepted_at INTEGER,          -- cookie / data-use agreement
    consent_version TEXT,
    marketing_opt_in INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS listings (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    title TEXT NOT NULL,
    price INTEGER NOT NULL,
    description TEXT,
    stock_qty INTEGER NOT NULL DEFAULT 0,
    photo_url TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES listings(id),
    business_id TEXT NOT NULL REFERENCES businesses(id),
    customer_id TEXT NOT NULL REFERENCES customers(id),
    quantity INTEGER NOT NULL DEFAULT 1,
    amount INTEGER NOT NULL,
    payment_method TEXT,                  -- card | mtn_momo | airtel_money
    payment_status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | PAID | FAILED
    flutterwave_tx_ref TEXT,
    booking_status TEXT NOT NULL DEFAULT 'BOOKED',  -- BOOKED | CONFIRMED | CANCELLED
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    customer_id TEXT NOT NULL REFERENCES customers(id),
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES listings(id),
    customer_id TEXT,
    sender TEXT NOT NULL,          -- 'customer' | 'bot' | 'business'
    sender_name TEXT,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    amount INTEGER NOT NULL,
    phone TEXT NOT NULL,
    provider_reference TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | SUCCESSFUL | FAILED
    purpose TEXT NOT NULL DEFAULT 'subscription', -- subscription | chat_addon
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    id TEXT PRIMARY KEY,
    account_type TEXT NOT NULL,     -- 'customer' | 'business'
    account_id TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
`);

module.exports = db;
