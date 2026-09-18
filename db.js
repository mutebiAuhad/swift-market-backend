const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const db = {
  exec: async (query) => {
    const client = await pool.connect();
    try { await client.query(query); } finally { client.release(); }
  },
  prepare: (query) => {
    return {
      run: async (...params) => { return await pool.query(query, params); },
      all: async (...params) => { const res = await pool.query(query, params); return res.rows; },
      get: async (...params) => { const res = await pool.query(query, params); return res.rows[0] || null; }
    };
  }
};

module.exports = db;
