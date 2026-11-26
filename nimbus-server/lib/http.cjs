'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { Service, health, MUTATIONS } = require('./service.cjs');
const { commit } = require('./mutations.cjs');
const {
  login,
  authenticate,
  fingerprint,
  error,
  requirePermission,
} = require('./auth.cjs');
const { queueScreenshot, screenshotState, kick } = require('./worker.cjs');
const { Store, now } = require('./store.cjs');
const { archived } = require('./domain.cjs');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
async function send(req, res, status, object) {
  const data = Buffer.from(JSON.stringify(object));
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (
    data.length > 2048 &&
    /\bgzip\b/.test(req.headers['accept-encoding'] || '')
  ) {
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    await pipeline(Readable.from([data]), zlib.createGzip(), res);
  } else {
    res.setHeader('Content-Length', data.length);
    res.end(data);
  }
}
async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32 * 1024 * 1024) throw error('Payload maksimal 32 MB.', 413);
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw 0;
    return parsed;
  } catch {
    throw error('Body JSON tidak valid.');
  }
}
async function dispatch(pool, req, input, { workers = true } = {}) {
  const action = String(input.action || ''),
    payload = input.payload || {};
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw error('Payload tidak valid.');
  if (action === 'health') return health();
  if (action === 'publicCalendar')
    return (await new Store(pool).list('briefs'))
      .filter((r) => !archived(r))
      .map(
        ({
          id,
          tanggal,
          deadline,
          judul,
          konten_pilar,
          status,
          approval_status,
        }) => ({
          id,
          tanggal,
          deadline,
          judul,
          konten_pilar,
          status,
          approval_status,
        }),
      );
  if (action === 'login' || action === 'loginSimple') {
    const session = await login(pool, payload, req.socket.remoteAddress),
      service = new Service(pool, session.user);
    return {
      session,
      reference_pack: await service.references(),
      apiInfo: {
        ...health(),
        capabilities: require('./service.cjs').CAPABILITIES,
      },
    };
  }
  const token =
      String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') ||
      String(input.token || ''),
    user = await authenticate(pool, token),
    service = new Service(pool, user);
  if (action === 'logoutSession') {
    await pool.query('DELETE FROM mwg_sessions WHERE token_hash=$1', [
      fingerprint(token),
    ]);
    return { logged_out: true };
  }
  if (
    ['sessionProbe', 'probeSession', 'verifySession', 'sessionStatus'].includes(
      action,
    )
  )
    return {
      authenticated: true,
      user,
      persistent_until_logout: false,
      expires_in: 86400,
      version: health().version,
    };
  if (action === 'simpleCrudPacked') {
    const decoded = zlib.gunzipSync(
      Buffer.from(String(payload.packed || ''), 'base64url'),
      { maxOutputLength: 32 * 1024 * 1024 },
    );
    let request;
    try {
      request = JSON.parse(decoded);
    } catch {
      throw error('Payload CRUD tidak valid.');
    }
    const result = await commit(
      pool,
      user,
      String(request.source_action || ''),
      request.payload || {},
    );
    if (workers) kick(pool);
    return result;
  }
  if (action === 'simpleCrudCommitBatch') {
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (!items.length || items.length > 30)
      throw error('Batch harus berisi 1–30 perubahan.');
    const rows = [];
    for (const item of items) {
      const receipt = {
        request_id: String(item.request_id || ''),
        client_id: item.client_id,
      };
      try {
        const result = await commit(
          pool,
          user,
          String(item.source_action || ''),
          item.payload || {},
          receipt.request_id,
        );
        rows.push({ ...receipt, status: 'SUCCESS', result });
      } catch (e) {
        rows.push({
          ...receipt,
          status: 'ERROR',
          error: e.status ? e.message : 'Perubahan gagal disimpan.',
        });
      }
    }
    if (workers) kick(pool);
    return { rows, generated_at: now() };
  }
  if (MUTATIONS.has(action)) {
    const result = await commit(pool, user, action, payload);
    if (workers) kick(pool);
    return result;
  }
  if (action === 'analyzeInsightScreenshot') {
    const result = await queueScreenshot(service, payload);
    if (workers) kick(pool);
    return result;
  }
  if (action === 'getInsightScreenshotAnalysis')
    return screenshotState(service, payload);
  if (action === 'getInsightScreenshotTargets') {
    requirePermission(user, 'insight.manage');
    return service.insight('getInsightAuditExport', { limit: 100000 });
  }
  if (
    /^(aiDraftBriefFromHotIssue|aiReviewBrief|aiAnalyzeInsightNarrative|aiStudioChat|analyzeHotIssue|analyzeCommentCapture|refreshHotIssueDaily|testGeminiConnection)$/.test(
      action,
    )
  )
    return require('./ai.cjs').run(service, action, payload);
  if (action === 'fetchMetadata') {
    requirePermission(user, 'hotissue.create', 'hotissue.edit');
    return require('./metadata.cjs').metadata(payload.url);
  }
  if (action === 'listeningProxy')
    return require('./listening.cjs').proxy(service, payload);
  if (action === 'runBackupNow') {
    requirePermission(user, 'backup.manage');
    return require('./migration.cjs').backup(pool);
  }
  if (action === 'restoreBackup') {
    requirePermission(user, 'backup.manage');
    throw error(
      'Pemulihan dilakukan lewat CLI ke database kosong agar data aktif tidak tertimpa.',
      409,
    );
  }
  return service.read(action, payload);
}
function createServer(
  pool,
  { publicRoot = path.join(__dirname, '..', 'public'), workers = true } = {},
) {
  const root = path.resolve(publicRoot);
  return http.createServer(
    { requestTimeout: 30000, headersTimeout: 15000 },
    async (req, res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'same-origin');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      try {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/healthz') {
          await pool.query('SELECT key FROM mwg_settings LIMIT 1');
          return await send(req, res, 200, { ok: true, data: health() });
        }
        if (url.pathname === '/api' || url.pathname === '/api/') {
          if (req.method !== 'POST')
            throw error('API hanya menerima POST.', 405);
          if (req.headers.origin) {
            const expected = process.env.PUBLIC_URL
              ? new URL(process.env.PUBLIC_URL).origin
              : 'http://' + req.headers.host;
            if (req.headers.origin !== expected)
              throw error('Origin permintaan tidak diizinkan.', 403);
          }
          if (
            !/^(application\/json|text\/plain)(?:;|$)/i.test(
              req.headers['content-type'] || '',
            )
          )
            throw error('Gunakan Content-Type application/json.', 415);
          const input = await body(req),
            result = await dispatch(pool, req, input, { workers });
          return await send(req, res, 200, { ok: true, data: result });
        }
        if (url.pathname.startsWith('/documents/') && req.method === 'GET') {
          const record = await require('./documents.cjs').publicDocument(
            pool,
            decodeURIComponent(url.pathname.slice('/documents/'.length)),
            url.searchParams.get('key'),
          );
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Referrer-Policy', 'no-referrer');
          res.setHeader(
            'Content-Security-Policy',
            "sandbox allow-scripts allow-forms allow-downloads; frame-ancestors 'self'",
          );
          res.end(record.html_content);
          return;
        }
        if (!['GET', 'HEAD'].includes(req.method))
          throw error('Metode tidak diizinkan.', 405);
        let relative = decodeURIComponent(url.pathname);
        if (relative === '/' || relative === '') relative = '/index.html';
        if (relative.split('/').some((p) => p.startsWith('.')))
          throw error('File tidak ditemukan.', 404);
        const file = path.resolve(root, '.' + relative);
        if (!file.startsWith(root + path.sep))
          throw error('File tidak ditemukan.', 404);
        const extension = path.extname(file).toLowerCase();
        if (!MIME[extension] && path.basename(file) !== 'LICENSE')
          throw error('File tidak ditemukan.', 404);
        const stat = await fs.promises.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink())
          throw error('File tidak ditemukan.', 404);
        res.setHeader('Content-Type', MIME[extension] || 'text/plain');
        res.setHeader(
          'Cache-Control',
          ['config.json', 'sw.js', 'index.html'].includes(path.basename(file))
            ? 'no-store'
            : url.searchParams.has('v')
              ? 'public, max-age=86400'
              : 'public, max-age=300',
        );
        if (req.method === 'HEAD') {
          res.setHeader('Content-Length', stat.size);
          res.end();
          return;
        }
        if (
          ['.js', '.mjs', '.css', '.html', '.json', '.svg'].includes(
            extension,
          ) &&
          /\bgzip\b/.test(req.headers['accept-encoding'] || '')
        ) {
          res.setHeader('Content-Encoding', 'gzip');
          res.setHeader('Vary', 'Accept-Encoding');
          await pipeline(fs.createReadStream(file), zlib.createGzip(), res);
        } else {
          res.setHeader('Content-Length', stat.size);
          await pipeline(fs.createReadStream(file), res);
        }
      } catch (e) {
        if (res.headersSent) {
          res.destroy();
          return;
        }
        const status = e.status || (e.code === 'ENOENT' ? 404 : 500),
          message = e.status
            ? e.message
            : status === 404
              ? 'File tidak ditemukan.'
              : 'Backend gagal memproses permintaan. Periksa log server.';
        if (status >= 500) console.error('API gagal:', e.code || e.name);
        await send(req, res, status, { ok: false, error: message });
      }
    },
  );
}
module.exports = { createServer, dispatch };
