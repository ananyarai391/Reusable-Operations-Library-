// Save as: db.js (project root)
require('dotenv').config();
const { Pool } = require('pg');

// Hosted Postgres (Neon, Supabase, Render, etc.) requires SSL; a local
// Postgres on localhost doesn't accept the same options — detect which
// one this is from the connection string itself so both keep working.
const isLocalDb = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocalDb ? false : { rejectUnauthorized: false },
});

module.exports = pool;
