'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { testPool, addUser } = require('./helpers.cjs');
const { createServer } = require('../lib/http.cjs');
const { Store } = require('../lib/store.cjs');
const { build } = require('../../scripts/build-nimbus.cjs');
async function wait(predicate, label) {
  for (let i = 0; i < 600; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('Timeout: ' + label);
}
test('Nimbus build logs in against SQL, persists a UI brief instantly, and acknowledges the durable queue', async () => {
  const output = build(),
    publicRoot = path.join(output, 'public'),
    pool = await testPool();
  await addUser(pool);
  const server = createServer(pool, { publicRoot, workers: false });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  let dom;
  const errors = [],
    requests = [];
  try {
    let html = fs.readFileSync(path.join(publicRoot, 'index.html'), 'utf8');
    for (const file of [
      'staff-roster.js',
      'brief-import.js',
      'hot-pdf-import.js',
      'long-text-editor.js',
      'nimbus-client.js',
      'app.js',
    ]) {
      let source = fs.readFileSync(path.join(publicRoot, file), 'utf8');
      if (file === 'app.js')
        source = source.replace(
          "document.addEventListener('DOMContentLoaded',()=>{\n  // v1.20.1",
          "window.__test={API,Auth,Store,Config,App,BriefModule,TaskModule,ReferenceManager,StaffRoster,AdminModule};\ndocument.addEventListener('DOMContentLoaded',()=>{\n  // v1.20.1",
        );
      html = html.replace(
        new RegExp(
          '<script src="\\./' +
            file.replace('.', '\\.') +
            '\\?v=[^"]+"></script>',
        ),
        () => '<script>' + source + '</script>',
      );
    }
    const vc = new VirtualConsole();
    vc.on('jsdomError', (e) => {
      if (e.type === 'unhandled-exception') errors.push(e.message);
    });
    dom = new JSDOM(html, {
      url: base + '/index.html#briefs',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      virtualConsole: vc,
      beforeParse(w) {
        w.matchMedia = () => ({
          matches: false,
          addEventListener() {},
          removeEventListener() {},
        });
        w.confirm = () => true;
        w.scrollTo = () => {};
        w.AbortController = AbortController;
        w.TextEncoder = TextEncoder;
        w.fetch = async (input, options) => {
          const response = await fetch(new URL(input, base), options);
          if (options?.body) {
            const request = JSON.parse(options.body);
            requests.push({ action: request.action, status: response.status });
          }
          return response;
        };
      },
    });
    const w = dom.window,
      q = (s) => w.document.querySelector(s);
    await wait(() => q('#loginForm'), 'login form');
    q('#loginForm [name=username]').value = 'superadmin';
    q('#loginForm [name=password]').value = 'example-Password-123';
    q('#loginForm button[type=submit]').click();
    await wait(() => w.__test?.Auth.session && q('.app-shell'), 'SQL login');
    const t = w.__test;
    await wait(
      () => t.Store.isModuleReady('briefs') && t.Store.isModuleReady('tasks'),
      'core data',
    );
    await t.ReferenceManager.ensure();
    assert.equal(t.Config.data.apiUrl, './api');
    assert(!t.API.isDemo());
    await t.BriefModule.openForm();
    q('#briefForm [name=judul]').value = 'UI Nimbus ke PostgreSQL';
    q('#briefForm [name=detail_brief]').value =
      'Catatan editor\nTeks panjang 🩷';
    q('.team-person').value = 'SUPERADMIN';
    q('.team-jobs').value = 'Editor';
    const started = Date.now();
    q('#saveBrief').click();
    await wait(() => !q('#briefForm'), 'modal closes');
    assert(
      Date.now() - started < 1500,
      'modal must not wait for database round trips',
    );
    const row = t.Store.briefs.find(
      (b) => b.judul === 'UI Nimbus ke PostgreSQL',
    );
    assert(row);
    const key = row.id;
    await wait(() => t.API.pendingSimpleCrud() === 0, 'server receipt');
    const saved = await new Store(pool).get('briefs', key);
    assert.equal(saved.judul, row.judul);
    assert.equal(saved.detail_brief, 'Catatan editor\nTeks panjang 🩷');
    assert.equal(
      (await new Store(pool).list('tasks', 'brief_id', key)).length,
      1,
    );
    assert.equal(t.Store.tasks.filter((x) => x.brief_id === key).length, 1);
    assert(requests.some((r) => r.action === 'saveBrief' && r.status === 200));
    assert(!requests.some((r) => r.action === 'simpleCrudPacked'));
    await t.AdminModule.accountForm(t.Store.accounts[0]);
    assert.equal(q('#accountForm [name=password]').required, false);
    assert.equal(q('#accountForm [name=password]').value, '');
    q('[data-close-modal]').click();
    for (const route of [
      'tasks',
      'calendar',
      'kanban',
      'hotissues',
      'meetings',
      'reports',
      'htmlfiles',
      'footages',
      'insights',
      'aistudio',
      'listening',
      'settings',
      'health',
      'activity',
      'templates',
      'accounts',
    ]) {
      await t.App.navigate(route, false);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    assert.deepEqual(errors, []);
    assert(
      !requests.some((r) => r.status >= 400),
      'all frontend actions supported: ' + JSON.stringify(requests),
    );
  } finally {
    dom?.window.close();
    await new Promise((r) => server.close(r));
    await pool.end();
  }
});
