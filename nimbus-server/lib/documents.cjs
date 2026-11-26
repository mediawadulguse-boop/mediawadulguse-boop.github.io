'use strict';
const crypto = require('node:crypto');
const { error } = require('./auth.cjs');
async function signingKey(db) {
  const existing = (
    await db.query(
      "SELECT value FROM mwg_settings WHERE key='_html_signing_key'",
    )
  ).rows[0];
  if (existing) return existing.value;
  await db.query(
    "INSERT INTO mwg_settings(key,value) VALUES('_html_signing_key',$1::jsonb) ON CONFLICT(key) DO NOTHING",
    [JSON.stringify(crypto.randomBytes(32).toString('hex'))],
  );
  return (
    await db.query(
      "SELECT value FROM mwg_settings WHERE key='_html_signing_key'",
    )
  ).rows[0].value;
}
function signature(key, record) {
  return crypto
    .createHmac('sha256', key)
    .update(record.id + '|' + record.content_sha256)
    .digest('hex');
}
async function publicUrl(db, record) {
  const key = await signingKey(db);
  return (
    (process.env.PUBLIC_URL || '') +
    '/documents/' +
    encodeURIComponent(record.id) +
    '?key=' +
    signature(key, record)
  );
}
async function withPublicUrls(db, rows) {
  if (!rows.length) return [];
  const key = await signingKey(db);
  return rows.map((record) => ({
    ...record,
    public_url:
      (process.env.PUBLIC_URL || '') +
      '/documents/' +
      encodeURIComponent(record.id) +
      '?key=' +
      signature(key, record),
  }));
}
async function publicDocument(db, id, token) {
  const result = await db.query(
      "SELECT data FROM mwg_records WHERE collection='htmlDocuments' AND id=$1",
      [id],
    ),
    record = result.rows[0]?.data;
  const key = (
    await db.query(
      "SELECT value FROM mwg_settings WHERE key='_html_signing_key'",
    )
  ).rows[0]?.value;
  if (
    !record?.html_content ||
    !key ||
    !/^[a-f0-9]{64}$/.test(token || '') ||
    !crypto.timingSafeEqual(
      Buffer.from(signature(key, record), 'hex'),
      Buffer.from(token, 'hex'),
    )
  )
    throw error('Dokumen tidak ditemukan atau tautan tidak berlaku.', 404);
  return record;
}
module.exports = { publicUrl, publicDocument, withPublicUrls };
