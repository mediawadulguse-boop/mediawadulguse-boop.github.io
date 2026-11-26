'use strict';
// Pure clustering and analytics preserved from the existing application. No Google storage calls.
const crypto = require('node:crypto');
const Utilities = {
  DigestAlgorithm: { MD5: 'md5' },
  computeDigest: (algorithm, value) =>
    crypto.createHash(algorithm).update(value).digest(),
  base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString('base64url'),
};
function hotIssueClustersAdvancedV1269_(rows) {
  const rank = { Kritis: 4, Tinggi: 3, Sedang: 2, Rendah: 1 },
    ordered = (rows || []).slice().sort(function (a, b) {
      return (
        (rank[String(b.urgensi || '')] || 0) -
          (rank[String(a.urgensi || '')] || 0) ||
        hotIssueConfidenceV1269_(b) - hotIssueConfidenceV1269_(a)
      );
    }),
    clusters = [];
  ordered.forEach(function (r) {
    let best = null,
      bestScore = 0;
    clusters.forEach(function (c) {
      const sc = hotIssueAdvancedSimilarityV1269_(r, c.lead);
      if (sc > bestScore) {
        bestScore = sc;
        best = c;
      }
    });
    if (best && bestScore >= 0.34) {
      best.rows.push(r);
      if (
        (rank[String(r.urgensi || '')] || 0) >
        (rank[String(best.lead.urgensi || '')] || 0)
      )
        best.lead = r;
    } else clusters.push({ lead: r, rows: [r] });
  });
  return clusters
    .map(function (c, idx) {
      const sources = {},
        opds = {},
        cred = {},
        verification = {},
        ids = [],
        links = [];
      c.rows.forEach(function (r) {
        ids.push(String(r.id || ''));
        const src = String(r.sumber || '').trim();
        if (src) sources[src] = true;
        const opd = hotIssueOpdPrimaryV1269_(r);
        if (opd) opds[opd] = (opds[opd] || 0) + 1;
        const cr = hotIssueCredibilityV1269_(r);
        cred[cr] = (cred[cr] || 0) + 1;
        const vr = hotIssueVerifyV1269_(r);
        verification[vr] = (verification[vr] || 0) + 1;
        if (String(r.link || '').trim())
          links.push({
            id: String(r.id || ''),
            judul: String(r.judul || ''),
            sumber: src,
            link: String(r.link || ''),
            tanggal: String(r.tanggal || ''),
          });
      });
      const primaryOpd =
        Object.keys(opds).sort(function (a, b) {
          return opds[b] - opds[a];
        })[0] || '';
      return {
        cluster_id:
          'HIC-' +
          Utilities.base64EncodeWebSafe(
            Utilities.computeDigest(
              Utilities.DigestAlgorithm.MD5,
              String(c.lead.id || idx) + '|' + String(c.lead.judul || ''),
            ),
          )
            .replace(/=+$/, '')
            .slice(0, 12),
        title: String(c.lead.judul || 'Topik'),
        lead_id: String(c.lead.id || ''),
        mentions: c.rows.length,
        source_count: Object.keys(sources).length,
        urgency: String(c.lead.urgensi || ''),
        sentiment: String(c.lead.sentimen || ''),
        category: String(c.lead.kategori || ''),
        opd_primary: primaryOpd,
        confidence: Math.round(
          c.rows.reduce(function (n, r) {
            return n + hotIssueConfidenceV1269_(r);
          }, 0) / Math.max(1, c.rows.length),
        ),
        credibility: cred,
        verification: verification,
        ids: ids,
        evidence: links.slice(0, 30),
        rows: c.rows,
      };
    })
    .sort(function (a, b) {
      return (
        (rank[b.urgency] || 0) - (rank[a.urgency] || 0) ||
        b.mentions - a.mentions
      );
    });
}
function hotIssueConfidenceV1269_(r) {
  const d = hotIssueAiDetailV1265_(r);
  return Math.max(
    0,
    Math.min(
      100,
      Number(
        r && r.ai_confidence !== undefined ? r.ai_confidence : d.ai_confidence,
      ) || 0,
    ),
  );
}
function hotIssueAiDetailV1265_(record) {
  const raw = record && record.ai_detail;
  if (raw && typeof raw === 'object' && !Array.isArray(raw))
    return Object.assign({}, raw);
  try {
    const x = JSON.parse(String(raw || '{}'));
    return x && typeof x === 'object' && !Array.isArray(x) ? x : {};
  } catch (e) {
    return {};
  }
}
function hotIssueAdvancedSimilarityV1269_(a, b) {
  const base = hotIssueClusterSimilarityV1266_(
    hotIssueAdvancedTextV1269_(a),
    hotIssueAdvancedTextV1269_(b),
  );
  let bonus = 0;
  const ca = String((a && a.kategori) || ''),
    cb = String((b && b.kategori) || ''),
    oa = hotIssueOpdPrimaryV1269_(a),
    ob = hotIssueOpdPrimaryV1269_(b);
  if (ca && cb && ca === cb) bonus += 0.06;
  if (oa && ob && oa === ob) bonus += 0.08;
  const ea = hotIssueEntitiesV1269_(a),
    eb = hotIssueEntitiesV1269_(b),
    locA = []
      .concat(ea.lokasi || [], ea.kecamatan || [], ea.desa || [])
      .map(String),
    locB = []
      .concat(eb.lokasi || [], eb.kecamatan || [], eb.desa || [])
      .map(String);
  if (
    locA.some(function (x) {
      return locB.indexOf(x) >= 0;
    })
  )
    bonus += 0.08;
  return Math.min(1, base + bonus);
}
function hotIssueClusterSimilarityV1266_(a, b) {
  const A = hotIssueClusterTokensV1266_(a),
    B = hotIssueClusterTokensV1266_(b),
    ak = Object.keys(A),
    bk = Object.keys(B);
  if (!ak.length || !bk.length) return 0;
  let hit = 0;
  ak.forEach(function (x) {
    if (B[x]) hit++;
  });
  return hit / (ak.length + bk.length - hit);
}
function hotIssueClusterTokensV1266_(text) {
  const stop = {
      yang: 1,
      dan: 1,
      atau: 1,
      dari: 1,
      untuk: 1,
      pada: 1,
      dengan: 1,
      ini: 1,
      itu: 1,
      ada: 1,
      agar: 1,
      karena: 1,
      kami: 1,
      saya: 1,
      warga: 1,
      jember: 1,
      terkait: 1,
      mohon: 1,
      tolong: 1,
      dalam: 1,
      atas: 1,
      oleh: 1,
      akan: 1,
      sudah: 1,
      belum: 1,
    },
    out = {};
  String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .forEach(function (x) {
      if (x.length > 2 && !stop[x]) out[x] = true;
    });
  return out;
}
function hotIssueAdvancedTextV1269_(r) {
  const d = hotIssueAiDetailV1265_(r),
    e = hotIssueEntitiesV1269_(r),
    parts = [
      r && r.judul,
      r && r.ringkasan,
      r && r.deskripsi,
      r && r.kategori,
      hotIssueOpdPrimaryV1269_(r),
      (d.kata_kunci || []).join(' '),
    ];
  Object.keys(e || {}).forEach(function (k) {
    const v = e[k];
    parts.push(Array.isArray(v) ? v.join(' ') : String(v || ''));
  });
  return parts.join(' ');
}
function hotIssueEntitiesV1269_(r) {
  const d = hotIssueAiDetailV1265_(r),
    raw = r && r.entities_json !== undefined ? r.entities_json : d.entities;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const x = JSON.parse(String(raw || '{}'));
    return x && typeof x === 'object' && !Array.isArray(x) ? x : {};
  } catch (e) {
    return {};
  }
}
function hotIssueOpdPrimaryV1269_(r) {
  const d = hotIssueAiDetailV1265_(r);
  return String((r && r.opd_primary) || d.opd_rekomendasi || '').trim();
}
function hotIssueCredibilityV1269_(r) {
  const d = hotIssueAiDetailV1265_(r);
  return (
    String(
      (r && r.source_credibility) ||
        d.source_credibility ||
        'Belum Terverifikasi',
    ).trim() || 'Belum Terverifikasi'
  );
}
function hotIssueVerifyV1269_(r) {
  const d = hotIssueAiDetailV1265_(r);
  return (
    String(
      (r && r.verification_status) ||
        d.verification_status ||
        'Perlu Verifikasi',
    ).trim() || 'Perlu Verifikasi'
  );
}
function hotIssueOpdAnalyticsV1269_(rows) {
  const out = {};
  (rows || []).forEach(function (r) {
    const all = [hotIssueOpdPrimaryV1269_(r)]
      .concat(hotIssueOpdSupportV1269_(r))
      .filter(Boolean);
    all.forEach(function (opd, i) {
      const x =
        out[opd] ||
        (out[opd] = {
          opd: opd,
          total: 0,
          primary: 0,
          negative: 0,
          high: 0,
          open: 0,
          complaints: 0,
        });
      x.total++;
      if (i === 0) x.primary++;
      if (String(r.sentimen || '') === 'Negatif') x.negative++;
      if (['Tinggi', 'Kritis'].indexOf(String(r.urgensi || '')) >= 0) x.high++;
      if (
        hotIssueLifecycleV1269_(r) !== 'Selesai' &&
        hotIssueLifecycleV1269_(r) !== 'Arsip'
      )
        x.open++;
      if (String(r.aduan_id || '').trim()) x.complaints++;
    });
  });
  return Object.keys(out)
    .map(function (k) {
      return out[k];
    })
    .sort(function (a, b) {
      return b.total - a.total || b.high - a.high;
    })
    .slice(0, 20);
}
function hotIssueOpdSupportV1269_(r) {
  const d = hotIssueAiDetailV1265_(r);
  return hotIssueArrayV1269_(
    r && r.opd_support !== undefined ? r.opd_support : d.opd_pendukung,
  );
}
function hotIssueArrayV1269_(value) {
  if (Array.isArray(value))
    return value
      .map(function (x) {
        return String(x || '').trim();
      })
      .filter(Boolean);
  try {
    const x = JSON.parse(String(value || '[]'));
    return Array.isArray(x)
      ? x
          .map(function (y) {
            return String(y || '').trim();
          })
          .filter(Boolean)
      : [];
  } catch (e) {
    return String(value || '')
      .split(',')
      .map(function (x) {
        return x.trim();
      })
      .filter(Boolean);
  }
}
function hotIssueLifecycleV1269_(r) {
  const v = String((r && r.lifecycle_status) || '').trim();
  if (v) return v;
  const s = normalizeHotIssueStatusV1152_(r && r.status);
  if (s === 'Selesai') return 'Selesai';
  if (s === 'Dipantau') return 'Dipantau';
  return hotIssueAnalyzedAtV1265_(r) ? 'Dianalisis' : 'Baru';
}
function normalizeHotIssueStatusV1152_(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (['sudah menjadi aduan', 'menjadi aduan', 'aduan'].indexOf(raw) >= 0)
    return 'Sudah Menjadi Aduan';
  if (['dijadikan brief', 'sudah dijadikan brief', 'brief'].indexOf(raw) >= 0)
    return 'Dijadikan Brief';
  if (['selesai', 'sudah ditindaklanjuti', 'sudah'].indexOf(raw) >= 0)
    return 'Selesai';
  if (
    [
      'proses',
      'sedang diproses',
      'ditindaklanjuti',
      'dipantau',
      'monitoring',
    ].indexOf(raw) >= 0
  )
    return 'Dipantau';
  if (['diabaikan', 'abaikan'].indexOf(raw) >= 0) return 'Diabaikan';
  return 'Baru';
}
function hotIssueAnalyzedAtV1265_(record) {
  const d = hotIssueAiDetailV1265_(record);
  return String(
    d.analyzed_at ||
      (record && record.ai_analyzed_at) ||
      (String((record && record.ai_status) || '') === 'Selesai'
        ? record.updated_at || record.created_at || ''
        : '') ||
      '',
  );
}
function hotIssueEntityAnalyticsV1269_(rows) {
  const counts = {
    lokasi: {},
    kecamatan: {},
    desa: {},
    program: {},
    instansi: {},
    sekolah: {},
    tokoh: {},
  };
  (rows || []).forEach(function (r) {
    const e = hotIssueEntitiesV1269_(r);
    Object.keys(counts).forEach(function (k) {
      const vals = Array.isArray(e[k]) ? e[k] : e[k] ? [e[k]] : [];
      vals.forEach(function (v) {
        v = String(v || '').trim();
        if (v) counts[k][v] = (counts[k][v] || 0) + 1;
      });
    });
  });
  const out = {};
  Object.keys(counts).forEach(function (k) {
    out[k] = Object.keys(counts[k])
      .map(function (name) {
        return { name: name, count: counts[k][name] };
      })
      .sort(function (a, b) {
        return b.count - a.count;
      })
      .slice(0, 10);
  });
  return out;
}
function hotIssueLifecycleStatsV1269_(rows) {
  const out = {};
  [
    'Baru',
    'Dianalisis',
    'Dipantau',
    'Tindak Lanjut',
    'Selesai',
    'Arsip',
  ].forEach(function (k) {
    out[k] = 0;
  });
  (rows || []).forEach(function (r) {
    const k = hotIssueLifecycleV1269_(r);
    out[k] = (out[k] || 0) + 1;
  });
  return out;
}
function hotIssueEarlyWarningsV1269_(trend) {
  const days = Number(trend.days) || 7,
    dates = trend.dates || [],
    today = dates[dates.length - 1],
    rows = trend.range_rows || [],
    rank = { Kritis: 4, Tinggi: 3, Sedang: 2, Rendah: 1 };
  return (trend.clusters_full || [])
    .map(function (c) {
      const series = c.series || [],
        todayCount = (series[series.length - 1] || {}).count || 0,
        baseRows = series.slice(0, -1),
        baseAvg = baseRows.length
          ? baseRows.reduce(function (n, x) {
              return n + (Number(x.count) || 0);
            }, 0) / baseRows.length
          : 0,
        growth = baseAvg
          ? todayCount / baseAvg
          : todayCount > 0
            ? todayCount
            : 0,
        urg = rank[String(c.urgency || '')] || 1,
        source = Math.min(1, (Number(c.source_count) || 0) / 4),
        growthScore = Math.min(1, growth / 3),
        score = Math.round((urg / 4) * 40 + source * 25 + growthScore * 35);
      let label = 'Stabil';
      if (todayCount >= 3 && score >= 75) label = 'Lonjakan Kritis';
      else if (todayCount >= 2 && score >= 60) label = 'Lonjakan Tinggi';
      else if (
        todayCount >= 1 &&
        (growth >= 1.5 || c.direction === 'Baru' || c.direction === 'Naik')
      )
        label = 'Mulai Naik';
      return Object.assign({}, c, {
        today_count: todayCount,
        baseline_avg: Math.round(baseAvg * 10) / 10,
        growth_ratio: Math.round(growth * 10) / 10,
        spike_score: score,
        early_warning: label,
      });
    })
    .filter(function (x) {
      return x.early_warning !== 'Stabil';
    })
    .sort(function (a, b) {
      return b.spike_score - a.spike_score || b.today_count - a.today_count;
    })
    .slice(0, 10);
}
module.exports = {
  hotIssueClustersAdvanced: hotIssueClustersAdvancedV1269_,
  hotIssueAdvancedSimilarity: hotIssueAdvancedSimilarityV1269_,
  hotIssueOpdAnalytics: hotIssueOpdAnalyticsV1269_,
  hotIssueEntityAnalytics: hotIssueEntityAnalyticsV1269_,
  hotIssueLifecycleStats: hotIssueLifecycleStatsV1269_,
  hotIssueEarlyWarnings: hotIssueEarlyWarningsV1269_,
  hotIssueCredibility: hotIssueCredibilityV1269_,
  hotIssueVerify: hotIssueVerifyV1269_,
};
