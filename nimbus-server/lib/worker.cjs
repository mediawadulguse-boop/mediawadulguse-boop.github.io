'use strict';
const crypto = require('node:crypto');
const { Store, now } = require('./store.cjs');
const { transaction } = require('./database.cjs');
const { generate, hotRecord } = require('./ai.cjs');
const schemas = require('./ai-schemas.cjs');
const { error, requirePermission } = require('./auth.cjs');

async function queueScreenshot(service, p) {
  requirePermission(service.user, 'insight.manage');
  const key = String(p.request_id || '');
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(key))
    throw error('Request ID screenshot tidak valid.');
  const type = String(p.mime_type || '');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(type))
    throw error('Format screenshot tidak didukung.');
  if (
    !p.image_base64 ||
    Buffer.byteLength(p.image_base64, 'base64') > 4 * 1024 * 1024
  )
    throw error('Screenshot maksimal 4 MB.');
  const owner = service.user.id,
    recordId = owner + ':' + key;
  return transaction(service.pool, async (db) => {
    const store = new Store(db),
      existing = await store.get('aiRequests', recordId);
    if (existing) return { request_id: key, status: existing.status };
    await store.save('aiRequests', {
      id: recordId,
      request_id: key,
      user_id: owner,
      status: 'RECEIVED',
      image_base64: p.image_base64,
      mime_type: type,
      created_at: now(),
    });
    await db.query(
      "INSERT INTO mwg_jobs(id,kind,record_id) VALUES($1,'screenshot',$2) ON CONFLICT(id) DO NOTHING",
      ['screenshot:' + recordId, recordId],
    );
    return { request_id: key, status: 'RECEIVED' };
  });
}
async function screenshotState(service, p) {
  requirePermission(service.user, 'insight.manage');
  const row = await service.store.get(
    'aiRequests',
    service.user.id + ':' + String(p.request_id || ''),
  );
  if (!row) return { request_id: p.request_id, status: 'WAITING' };
  return {
    request_id: row.request_id,
    status: row.status,
    phase: 'gemini',
    analysis: row.result,
    error: row.error || '',
    model: row.model,
    updated_at: row.updated_at,
  };
}
async function runOne(pool) {
  // A durable lease prevents the web process and cron from claiming the same job.
  const job = await transaction(pool, async (db) => {
    const result = await db.query(
      "SELECT * FROM mwg_jobs WHERE (state='queued' AND available_at<=now()) OR (state='processing' AND locked_at<now()-interval '5 minutes') ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
    );
    const row = result.rows[0];
    if (!row) return null;
    const lease = crypto.randomUUID();
    await db.query(
      "UPDATE mwg_jobs SET state='processing',locked_at=now(),attempts=attempts+1,last_error=$2 WHERE id=$1",
      [row.id, lease],
    );
    return { ...row, lease };
  });
  if (!job) return false;
  const store = new Store(pool);
  try {
    const collection = job.kind === 'hot' ? 'hotIssues' : 'aiRequests',
      input = await store.get(collection, job.record_id);
    if (!input) {
      await pool.query('DELETE FROM mwg_jobs WHERE id=$1', [job.id]);
      return true;
    }
    if (job.kind === 'screenshot')
      await transaction(pool, (db) =>
        new Store(db).save(collection, {
          ...input,
          status: 'PROCESSING',
          updated_at: now(),
        }),
      );
    const out = await generate(
      store,
      job.kind === 'hot'
        ? JSON.stringify({
            judul: input.judul,
            deskripsi: input.deskripsi,
            sumber: input.sumber,
            link: input.link,
          })
        : 'Baca metrik yang benar-benar terlihat pada screenshot. Jangan menaksir metrik yang terpotong. Hilangkan metrik yang tidak tersedia. Kembalikan sesuai schema.',
      job.kind === 'hot'
        ? schemas.hotIssueAiSchema()
        : schemas.insightScreenshotSchema(),
      job.kind === 'hot'
        ? {}
        : {
            parts: [
              {
                inline_data: {
                  mime_type: input.mime_type,
                  data: input.image_base64,
                },
              },
            ],
          },
    );
    await transaction(pool, async (db) => {
      const result = await db.query(
        'SELECT last_error,state FROM mwg_jobs WHERE id=$1',
        [job.id],
      );
      if (
        result.rows[0]?.last_error !== job.lease ||
        result.rows[0]?.state !== 'processing'
      )
        return;
      const s = new Store(db),
        current = await s.get(collection, input.id);
      if (!current) return;
      if (job.kind === 'hot') {
        if (
          current.judul !== input.judul ||
          current.deskripsi !== input.deskripsi
        ) {
          await db.query(
            "UPDATE mwg_jobs SET state='queued',available_at=now(),last_error='' WHERE id=$1",
            [job.id],
          );
          return;
        }
        await s.save(collection, hotRecord(current, out.result, out.model));
      } else {
        const { image_base64, ...safe } = current;
        await s.save(collection, {
          ...safe,
          status: 'READY',
          result: {
            ...out.result,
            model: out.model,
            analyzed_at: out.generated_at,
          },
          model: out.model,
          updated_at: now(),
        });
      }
      await db.query(
        "UPDATE mwg_jobs SET state='done',last_error='' WHERE id=$1",
        [job.id],
      );
    });
  } catch (err) {
    await transaction(pool, async (db) => {
      const row = (
        await db.query('SELECT * FROM mwg_jobs WHERE id=$1', [job.id])
      ).rows[0];
      if (!row || row.last_error !== job.lease) return;
      const failed = Number(row.attempts) >= 3;
      await db.query(
        "UPDATE mwg_jobs SET state=$2,available_at=now()+interval '2 minutes',last_error=$3 WHERE id=$1",
        [
          job.id,
          failed ? 'failed' : 'queued',
          String(err.message || err).slice(0, 800),
        ],
      );
      const s = new Store(db),
        collection = job.kind === 'hot' ? 'hotIssues' : 'aiRequests',
        record = await s.get(collection, job.record_id);
      if (record)
        await s.save(collection, {
          ...record,
          ...(job.kind === 'hot'
            ? { ai_status: failed ? 'Gagal' : 'Antre' }
            : {
                status: failed ? 'ERROR' : 'RECEIVED',
                error: String(err.message || err),
              }),
          updated_at: now(),
        });
    });
  }
  return true;
}
let running = false;
function kick(pool) {
  if (running) return;
  running = true;
  setImmediate(async () => {
    try {
      for (let n = 0; n < 10; n++) if (!(await runOne(pool))) break;
    } catch (err) {
      console.error('Worker gagal:', err.code || err.name);
    } finally {
      running = false;
    }
  });
}
module.exports = { queueScreenshot, screenshotState, runOne, kick };
