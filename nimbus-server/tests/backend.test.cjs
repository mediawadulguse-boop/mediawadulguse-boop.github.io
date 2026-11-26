'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { testPool, addUser } = require('./helpers.cjs');
const { commit } = require('../lib/mutations.cjs');
const { Store } = require('../lib/store.cjs');
const { Service } = require('../lib/service.cjs');
const { Domain } = require('../lib/domain.cjs');
const { login, authenticate, has, fingerprint } = require('../lib/auth.cjs');
const { createServer } = require('../lib/http.cjs');
const migration = require('../lib/migration.cjs');
let pool, admin, analyst, staff, other, store;
before(async () => {
  pool = await testPool();
  admin = await addUser(pool);
  analyst = await addUser(pool, 'ANALIS');
  staff = await addUser(pool, 'STAF', 'STAF1');
  other = await addUser(pool, 'STAF', 'STAF2');
  store = new Store(pool);
});
after(async () => pool.end());
const brief = {
  id: 'B1',
  judul: 'Brief contoh',
  tanggal: '2026-11-26',
  deadline: '2026-11-27',
  status: 'Draft',
  jobdesk: [
    { petugas_id: 'STAF1', petugas: 'Pengguna STAF1', jobdesk: ['Editor'] },
  ],
};
test('login hashes passwords and sessions, returns no credentials, and logout expiry is enforced', async () => {
  const session = await login(
    pool,
    { username: 'superadmin', password: 'example-Password-123' },
    'test',
  );
  assert.equal(session.user.role, 'SUPERADMIN');
  assert(!JSON.stringify(session.user).includes('password'));
  const raw = await pool.query('SELECT token_hash FROM mwg_sessions');
  assert(!raw.rows.some((x) => x.token_hash === session.token));
  assert.equal((await authenticate(pool, session.token)).id, admin.id);
  await pool.query('DELETE FROM mwg_sessions WHERE token_hash=$1', [
    fingerprint(session.token),
  ]);
  await assert.rejects(
    authenticate(pool, session.token),
    (e) => e.status === 401,
  );
  await assert.rejects(
    login(pool, { username: 'superadmin', password: 'incorrect' }, 'test'),
    (e) => e.status === 401,
  );
});
test('creating, patching and reassigning a brief preserves task identity and progress', async () => {
  await commit(pool, admin, 'saveBrief', {
    record: brief,
    _request_id: 'req-b1',
  });
  const task = (await store.list('tasks', 'brief_id', 'B1'))[0];
  assert.equal(task.petugas_id, 'STAF1');
  await commit(pool, staff, 'updateTaskField', {
    id: task.id,
    field: 'status',
    value: 'Proses',
    _request_id: 'req-t1',
  });
  await commit(pool, admin, 'patchBrief', {
    id: 'B1',
    changes: {
      jobdesk: [
        { petugas_id: 'STAF2', petugas: 'Pengguna STAF2', jobdesk: ['Editor'] },
      ],
    },
    _request_id: 'req-b2',
  });
  const after = (await store.list('tasks', 'brief_id', 'B1'))[0];
  assert.equal(after.id, task.id);
  assert.equal(after.status, 'Proses');
  assert.equal(after.petugas_id, 'STAF2');
  await assert.rejects(
    commit(pool, staff, 'updateTaskField', {
      id: task.id,
      field: 'status',
      value: 'Selesai',
    }),
    (e) => e.status === 403,
  );
});
test('request receipts make retries idempotent and reject reused IDs with different content', async () => {
  const payload = {
    record: { ...brief, id: 'B2' },
    _request_id: 'req-idempotent',
  };
  const [a, b] = await Promise.all([
    commit(pool, admin, 'saveBrief', payload),
    commit(pool, admin, 'saveBrief', payload),
  ]);
  assert.deepEqual(a, b);
  assert.equal((await store.list('tasks', 'brief_id', 'B2')).length, 1);
  await assert.rejects(
    commit(pool, admin, 'saveBrief', {
      ...payload,
      record: { ...payload.record, judul: 'Diubah' },
    }),
    (e) => e.status === 409,
  );
});
test('permission checks, visibility, resignation references and private settings are enforced on the server', async () => {
  await assert.rejects(
    commit(pool, staff, 'saveBrief', { record: { ...brief, id: 'FORBIDDEN' } }),
    (e) => e.status === 403,
  );
  const d = new Domain(pool, staff),
    tasks = await d.visible('tasks');
  assert(tasks.every((t) => t.petugas_id === staff.id));
  await commit(pool, admin, 'saveSystemSettings', {
    key: 'staff_roster',
    settings: {
      employment: { STAF1: { status: 'Resign', resigned_at: '2026-11-26' } },
    },
  });
  const refs = await new Service(pool, analyst).references();
  assert.equal(
    refs.accounts.find((x) => x.id === 'STAF1').status_staf,
    'Resign',
  );
  assert(
    refs.accounts.every((x) => !x.username && !x.password && !x.permissions),
  );
  assert.deepEqual(
    (await new Service(pool, staff).references()).accounts.map((x) => x.id),
    ['STAF1'],
  );
  await assert.rejects(
    new Service(pool, staff).read('getSystemSettings'),
    (e) => e.status === 403,
  );
  await assert.rejects(
    commit(pool, admin, 'saveBrief', {
      record: { ...brief, id: 'RESIGNED-NEW' },
    }),
    /resign/i,
  );
  await commit(pool, admin, 'patchBrief', {
    id: 'B2',
    changes: { judul: 'Riwayat masih dapat diedit' },
  });
});
test('conflicts and failed relational writes roll back all changes', async () => {
  const old = await store.get('briefs', 'B2');
  await assert.rejects(
    commit(pool, admin, 'patchBrief', {
      id: 'B2',
      changes: { judul: 'Konflik' },
      expected_updated_at: 'old',
    }),
    (e) => e.status === 409,
  );
  assert.equal((await store.get('briefs', 'B2')).judul, old.judul);
  await assert.rejects(
    commit(pool, admin, 'saveBrief', {
      record: {
        ...brief,
        id: 'ROLLBACK',
        jobdesk: [],
        _publication_links: [{ url: 'javascript:alert(1)' }],
      },
    }),
    /URL/,
  );
  assert.equal(await store.get('briefs', 'ROLLBACK'), null);
});
test('archive/restore and cascade delete update all related tasks atomically', async () => {
  await commit(pool, admin, 'setBriefArchive', { id: 'B1', archived: true });
  assert(
    (await store.list('tasks', 'brief_id', 'B1')).every((t) => t.archived),
  );
  await commit(pool, admin, 'setBriefArchive', { id: 'B1', archived: false });
  assert(
    (await store.list('tasks', 'brief_id', 'B1')).every((t) => !t.archived),
  );
  await commit(pool, admin, 'deleteBrief', { id: 'B1' });
  assert.equal((await store.list('tasks', 'brief_id', 'B1')).length, 0);
  assert.equal(await store.get('briefs', 'B1'), null);
});
test('publishing validates links, HTML round-trips with a checksum, and incomplete saves fail', async () => {
  await assert.rejects(
    commit(pool, admin, 'saveBrief', {
      record: { ...brief, id: 'PUB', jobdesk: [], status: 'Publish' },
    }),
    /Link/,
  );
  await commit(pool, admin, 'saveBrief', {
    record: {
      ...brief,
      id: 'PUB',
      jobdesk: [],
      status: 'Publish',
      _publication_links: [
        { url: 'https://example.com/post', platform: 'Website' },
      ],
    },
  });
  assert.equal(
    (
      await new Service(pool, admin).read('getPublicationLinks', {
        brief_id: 'PUB',
      })
    ).rows.length,
    1,
  );
  const html = '<html><body><h1>Uji 🩷</h1></body></html>';
  await commit(pool, admin, 'saveHtmlDocument', {
    record: {
      id: 'H1',
      judul: 'Laporan',
      html_base64: Buffer.from(html).toString('base64'),
      content_sha256: fingerprint(html),
    },
  });
  const data = await new Service(pool, admin).read('getHtmlDocumentContent', {
    id: 'H1',
  });
  assert.equal(data.html_content, html);
  assert(
    !(
      await new Service(pool, admin).read('getModuleDataSimple', {
        kind: 'htmlDocuments',
      })
    ).rows[0].html_content,
  );
});
test('account edits preserve blank passwords and never delete the last administrator', async () => {
  const saved = await commit(pool, admin, 'saveAccount', {
    record: {
      id: 'STAF2',
      username: 'staf2',
      nama: 'Nama Baru',
      role: 'STAF',
      password: '',
      permissions: ['task.view_own'],
      permissions_override: true,
    },
  });
  assert(!Object.hasOwn(saved, 'password'));
  assert.equal(
    (
      await login(
        pool,
        { username: 'staf2', password: 'example-Password-123' },
        'test',
      )
    ).user.nama,
    'Nama Baru',
  );
  await assert.rejects(
    commit(pool, admin, 'saveAccount', {
      record: {
        id: admin.id,
        username: 'superadmin',
        nama: 'Admin',
        role: 'STAF',
      },
    }),
    /SUPERADMIN/,
  );
});
test('insight snapshots update reach, retain zero metrics, redact personal data and paginate by brief', async () => {
  const service = new Service(pool, admin),
    link = (await service.read('getPublicationLinks', { brief_id: 'PUB' }))
      .rows[0];
  const saved = await commit(pool, admin, 'saveInsightSnapshot', {
    link_id: link.id,
    snapshot_id: 'SNAP1',
    metrics: { reach: 100, likes: 0, comments: null },
    confidence_score: 100,
    validation_status: 'accepted',
  });
  assert.equal(saved.primary, 100);
  assert.equal((await store.get('briefs', 'PUB')).insight_reach, 100);
  assert.equal(saved.snapshot.metrics.likes, 0);
  assert(!Object.hasOwn(saved.snapshot.metrics, 'comments'));
  assert.equal(saved.link.grade, '-');
  assert.equal(saved.link.scoring_pending, true);
  const capture = await commit(pool, admin, 'saveCommentCapture', {
    link_id: link.id,
    comments: [
      {
        text: 'Hubungi 081234567890 atau uji@example.com, NIK 1234567890123456',
      },
      { text: 'Terima kasih' },
    ],
  });
  assert(!JSON.stringify(capture).includes('081234567890'));
  assert(!JSON.stringify(capture).includes('uji@example.com'));
  assert(!JSON.stringify(capture).includes('1234567890123456'));
  const tracker = await service.read('getInsightTracker', { link_id: link.id });
  assert.equal(tracker.rows[0].id, link.id);
  assert.equal(tracker.total, 1);
  assert.equal(tracker.groups[0].links.length, 1);
});
test('local listening permissions and conversion do not require the old Google backend', async () => {
  const { proxy } = require('../lib/listening.cjs'),
    service = new Service(pool, admin);
  await assert.rejects(
    proxy(new Service(pool, staff), {
      action: 'addCurated',
      payload: { judul: 'Uji', ringkasan: 'Uji' },
    }),
    (e) => e.status === 403,
  );
  const record = (
    await proxy(service, {
      action: 'addCurated',
      payload: { judul: 'Isu contoh', ringkasan: 'Data sintetis', score: 90 },
    })
  ).record;
  await commit(pool, admin, 'saveHotIssue', {
    record: { id: 'HOT-L', judul: 'Isu contoh', deskripsi: 'Data sintetis' },
  });
  await proxy(service, {
    action: 'markCandidate',
    payload: { cluster_id: record.cluster_id, hot_issue_id: 'HOT-L' },
  });
  const rows = (
    await proxy(new Service(pool, staff), {
      action: 'listDashboard',
      payload: {},
    })
  ).rows;
  assert.equal(rows[0].status, 'JADI HOT ISSUE');
  await assert.rejects(proxy(service, { action: 'runCollector' }), /Collector/);
});
test('backup verification and restore reproduce records, hashes, settings and receipts in a fresh database', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mwg-backup-'));
  let restored;
  try {
    const record = await migration.backup(pool, { directory: dir });
    assert(record.verified);
    const file = path.join(dir, record.name),
      bytes = await fs.readFile(file);
    assert.equal(fingerprint(bytes), record.sha256);
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    restored = await testPool();
    const source = await migration.readSource(file);
    const out = await migration.restoreDatabase(restored, source);
    assert(out.restored);
    assert.deepEqual(
      await new Store(restored).get('briefs', 'B2'),
      await store.get('briefs', 'B2'),
    );
    assert.equal(
      (
        await login(
          restored,
          { username: 'superadmin', password: 'example-Password-123' },
          'restore',
        )
      ).user.role,
      'SUPERADMIN',
    );
    await assert.rejects(migration.restoreDatabase(restored, source), /kosong/);
  } finally {
    if (restored) await restored.end();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('HTTP transport blocks unauthenticated mutations, cross-origin requests, JSONP and private files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mwg-public-'));
  await fs.writeFile(path.join(dir, 'index.html'), 'ok');
  const server = createServer(pool, { publicRoot: dir, workers: false });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    let res = await fetch(base + '/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'saveBrief', payload: { record: brief } }),
    });
    assert.equal(res.status, 401);
    res = await fetch(base + '/api?action=health&callback=x');
    assert.equal(res.status, 405);
    res = await fetch(base + '/api', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.example',
      },
      body: '{"action":"health"}',
    });
    assert.equal(res.status, 403);
    for (const file of ['/.env', '/schema.sql', '/lib/auth.cjs'])
      assert.equal((await fetch(base + file)).status, 404);
    const metadata = (
      await new Service(pool, admin).read('getModuleDataSimple', {
        kind: 'htmlDocuments',
      })
    ).rows[0];
    assert.equal((await fetch(base + '/documents/H1')).status, 404);
    const document = await fetch(base + metadata.public_url);
    assert.equal(document.status, 200);
    assert.match(document.headers.get('Content-Security-Policy'), /sandbox/);
    assert(
      !document.headers
        .get('Content-Security-Policy')
        .includes('allow-same-origin'),
    );
    assert.equal((await fetch(base + '/')).status, 200);
    res = await fetch(base + '/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'login',
        payload: { username: 'superadmin', password: 'example-Password-123' },
      }),
    });
    const session = (await res.json()).data.session;
    assert(session.token);
    res = await fetch(base + '/api', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + session.token,
      },
      body: JSON.stringify({
        action: 'simpleCrudCommitBatch',
        payload: {
          items: [
            {
              source_action: 'saveBrief',
              request_id: 'HTTP1',
              payload: { record: { ...brief, id: 'HTTPB', jobdesk: [] } },
            },
            {
              source_action: 'updateTaskField',
              request_id: 'HTTP2',
              payload: { id: 'missing', field: 'status', value: 'Selesai' },
            },
          ],
        },
      }),
    });
    const rows = (await res.json()).data.rows;
    assert.equal(rows[0].status, 'SUCCESS');
    assert.equal(rows[1].status, 'ERROR');
    assert(await store.get('briefs', 'HTTPB'));
  } finally {
    await new Promise((r) => server.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
