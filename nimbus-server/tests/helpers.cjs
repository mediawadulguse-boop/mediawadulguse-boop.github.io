'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { passwordHash } = require('../lib/auth.cjs');
async function testPool() {
  const pg = new PGlite();
  let tail = Promise.resolve();
  async function lock() {
    const before = tail;
    let release;
    tail = new Promise((resolve) => (release = resolve));
    await before;
    return release;
  }
  async function query(sql, args) {
    if (/^SELECT pg_advisory_xact_lock/.test(sql)) return { rows: [{}] };
    if (!args && sql.includes(';') && /^BEGIN;/.test(sql)) return pg.exec(sql);
    return pg.query(sql, args);
  }
  const pool = {
    async connect() {
      const release = await lock();
      return { query, release };
    },
    async query(sql, args) {
      const release = await lock();
      try {
        return await query(sql, args);
      } finally {
        release();
      }
    },
    async end() {
      await pg.close();
    },
  };
  await pool.query(
    await fs.readFile(path.join(__dirname, '..', 'schema.sql'), 'utf8'),
  );
  return pool;
}
async function addUser(pool, role = 'SUPERADMIN', key = role) {
  const profile = {
    id: key,
    username: key.toLowerCase(),
    nama: 'Pengguna ' + key,
    role,
  };
  await pool.query(
    'INSERT INTO mwg_users(id,username,password_hash,profile) VALUES($1,$2,$3,$4::jsonb)',
    [
      key,
      profile.username,
      await passwordHash('example-Password-123'),
      JSON.stringify(profile),
    ],
  );
  return profile;
}
module.exports = { testPool, addUser };
