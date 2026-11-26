'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { testPool, addUser } = require('./helpers.cjs');
const { Store } = require('../lib/store.cjs');
const { Service } = require('../lib/service.cjs');
const {
  runOne,
  queueScreenshot,
  screenshotState,
} = require('../lib/worker.cjs');
test('durable AI jobs are claimed once, expose provider failures, and keep screenshots private to their owner', async () => {
  const pool = await testPool(),
    originalFetch = global.fetch;
  let calls = 0;
  try {
    const admin = await addUser(pool),
      other = await addUser(pool, 'ANALIS'),
      store = new Store(pool);
    await store.saveSettings('gemini_ai', {
      api_key: 'synthetic-test-key',
      enabled: true,
      model: 'test-model',
    });
    await store.save('hotIssues', {
      id: 'HOT-JOB',
      judul: 'Isu sintetis',
      deskripsi: 'Uji kegagalan provider',
      ai_status: 'Antre',
    });
    await store.queueHot({ id: 'HOT-JOB' });
    global.fetch = async () => {
      calls++;
      return new Response('{}', { status: 429 });
    };
    const claimed = await Promise.all([runOne(pool), runOne(pool)]);
    assert.equal(claimed.filter(Boolean).length, 1);
    assert.equal(calls, 1);
    assert.equal((await store.get('hotIssues', 'HOT-JOB')).ai_status, 'Antre');
    for (let n = 0; n < 2; n++) {
      await pool.query(
        "UPDATE mwg_jobs SET available_at=now()-interval '1 second' WHERE id='hot:HOT-JOB'",
      );
      await runOne(pool);
    }
    assert.equal((await store.get('hotIssues', 'HOT-JOB')).ai_status, 'Gagal');
    assert.equal(
      (await pool.query("SELECT state FROM mwg_jobs WHERE id='hot:HOT-JOB'"))
        .rows[0].state,
      'failed',
    );
    const service = new Service(pool, admin),
      payload = {
        request_id: 'IMG-1',
        mime_type: 'image/png',
        image_base64: Buffer.from('synthetic-image-not-a-real-upload').toString(
          'base64',
        ),
      };
    await queueScreenshot(service, payload);
    await queueScreenshot(service, payload);
    assert.equal(
      (await pool.query("SELECT id FROM mwg_jobs WHERE kind='screenshot'")).rows
        .length,
      1,
    );
    const result = {
      platform: 'Instagram',
      screenshot_type: 'analytics',
      account_label: 'Akun uji',
      content_type: 'Video',
      visible_url: '',
      public_content_url: '',
      metrics: { views: 10, likes: 0 },
      confidence: 80,
      summary: 'Hasil sintetis untuk uji kontrak.',
      warnings: [],
    };
    global.fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: JSON.stringify(result) }] } },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    await runOne(pool);
    const state = await screenshotState(service, { request_id: 'IMG-1' });
    assert.equal(state.status, 'READY');
    assert.equal(state.analysis.metrics.views, 10);
    assert.equal(state.analysis.metrics.likes, 0);
    assert(!JSON.stringify(state).includes('image_base64'));
    assert.equal(
      (await screenshotState(new Service(pool, other), { request_id: 'IMG-1' }))
        .status,
      'WAITING',
    );
    assert(!(await store.get('aiRequests', admin.id + ':IMG-1')).image_base64);
  } finally {
    global.fetch = originalFetch;
    await pool.end();
  }
});
