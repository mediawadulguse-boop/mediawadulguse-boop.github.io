'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { testPool } = require('./helpers.cjs');
const { prepare, importSource } = require('../lib/migration.cjs');
const { fingerprint, login } = require('../lib/auth.cjs');
const { Store } = require('../lib/store.cjs');
function source() {
  const sheets = {
    AKUN: [
      {
        id: 'A',
        username: 'Admin',
        password: 'old',
        nama: 'Admin Uji',
        role: 'SUPERADMIN',
      },
      {
        id: 'S',
        username: 'Staff',
        password: 'legacy',
        nama: 'Staf Uji',
        role: 'STAF',
      },
    ],
    BRIEF: [
      {
        id: 'B',
        judul: 'Uji 🩷',
        tanggal: '2026-11-26',
        deadline: '2026-11-27',
        jobdesk:
          '[{"petugas_id":"S","petugas":"Staf Uji","jobdesk":["Editor"]}]',
        petugas_ids: '["S"]',
        archived: 'false',
      },
    ],
    TUGAS: [
      {
        id: 'T',
        brief_id: 'B',
        petugas_id: 'S',
        petugas: 'Staf Uji',
        status: 'Proses',
      },
    ],
    SYSTEM_SETTINGS: [
      {
        key: 'staff_roster',
        value:
          '{"employment":{"S":{"status":"Resign","resigned_at":"2026-11-26"}}}',
      },
    ],
    HTML_ANALIS: [
      {
        id: 'H',
        judul: 'Dokumen',
        html_content: '<h1>Uji 🩷</h1>',
        content_sha256: fingerprint('<h1>Uji 🩷</h1>'),
      },
    ],
  };
  return {
    format: 'mwg-nimbus-export-v1',
    sheets,
    manifest: {
      counts: Object.fromEntries(
        Object.entries(sheets).map(([k, v]) => [k, v.length]),
      ),
      sha256: Object.fromEntries(
        Object.entries(sheets).map(([k, v]) => [
          k,
          fingerprint(JSON.stringify(v)),
        ]),
      ),
      html_errors: [],
    },
  };
}
test('Google export imports every mapped record and JSON field, retains IDs/legacy logins, and hashes passwords', async () => {
  const pool = await testPool();
  try {
    const input = source();
    assert(prepare(input).report.ok);
    const out = await importSource(pool, input);
    assert(out.imported);
    assert.equal(out.passwords_hashed, 2);
    assert.equal(out.records, 3);
    const b = await new Store(pool).get('briefs', 'B');
    assert.equal(b.judul, 'Uji 🩷');
    assert.equal(b.archived, false);
    assert.deepEqual(b.petugas_ids, ['S']);
    assert.equal(b.jobdesk[0].jobdesk[0], 'Editor');
    const user = (
      await pool.query(
        'SELECT password_hash,profile FROM mwg_users WHERE id=$1',
        ['A'],
      )
    ).rows[0];
    assert.match(user.password_hash, /^scrypt:/);
    assert(!user.profile.password);
    assert.equal(
      (await login(pool, { username: 'ADMIN', password: 'old' }, 'import')).user
        .nama,
      'Admin Uji',
    );
    await assert.rejects(importSource(pool, input), /kosong/);
  } finally {
    await pool.end();
  }
});
test('checksums, unknown populated sheets, missing HTML, duplicate accounts and orphan relations block import', () => {
  let input = source();
  input.sheets.BRIEF[0].judul = 'Rusak';
  assert(prepare(input).report.errors.some((x) => x.includes('Checksum')));
  input = source();
  input.sheets.UNMAPPED = [{ id: 'X' }];
  assert(prepare(input).report.errors.some((x) => x.includes('dipetakan')));
  input = source();
  delete input.sheets.HTML_ANALIS[0].html_content;
  assert(prepare(input).report.errors.some((x) => x.includes('HTML')));
  input = source();
  input.sheets.AKUN[1].username = 'admin';
  assert(
    prepare(input).report.errors.some((x) => x.includes('Username ganda')),
  );
  input = source();
  input.sheets.TUGAS[0].brief_id = 'MISSING';
  assert(prepare(input).report.orphans.length);
});
test('failed imports leave the staging database empty', async () => {
  const pool = await testPool();
  try {
    const input = source();
    input.sheets.TUGAS[0].petugas_id = 'MISSING';
    await assert.rejects(importSource(pool, input), /Validasi/);
    assert.equal(
      Number(
        (await pool.query('SELECT count(*) AS n FROM mwg_users')).rows[0].n,
      ),
      0,
    );
    assert.equal(
      Number(
        (await pool.query('SELECT count(*) AS n FROM mwg_records')).rows[0].n,
      ),
      0,
    );
  } finally {
    await pool.end();
  }
});
test('technical sync logs and all external listening sheets retain every source row', () => {
  const input = source();
  Object.assign(input.sheets, {
    SYNC_LOG: [{ cursor: 10, module: 'briefs', entity_id: 'B' }],
    MIGRATION_LOG_V142: [{ tahap: 'legacy', entity_id: 'B' }],
    LISTENING__ISSUE_CLUSTERS: [{ cluster_id: 'C', judul: 'Isu' }],
    LISTENING__RAW_ITEMS: [{ item_id: 'R' }],
    LISTENING__CUSTOM1: [{ key: 'one' }],
    LISTENING__CUSTOM2: [{ key: 'two' }],
  });
  input.manifest.counts = Object.fromEntries(
    Object.entries(input.sheets).map(([k, v]) => [k, v.length]),
  );
  const prepared = prepare(input);
  assert(prepared.report.ok);
  assert.equal(prepared.records.legacyListening.length, 2);
  assert.equal(prepared.records.listeningClusters[0].cluster_id, 'C');
  assert.equal(prepared.records.legacySyncLog[0].cursor, 10);
});
