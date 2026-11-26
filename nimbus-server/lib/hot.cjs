'use strict';
const { requirePermission, error } = require('./auth.cjs');
const { now, today } = require('./store.cjs');
const a = require('./hot-algorithms.cjs');
function shift(date, days) {
  const d = new Date(date + 'T12:00:00Z');
  if (!Number.isFinite(d.getTime())) throw error('Tanggal tidak valid.');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function trend(all, end = today(), days = 7) {
  days = Number(days) === 30 ? 30 : 7;
  const dates = Array.from({ length: days }, (_, i) =>
    shift(end, i - days + 1),
  );
  const rows = all.filter(
    (r) =>
      String(r.tanggal).slice(0, 10) >= dates[0] &&
      String(r.tanggal).slice(0, 10) <= end,
  );
  const clusters = a.hotIssueClustersAdvanced(rows);
  for (const c of clusters) {
    c.series = dates.map((date) => ({
      date,
      count: c.rows.filter((r) => String(r.tanggal).slice(0, 10) === date)
        .length,
    }));
    const recentDays = days === 7 ? 3 : 7,
      recent = c.series.slice(-recentDays).reduce((n, x) => n + x.count, 0),
      prior = c.series.slice(0, -recentDays).reduce((n, x) => n + x.count, 0),
      ra = recent / recentDays,
      pa = prior / (days - recentDays);
    const pct = pa ? Math.round(((ra - pa) / pa) * 100) : ra ? null : 0,
      peak = [...c.series].sort((x, y) => y.count - x.count)[0];
    Object.assign(c, {
      direction:
        pct === null
          ? 'Baru'
          : pct >= 35
            ? 'Naik'
            : pct <= -35
              ? 'Turun'
              : 'Stabil',
      change_pct: pct,
      total: c.mentions,
      recent,
      prior,
      peak_date: peak.date,
      peak_count: peak.count,
    });
    delete c.rows;
  }
  const done = rows.filter((r) => r.ai_status === 'Selesai').length;
  return {
    days,
    start_date: dates[0],
    end_date: end,
    dates,
    daily_totals: dates.map((date) => ({
      date,
      total: rows.filter((r) => String(r.tanggal).slice(0, 10) === date).length,
      analyzed: rows.filter(
        (r) =>
          String(r.tanggal).slice(0, 10) === date && r.ai_status === 'Selesai',
      ).length,
    })),
    topics: clusters
      .sort((x, y) => y.recent - x.recent || y.total - x.total)
      .slice(0, 12),
    coverage: {
      total: rows.length,
      analyzed: done,
      pending: rows.length - done,
      percent: rows.length ? Math.round((done / rows.length) * 100) : 100,
    },
    range_rows: rows,
    clusters_full: clusters,
  };
}
async function read(service, action, p) {
  requirePermission(service.user, 'hotissue.view');
  const all = await service.domain.visible('hotIssues');
  if (action === 'getHotIssueEvidence') {
    const target = all.find((r) => String(r.id) === String(p.id));
    if (!target) throw error('Hot Issue tidak ditemukan.', 404);
    const end = String(target.tanggal || today()).slice(0, 10),
      start = shift(end, -Math.max(7, Math.min(90, Number(p.days) || 30)) + 1);
    const rows = all
      .filter(
        (r) =>
          String(r.tanggal).slice(0, 10) >= start &&
          String(r.tanggal).slice(0, 10) <= end,
      )
      .map((r) => ({
        ...r,
        similarity: Math.round(
          (r.id === target.id ? 1 : a.hotIssueAdvancedSimilarity(target, r)) *
            100,
        ),
      }))
      .filter((r) => r.similarity >= 32)
      .sort((x, y) => y.similarity - x.similarity)
      .slice(0, 30);
    return {
      hot_issue_id: target.id,
      rows,
      total: rows.length,
      generated_at: now(),
    };
  }
  let end = p.end_date || p.date || today();
  if (action === 'getHotIssueWeeklyIntelligence') {
    const day = new Date(end + 'T12:00:00Z').getUTCDay();
    end = shift(end, 6 - ((day + 6) % 7));
  }
  const out = trend(all, end, p.days),
    rows = out.range_rows,
    alerts = a.hotIssueEarlyWarnings(out),
    opd = a.hotIssueOpdAnalytics(rows),
    entities = a.hotIssueEntityAnalytics(rows),
    lifecycle = a.hotIssueLifecycleStats(rows),
    credibility = {},
    verification = {};
  for (const r of rows) {
    const c = a.hotIssueCredibility(r),
      v = a.hotIssueVerify(r);
    credibility[c] = (credibility[c] || 0) + 1;
    verification[v] = (verification[v] || 0) + 1;
  }
  delete out.range_rows;
  delete out.clusters_full;
  if (action === 'getHotIssueTrend7Days')
    return { ...out, generated_at: now() };
  if (action === 'getHotIssueWeeklyIntelligence') {
    const stats = {
      total: rows.length,
      negative: rows.filter((r) => r.sentimen === 'Negatif').length,
      high: rows.filter((r) => ['Tinggi', 'Kritis'].includes(r.urgensi)).length,
      complaints: rows.filter((r) => r.aduan_id).length,
      briefs: rows.filter((r) => r.status === 'Dijadikan Brief').length,
    };
    return {
      record: {
        week_start: out.start_date,
        week_end: end,
        summary_text: `Periode ${out.start_date} s.d. ${end}: ${stats.total} Hot Issue; ${stats.negative} negatif, ${stats.high} urgensi tinggi/kritis.`,
        top_topics: out.topics,
        opd_stats: opd,
        entity_stats: entities,
        alerts,
        stats_json: stats,
        generated_at: now(),
      },
      generated_at: now(),
    };
  }
  return {
    trend: out,
    alerts,
    opd_analytics: opd,
    entities,
    lifecycle,
    credibility,
    verification,
    generated_at: now(),
  };
}
module.exports = { read, trend, shift };
