'use strict';
const { requirePermission, error } = require('./auth.cjs');
const { Store, id, now } = require('./store.cjs');
const { transaction } = require('./database.cjs');
async function proxy(service, p) {
  const action = String(p.action || 'listDashboard'),
    payload = p.payload || {},
    store = service.store;
  const read = ['status', 'listClusters', 'listDashboard', 'listDigest'],
    manage = ['runCollector', 'rebuildClusters', 'addCurated'];
  if (read.includes(action)) requirePermission(service.user, 'listening.view');
  else if (manage.includes(action))
    requirePermission(service.user, 'listening.manage');
  else if (action === 'markCandidate')
    requirePermission(service.user, 'listening.convert');
  else throw error('Aksi Social Listening tidak dikenal.');
  if (read.includes(action)) {
    const all = await store.list('listeningClusters'),
      byId = new Map();
    for (const row of all.sort((a, b) =>
      String(a.last_seen || a.updated_at || '').localeCompare(
        String(b.last_seen || b.updated_at || ''),
      ),
    ))
      byId.set(String(row.cluster_id || row.id), row);
    const rows = [...byId.values()].sort((a, b) =>
        String(b.last_seen || '').localeCompare(String(a.last_seen || '')),
      ),
      digests = await store.list('listeningDigests');
    if (action === 'status')
      return {
        ok: true,
        version: 'nimbus',
        source: 'postgresql',
        clusters: rows.length,
        digest: digests.length,
        collector_configured: !!process.env.LISTENING_API_URL,
      };
    const date =
        payload.digest_date ||
        digests
          .map((r) => String(r.date || '').slice(0, 10))
          .sort()
          .at(-1) ||
        '',
      seen = new Set();
    const digestRows = digests
      .filter((d) => String(d.date).slice(0, 10) === date)
      .sort((a, b) => Number(a.rank || 99) - Number(b.rank || 99))
      .flatMap((d) => {
        const row = byId.get(String(d.cluster_id));
        if (
          !row ||
          seen.has(row.cluster_id) ||
          ['REDUP', 'JADI HOT ISSUE'].includes(row.status)
        )
          return [];
        seen.add(row.cluster_id);
        return [
          {
            ...row,
            digest_date: date,
            digest_rank: Number(d.rank) || seen.size,
            why_it_matters: d.why_it_matters || '',
            is_digest: true,
          },
        ];
      })
      .slice(0, 7);
    if (action === 'listDigest')
      return { date, rows: digestRows, digest_count: digestRows.length };
    const executives = await store.list('listeningExecutive'),
      executive =
        executives.find((e) => String(e.date).slice(0, 10) === date) || null;
    return {
      rows: rows.slice(
        0,
        Math.max(1, Math.min(500, Number(payload.limit) || 500)),
      ),
      digest_rows: digestRows,
      digest_date: date,
      executive,
      cluster_count: rows.length,
      digest_count: digestRows.length,
      source: 'postgresql',
    };
  }
  if (action === 'addCurated' || action === 'markCandidate')
    return transaction(service.pool, async (db) => {
      const s = new Store(db);
      if (action === 'addCurated') {
        const judul = String(payload.judul || '').trim(),
          ringkasan = String(payload.ringkasan || '').trim();
        if (!judul || !ringkasan)
          throw error('Judul dan ringkasan wajib diisi.');
        const key = id('SLC'),
          record = {
            id: key,
            cluster_id: key,
            judul,
            ringkasan,
            sumber_utama: String(payload.sumber_utama || 'Kurasi Harian'),
            link_utama: String(payload.link_utama || ''),
            kategori: String(payload.kategori || 'Umum'),
            sentimen: String(payload.sentimen || 'Netral'),
            score: Math.max(0, Math.min(74, Number(payload.score) || 0)),
            confidence: 60,
            status: 'BARU',
            source_count: 1,
            item_count: 1,
            first_seen: now(),
            last_seen: now(),
            updated_at: now(),
          };
        await s.save('listeningClusters', record);
        return { record };
      }
      const rows = (await s.list('listeningClusters')).filter(
        (r) => String(r.cluster_id || r.id) === String(payload.cluster_id),
      );
      if (!rows.length) throw error('Cluster tidak ditemukan.', 404);
      if (!(await s.get('hotIssues', payload.hot_issue_id)))
        throw error('Hot Issue tujuan belum tersimpan.', 409);
      for (const row of rows)
        await s.save('listeningClusters', {
          ...row,
          status: 'JADI HOT ISSUE',
          hot_issue_id: payload.hot_issue_id,
          updated_at: now(),
        });
      return { updated: true };
    });
  const configured = process.env.LISTENING_API_URL;
  if (!configured)
    throw error(
      'Collector Social Listening perlu dikonfigurasi ulang pada hosting.',
      409,
    );
  const url = new URL(configured);
  if (url.protocol !== 'https:') throw error('URL collector harus HTTPS.');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.LISTENING_API_TOKEN
        ? { Authorization: 'Bearer ' + process.env.LISTENING_API_TOKEN }
        : {}),
    },
    body: JSON.stringify({ action, payload }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw error('Collector gagal (HTTP ' + response.status + ').', 502);
  const out = await response.json();
  if (out.ok === false) throw error('Collector menolak permintaan.', 502);
  return out.data || out;
}
module.exports = { proxy };
