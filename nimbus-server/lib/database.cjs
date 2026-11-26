'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

function database() {
  if (!process.env.DATABASE_URL)
    throw new Error('DATABASE_URL belum dikonfigurasi.');
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Math.max(1, Math.min(10, Number(process.env.PG_POOL_MAX) || 3)),
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
  });
}

async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('media-wadul-write'))",
    );
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { database, transaction };
