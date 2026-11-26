'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const gzip = promisify(zlib.gzip),
  gunzip = promisify(zlib.gunzip);
const { Store, COLLECTIONS, id, now, clean } = require('./store.cjs');
const {
  passwordHash,
  publicProfile,
  fingerprint,
  error,
} = require('./auth.cjs');
const { transaction } = require('./database.cjs');
const { array, parse } = require('./domain.cjs');
const SHEETS = {
  LISTENING__ISSUE_CLUSTERS: 'listeningClusters',
  LISTENING__DAILY_DIGEST: 'listeningDigests',
  LISTENING__RAW_ITEMS: 'listeningRawItems',
  LISTENING__DAILY_EXECUTIVE: 'listeningExecutive',
  SYNC_LOG: 'legacySyncLog',
  MIGRATION_LOG_V142: 'legacyMigrationLog',
  AKUN: 'accounts',
  BRIEF: 'briefs',
  TUGAS: 'tasks',
  HOT_ISSUE: 'hotIssues',
  HOT_ISSUE_DAILY: 'hotDaily',
  HOT_ISSUE_WEEKLY: 'hotWeekly',
  RAPAT: 'meetings',
  VERSION_HISTORY: 'briefHistory',
  TEMPLATE_BRIEF: 'templates',
  NOTIFIKASI: 'notifications',
  ACTIVITY_LOG: 'activity',
  ACTIVITY_LOG_ARCHIVE: 'activityArchive',
  VERSION_HISTORY_ARCHIVE: 'briefHistoryArchive',
  NOTIFIKASI_ARCHIVE: 'notificationsArchive',
  HTML_ANALIS: 'htmlDocuments',
  FOOTAGE: 'footages',
  ERROR_LOG: 'errorLogs',
  CONTENT_LINKS: 'contentLinks',
  INSIGHT_SNAPSHOT: 'insightSnapshots',
  COMMENT_CAPTURE: 'commentCaptures',
  COMMENT_ANALYSIS_RUN: 'commentAnalyses',
  AI_RULES: 'aiRules',
  AI_EXAMPLES: 'aiExamples',
  AI_FEEDBACK: 'aiFeedback',
  AI_PROMPT_VERSIONS: 'aiPromptVersions',
  CONTENT_PILLARS: 'contentPillars',
  MASTER_PROMPTS: 'masterPrompts',
  SYSTEM_SETTINGS: 'settings',
};
const JSON_FIELDS = new Set([
  'target_audience',
  'petugas',
  'petugas_ids',
  'jobdesk',
  'peralatan',
  'wa_sent_status',
  'opd_support',
  'entities_json',
  'read_by',
  'last_metrics',
  'last_metadata',
  'metrics',
  'raw_data',
  'metric_evidence',
  'audit_summary',
  'comments_json',
  'sentiment_summary',
  'intent_summary',
  'topics',
  'recommendations',
  'limitations',
  'raw_result',
  'tags',
  'required_sections',
  'key_findings',
  'priority_issues',
  'stats_json',
  'source_ids',
  'top_topics',
  'opd_stats',
  'entity_stats',
  'alerts',
  'permissions',
]);
function prepare(source) {
  if (
    source.format !== 'mwg-nimbus-export-v1' ||
    !source.sheets ||
    typeof source.sheets !== 'object'
  )
    throw error(
      'Gunakan hasil exportForNimbus(), format mwg-nimbus-export-v1.',
    );
  const records = {},
    accounts = [],
    settings = [],
    errors = [],
    counts = {},
    ids = new Map();
  for (const [sheet, rows] of Object.entries(source.sheets)) {
    if (!Array.isArray(rows)) throw error('Sheet tidak valid: ' + sheet);
    if (!Object.hasOwn(SHEETS, sheet) && !sheet.startsWith('LISTENING__')) {
      if (rows.length) errors.push('Sheet belum dipetakan: ' + sheet);
      continue;
    }
    const collection =
      SHEETS[sheet] ||
      (sheet.startsWith('LISTENING__') ? 'legacyListening' : '');
    counts[sheet] = rows.length;
    if (source.manifest?.counts?.[sheet] !== rows.length)
      errors.push('Jumlah baris berbeda: ' + sheet);
    if (
      source.manifest?.sha256?.[sheet] &&
      fingerprint(JSON.stringify(rows)) !== source.manifest.sha256[sheet]
    )
      errors.push('Checksum sheet berbeda: ' + sheet);
    if (collection === 'settings') {
      for (const r of rows) {
        if (!r.key) {
          errors.push('Key pengaturan kosong.');
          continue;
        }
        settings.push({ key: String(r.key), value: parse(r.value, {}) });
      }
      continue;
    }
    const mapped = [];
    if (!ids.has(collection)) ids.set(collection, new Set());
    for (let i = 0; i < rows.length; i++) {
      const row = { ...rows[i] };
      for (const key of JSON_FIELDS)
        if (typeof row[key] === 'string' && /^[\[{]/.test(row[key].trim()))
          row[key] = parse(row[key], row[key]);
      if (sheet.startsWith('LISTENING__') && row.id) row.legacy_id = row.id;
      const key = String(
        sheet.startsWith('LISTENING__')
          ? sheet + '-' + (i + 2)
          : row.id ||
              (collection.startsWith('legacy')
                ? sheet + '-' + (i + 2)
                : collection === 'hotDaily' && row.date
                  ? 'DAILY-' + row.date
                  : collection === 'hotWeekly' && row.week_start
                    ? 'WEEK-' + row.week_start
                    : ''),
      );
      if (!key) {
        errors.push(sheet + ' baris ' + (i + 2) + ' tidak memiliki ID.');
        continue;
      }
      if (ids.get(collection).has(key))
        errors.push('ID ganda: ' + sheet + '/' + key);
      ids.get(collection).add(key);
      row.id = key;
      if (collection === 'accounts') {
        if (
          !row.username ||
          !row.nama ||
          !row.password ||
          !['SUPERADMIN', 'ANALIS', 'STAF'].includes(row.role)
        )
          errors.push('Akun tidak lengkap: ' + key);
        row.username = String(row.username || '')
          .trim()
          .toLowerCase();
        accounts.push(row);
      } else {
        if (collection === 'htmlDocuments') {
          if (row.html_gzip_base64)
            row.html_content = zlib
              .gunzipSync(Buffer.from(row.html_gzip_base64, 'base64'), {
                maxOutputLength: 20 * 1024 * 1024,
              })
              .toString('utf8');
          else if (row.html_base64)
            row.html_content = Buffer.from(row.html_base64, 'base64').toString(
              'utf8',
            );
          if (!row.html_content)
            errors.push('HTML belum ikut diekspor: ' + key);
          if (
            row.content_sha256 &&
            row.html_content &&
            fingerprint(row.html_content) !== row.content_sha256
          )
            errors.push('Checksum HTML berbeda: ' + key);
          if (row.html_content) {
            row.content_sha256 = fingerprint(row.html_content);
            row.file_size = Buffer.byteLength(row.html_content);
            row.storage_type = 'POSTGRESQL';
            row.content_encoding = 'identity';
          }
          delete row.html_gzip_base64;
          delete row.html_base64;
          delete row.drive_file_id;
        }
        if (Object.hasOwn(row, 'archived'))
          row.archived =
            row.archived === true ||
            String(row.archived).toLowerCase() === 'true';
        if (collection === 'legacyListening') row.source_sheet = sheet;
        mapped.push(clean(row));
      }
    }
    if (collection !== 'accounts')
      records[collection] = [...(records[collection] || []), ...mapped];
  }
  const usernames = new Set();
  for (const a of accounts) {
    if (usernames.has(a.username)) errors.push('Username ganda: ' + a.username);
    usernames.add(a.username);
  }
  if (!accounts.some((a) => a.role === 'SUPERADMIN'))
    errors.push('SUPERADMIN belum tersedia pada ekspor.');
  const orphans = [];
  for (const task of records.tasks || []) {
    if (task.brief_id && !ids.get('briefs')?.has(String(task.brief_id)))
      orphans.push('Tugas tanpa brief: ' + task.id);
    if (task.petugas_id && !ids.get('accounts')?.has(String(task.petugas_id)))
      orphans.push('Tugas tanpa akun: ' + task.id);
  }
  for (const link of records.contentLinks || [])
    if (link.brief_id && !ids.get('briefs')?.has(String(link.brief_id)))
      orphans.push('Link tanpa brief: ' + link.id);
  for (const row of [
    ...(records.insightSnapshots || []),
    ...(records.commentCaptures || []),
  ])
    if (row.link_id && !ids.get('contentLinks')?.has(String(row.link_id)))
      orphans.push('Snapshot/komentar tanpa link: ' + row.id);
  if (source.manifest?.external_errors?.length)
    errors.push('Ekspor Social Listening belum lengkap.');
  if (source.manifest?.html_errors?.length)
    errors.push('Ekspor belum memuat semua dokumen HTML.');
  return {
    records,
    accounts,
    settings,
    report: {
      ok: errors.length === 0 && orphans.length === 0,
      counts,
      accounts: accounts.length,
      records: Object.values(records).reduce((n, r) => n + r.length, 0),
      errors,
      orphans,
    },
  };
}
async function importSource(pool, source, { allowOrphans = false } = {}) {
  const prepared = prepare(source),
    { report } = prepared;
  if (report.errors.length || (!allowOrphans && report.orphans.length))
    throw error(
      'Validasi impor gagal: ' +
        [...report.errors, ...report.orphans].slice(0, 10).join('; '),
    );
  // Hash outside the database lock. Original passwords are never stored as records.
  const users = [];
  for (const a of prepared.accounts)
    users.push({
      id: a.id,
      username: a.username,
      password_hash: await passwordHash(a.password, { legacy: true }),
      profile: publicProfile(a),
      enabled: a.enabled !== false,
    });
  return transaction(pool, async (db) => {
    const counts = await db.query(
      'SELECT (SELECT count(*) FROM mwg_users)+(SELECT count(*) FROM mwg_records)+(SELECT count(*) FROM mwg_settings) AS count',
    );
    if (Number(counts.rows[0].count) !== 0)
      throw error(
        'Impor hanya diizinkan ke database kosong. Buat database staging baru.',
      );
    const store = new Store(db);
    for (const u of users)
      await db.query(
        'INSERT INTO mwg_users(id,username,password_hash,profile,enabled) VALUES($1,$2,$3,$4::jsonb,$5)',
        [
          u.id,
          u.username,
          u.password_hash,
          JSON.stringify(u.profile),
          u.enabled,
        ],
      );
    for (const entry of prepared.settings)
      await store.saveSettings(entry.key, entry.value);
    for (const [collection, rows] of Object.entries(prepared.records))
      for (const row of rows) await store.save(collection, row);
    for (const user of users) await store.change('accounts', user.id, 'UPSERT');
    const verified = await db.query(
      'SELECT collection,count(*)::int AS count FROM mwg_records GROUP BY collection',
    );
    for (const row of verified.rows)
      if (row.count !== prepared.records[row.collection]?.length)
        throw error('Verifikasi jumlah gagal: ' + row.collection);
    return {
      ...report,
      imported: true,
      verified_counts: Object.fromEntries(
        verified.rows.map((r) => [r.collection, r.count]),
      ),
      passwords_hashed: users.length,
    };
  });
}
const TABLES = [
  'mwg_users',
  'mwg_records',
  'mwg_settings',
  'mwg_changes',
  'mwg_requests',
  'mwg_jobs',
];
async function exportDatabase(pool) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const tables = {};
    const bytes = await db.query(
      'SELECT COALESCE(sum(octet_length(data::text)),0)::text AS bytes FROM mwg_records',
    );
    if (Number(bytes.rows[0].bytes) > 96 * 1024 * 1024)
      throw error(
        'Gunakan pg_dump untuk backup database besar; ekspor JSON dibatasi untuk menjaga memori.',
      );
    for (const table of TABLES)
      tables[table] = (await db.query('SELECT * FROM ' + table)).rows;
    await db.query('COMMIT');
    return {
      format: 'mwg-nimbus-backup-v1',
      generated_at: now(),
      tables,
      counts: Object.fromEntries(
        Object.entries(tables).map(([k, v]) => [k, v.length]),
      ),
    };
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}
async function readSource(file) {
  if ((await fs.stat(file)).size > 128 * 1024 * 1024)
    throw error('File migrasi maksimal 128 MB.');
  let bytes = await fs.readFile(file);
  if (file.endsWith('.gz'))
    bytes = await gunzip(bytes, { maxOutputLength: 128 * 1024 * 1024 });
  if (bytes.length > 128 * 1024 * 1024)
    throw error(
      'File migrasi maksimal 128 MB. Pecah arsip HTML sebelum migrasi besar.',
    );
  return JSON.parse(bytes.toString('utf8'));
}
async function backup(
  pool,
  {
    directory = process.env.MWG_BACKUP_DIR ||
      path.join(__dirname, '..', 'storage', 'backups'),
  } = {},
) {
  directory = path.resolve(directory);
  const publicDir = path.resolve(__dirname, '..', 'public');
  if (directory === publicDir || directory.startsWith(publicDir + path.sep))
    throw error('Backup wajib berada di luar direktori publik.');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const real = await fs.realpath(directory);
  if (real === publicDir || real.startsWith(publicDir + path.sep))
    throw error('Backup tidak boleh mengarah ke direktori publik.');
  const data = await exportDatabase(pool),
    plain = Buffer.from(JSON.stringify(data));
  if (plain.length > 128 * 1024 * 1024)
    throw error(
      'Backup JSON melebihi 128 MB. Gunakan pg_dump untuk database besar.',
    );
  const compressed = await gzip(plain),
    key = id('BACKUP'),
    name = key + '.json.gz',
    file = path.join(directory, name),
    hash = fingerprint(compressed);
  await fs.writeFile(file, compressed, { flag: 'wx', mode: 0o600 });
  await fs.writeFile(file + '.sha256', hash + '  ' + name + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  const verified = await readSource(file);
  if (
    verified.format !== data.format ||
    JSON.stringify(verified.counts) !== JSON.stringify(data.counts) ||
    fingerprint(await fs.readFile(file)) !== hash
  )
    throw error('Verifikasi backup gagal.');
  const record = {
    id: key,
    name,
    created_at: now(),
    sha256: hash,
    counts: data.counts,
    size_bytes: compressed.length,
    verified: true,
  };
  await new Store(pool).save('backups', record);
  return record;
}
async function restoreDatabase(pool, source) {
  if (source.format !== 'mwg-nimbus-backup-v1')
    throw error('Format backup tidak didukung.');
  for (const name of TABLES)
    if (
      !Array.isArray(source.tables?.[name]) ||
      source.counts?.[name] !== source.tables[name].length
    )
      throw error('Manifest backup tidak valid: ' + name);
  const columns = {
    mwg_users: [
      'id',
      'username',
      'password_hash',
      'profile',
      'enabled',
      'created_at',
    ],
    mwg_records: ['collection', 'id', 'data', 'updated_at'],
    mwg_settings: ['key', 'value', 'updated_at'],
    mwg_changes: ['sequence', 'collection', 'id', 'operation', 'created_at'],
    mwg_requests: [
      'user_id',
      'request_id',
      'fingerprint',
      'result',
      'created_at',
    ],
    mwg_jobs: [
      'id',
      'kind',
      'record_id',
      'state',
      'attempts',
      'available_at',
      'locked_at',
      'last_error',
      'created_at',
    ],
  };
  return transaction(pool, async (db) => {
    const total = await db.query(
      'SELECT (SELECT count(*) FROM mwg_users)+(SELECT count(*) FROM mwg_records)+(SELECT count(*) FROM mwg_settings) AS count',
    );
    if (Number(total.rows[0].count) !== 0)
      throw error('Restore hanya ke database kosong.');
    for (const name of TABLES)
      for (const row of source.tables[name]) {
        const keys = columns[name];
        for (const k of keys)
          if (!Object.hasOwn(row, k))
            throw error('Kolom backup tidak lengkap: ' + name + '.' + k);
        const jsonColumns = {
          mwg_users: ['profile'],
          mwg_records: ['data'],
          mwg_settings: ['value'],
          mwg_requests: ['result'],
        };
        const args = keys.map((k) =>
          (jsonColumns[name] || []).includes(k)
            ? JSON.stringify(row[k])
            : row[k],
        );
        await db.query(
          'INSERT INTO ' +
            name +
            '(' +
            keys.join(',') +
            ') VALUES(' +
            keys.map((_, i) => '$' + (i + 1)).join(',') +
            ')',
          args,
        );
      }
    await db.query(
      "SELECT setval(pg_get_serial_sequence('mwg_changes','sequence'),GREATEST((SELECT COALESCE(MAX(sequence),0) FROM mwg_changes),1),EXISTS(SELECT 1 FROM mwg_changes))",
    );
    return { restored: true, counts: source.counts, sessions_reset: true };
  });
}
module.exports = {
  prepare,
  importSource,
  exportDatabase,
  restoreDatabase,
  readSource,
  backup,
  SHEETS,
};
