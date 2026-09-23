const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL is not set.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : (process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false)
});

// Neon (and most serverless Postgres) will drop idle connections. Without this handler,
// an idle-connection error becomes an unhandled 'error' event on the pool and crashes
// the whole Node process. This keeps the process alive; the pool reconnects on next query.
pool.on('error', (err) => {
  console.error('[db] Unexpected idle client error (handled, process kept alive):', err.message);
});

// Converts SQLite-style `?` placeholders to Postgres `$1, $2...` and exposes a
// prepare().get/all/run() shim so route code reads the same as it did on SQLite.
function toPgParams(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function prepare(sql) {
  const pgSql = toPgParams(sql);
  return {
    async get(...params) {
      const res = await queryWithRetry(pgSql, params);
      return res.rows[0] || null;
    },
    async all(...params) {
      const res = await queryWithRetry(pgSql, params);
      return res.rows;
    },
    async run(...params) {
      const res = await queryWithRetry(pgSql, params);
      return { changes: res.rowCount, rows: res.rows };
    }
  };
}

async function queryWithRetry(sql, params, attempt = 1) {
  try {
    return await pool.query(sql, params);
  } catch (err) {
    const transient = ['ECONNRESET', 'ETIMEDOUT', '57P01', '08006', '08003'].includes(err.code);
    if (transient && attempt < 3) {
      await new Promise(r => setTimeout(r, attempt * 300));
      return queryWithRetry(sql, params, attempt + 1);
    }
    throw err;
  }
}

async function connectWithRetry(maxAttempts = 8) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await pool.query('SELECT 1');
      console.log('[db] Connected to Postgres.');
      return;
    } catch (err) {
      console.error(`[db] Connection attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
      if (attempt === maxAttempts) throw err;
      await new Promise(r => setTimeout(r, Math.min(1000 * attempt, 5000)));
    }
  }
}

async function migrate() {
  await connectWithRetry();
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_payment',
      subscription_expires_at TIMESTAMPTZ,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      is_banned BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      amount_usd NUMERIC NOT NULL,
      method TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      stripe_session_id TEXT,
      stripe_invoice_id TEXT,
      proof_file_url TEXT,
      reference_note TEXT,
      reviewed_by TEXT,
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS media (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      file_url TEXT NOT NULL,
      public_id TEXT NOT NULL,
      thumbnail_url TEXT,
      title TEXT,
      description TEXT,
      views_count INTEGER NOT NULL DEFAULT 0,
      downloads_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      media_id UUID REFERENCES media(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS admin_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log('[db] Migration complete.');
}

module.exports = { pool, prepare, migrate, connectWithRetry };
