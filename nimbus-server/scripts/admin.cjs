'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { database, transaction } = require('../lib/database.cjs');
const { passwordHash, fingerprint } = require('../lib/auth.cjs');
const migration = require('../lib/migration.cjs');
const { id, now } = require('../lib/store.cjs');
async function main() {
  const [command, file, ...flags] = process.argv.slice(2);
  if (command === 'verify') {
    const source = await migration.readSource(file),
      out = migration.prepare(source).report;
    console.log(JSON.stringify(out, null, 2));
    if (!out.ok) process.exitCode = 1;
    return;
  }
  const pool = database();
  try {
    if (command === 'migrate') {
      await pool.query(
        await fs.readFile(path.join(__dirname, '..', 'schema.sql'), 'utf8'),
      );
      console.log('Schema PostgreSQL tersedia.');
    } else if (command === 'bootstrap') {
      // Pass a private JSON file, never the password as an argument or environment log.
      const input = JSON.parse(await fs.readFile(file, 'utf8')),
        hash = await passwordHash(input.password),
        user = {
          id: id('ACC'),
          username: String(input.username).trim().toLowerCase(),
          nama: input.nama || 'Administrator',
          role: 'SUPERADMIN',
          created_at: now(),
        };
      await transaction(pool, async (db) => {
        const old = await db.query('SELECT id FROM mwg_users LIMIT 1');
        if (old.rows.length)
          throw new Error('Bootstrap hanya pada database tanpa akun.');
        await db.query(
          'INSERT INTO mwg_users(id,username,password_hash,profile) VALUES($1,$2,$3,$4::jsonb)',
          [user.id, user.username, hash, JSON.stringify(user)],
        );
      });
      console.log(
        'Akun administrator dibuat. Hapus file kredensial bootstrap.',
      );
    } else if (command === 'import')
      console.log(
        JSON.stringify(
          await migration.importSource(pool, await migration.readSource(file), {
            allowOrphans: flags.includes('--allow-orphans'),
          }),
          null,
          2,
        ),
      );
    else if (command === 'maintenance') {
      await pool.query('DELETE FROM mwg_sessions WHERE expires_at<now()');
      await pool.query('DELETE FROM mwg_login_attempts WHERE reset_at<now()');
      await pool.query(
        "DELETE FROM mwg_requests WHERE created_at<now()-interval '30 days'",
      );
      await pool.query(
        "DELETE FROM mwg_changes WHERE created_at<now()-interval '30 days'",
      );
      await pool.query(
        "DELETE FROM mwg_jobs WHERE state='done' AND created_at<now()-interval '7 days'",
      );
      await pool.query(
        "DELETE FROM mwg_records WHERE collection='aiRequests' AND data->>'created_at'<$1",
        [new Date(Date.now() - 7 * 86400000).toISOString()],
      );
      console.log('Data sesi dan antrean kedaluwarsa dibersihkan.');
    } else if (command === 'export' || command === 'backup')
      console.log(
        JSON.stringify(
          await migration.backup(pool, file ? { directory: file } : {}),
          null,
          2,
        ),
      );
    else if (command === 'restore') {
      const expected = (await fs.readFile(file + '.sha256', 'utf8')).split(
          /\s+/,
        )[0],
        actual = fingerprint(await fs.readFile(file));
      if (expected !== actual)
        throw new Error('Checksum backup berbeda. Restore dibatalkan.');
      console.log(
        JSON.stringify(
          await migration.restoreDatabase(
            pool,
            await migration.readSource(file),
          ),
          null,
          2,
        ),
      );
    } else
      throw new Error(
        'Perintah: migrate | verify FILE | bootstrap FILE | import FILE [--allow-orphans] | backup [DIR] | restore FILE',
      );
  } finally {
    await pool.end();
  }
}
if (require.main === module)
  main().catch((e) => {
    console.error(
      e.status
        ? e.message
        : 'Operasi gagal: ' +
            (e.code || e.name) +
            '. Periksa konfigurasi dan akses database.',
    );
    process.exitCode = 1;
  });
module.exports = { main };
