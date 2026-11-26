'use strict';
const crypto = require('node:crypto');
const { error, publicProfile } = require('./auth.cjs');
const COLLECTIONS = new Set([
  'briefs',
  'tasks',
  'hotIssues',
  'meetings',
  'templates',
  'footages',
  'htmlDocuments',
  'contentLinks',
  'insightSnapshots',
  'commentCaptures',
  'commentAnalyses',
  'activity',
  'notifications',
  'aiRules',
  'aiExamples',
  'aiFeedback',
  'aiHistory',
  'aiRequests',
  'aiPromptVersions',
  'contentPillars',
  'masterPrompts',
  'hotDaily',
  'hotWeekly',
  'listeningClusters',
  'listeningDigests',
  'errorLogs',
  'briefHistory',
  'backups',
  'activityArchive',
  'briefHistoryArchive',
  'notificationsArchive',
  'legacySyncLog',
  'legacyMigrationLog',
  'listeningRawItems',
  'listeningExecutive',
  'legacyListening',
]);
function id(prefix = 'REC') {
  return prefix + '-' + crypto.randomUUID();
}
function now() {
  return new Date().toISOString();
}
function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
function clean(record) {
  const result = { ...record };
  for (const key of Object.keys(result))
    if (key.startsWith('_')) delete result[key];
  for (const key of ['password', 'password_hash', 'password_salt'])
    delete result[key];
  return result;
}
class Store {
  constructor(db) {
    this.db = db;
  }
  collection(name) {
    if (!COLLECTIONS.has(name)) throw error('Koleksi tidak dikenal.');
    return name;
  }
  async list(collection, field, value) {
    this.collection(collection);
    const where = field ? ' AND data->>$2=$3' : '';
    const args = field ? [collection, field, String(value)] : [collection];
    const result = await this.db.query(
      'SELECT data FROM mwg_records WHERE collection=$1' +
        where +
        ' ORDER BY updated_at DESC,id',
      args,
    );
    return result.rows.map((row) => row.data);
  }
  async get(collection, key) {
    const result = await this.db.query(
      'SELECT data FROM mwg_records WHERE collection=$1 AND id=$2',
      [this.collection(collection), String(key || '')],
    );
    return result.rows[0]?.data || null;
  }
  async save(collection, record) {
    if (!record?.id) throw error('ID data wajib diisi.');
    const data = clean(record);
    await this.db.query(
      `INSERT INTO mwg_records(collection,id,data) VALUES($1,$2,$3::jsonb)
      ON CONFLICT(collection,id) DO UPDATE SET data=EXCLUDED.data,updated_at=clock_timestamp()`,
      [this.collection(collection), String(data.id), JSON.stringify(data)],
    );
    await this.change(collection, data.id, 'UPSERT');
    return data;
  }
  async remove(collection, key) {
    await this.db.query(
      'DELETE FROM mwg_records WHERE collection=$1 AND id=$2',
      [this.collection(collection), String(key)],
    );
    await this.change(collection, key, 'DELETE');
  }
  async change(collection, key, operation) {
    await this.db.query(
      'INSERT INTO mwg_changes(collection,id,operation) VALUES($1,$2,$3)',
      [collection, String(key), operation],
    );
  }
  async revision() {
    const result = await this.db.query(
      'SELECT COALESCE(MAX(sequence),0)::text AS cursor FROM mwg_changes',
    );
    return Number(result.rows[0].cursor);
  }
  async settings(key) {
    if (key) {
      const result = await this.db.query(
        'SELECT value FROM mwg_settings WHERE key=$1',
        [key],
      );
      return result.rows[0]?.value || {};
    }
    const result = await this.db.query('SELECT key,value FROM mwg_settings');
    return Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
  }
  async saveSettings(key, value) {
    await this.db.query(
      'INSERT INTO mwg_settings(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()',
      [key, JSON.stringify(value)],
    );
    await this.change('systemSettings', key, 'REFRESH');
    return { key, value, updated_at: now() };
  }
  async accounts() {
    const result = await this.db.query(
      'SELECT id,username,profile,enabled FROM mwg_users ORDER BY username',
    );
    return result.rows.map((row) =>
      publicProfile({
        ...row.profile,
        id: row.id,
        username: row.username,
        enabled: row.enabled,
      }),
    );
  }
  async audit(user, action, entity, recordId, detail = '') {
    await this.save('activity', {
      id: id('LOG'),
      user: user.nama,
      user_id: user.id,
      action,
      entity,
      entity_id: String(recordId),
      detail,
      created_at: now(),
    });
  }
  async queueHot(record) {
    await this.db.query(
      `INSERT INTO mwg_jobs(id,kind,record_id) VALUES($1,'hot',$2)
      ON CONFLICT(id) DO UPDATE SET state='queued',attempts=0,available_at=now(),locked_at=null,last_error=''`,
      ['hot:' + record.id, record.id],
    );
  }
}
module.exports = { Store, COLLECTIONS, id, now, today, clean };
