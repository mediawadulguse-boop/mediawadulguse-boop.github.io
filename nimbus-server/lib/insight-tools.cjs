'use strict';
// Pure privacy and tracker helpers preserved from the previous backend.
const crypto = require('node:crypto');
const Utilities = {
  DigestAlgorithm: { SHA_256: 'sha256' },
  Charset: { UTF_8: 'utf8' },
  computeDigest: (algorithm, value) =>
    crypto.createHash(algorithm).update(value).digest(),
  base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString('base64url'),
};
function defaultInsightSettings_() {
  return {
    targets: {
      global: { realistis: 25000, optimis: 60000, ambisius: 120000 },
      categories: {
        Video: { realistis: 30000, optimis: 75000, ambisius: 150000 },
        Carousel: { realistis: 15000, optimis: 35000, ambisius: 70000 },
        'Single Post': { realistis: 10000, optimis: 25000, ambisius: 50000 },
        Live: { realistis: 20000, optimis: 50000, ambisius: 100000 },
      },
    },
    scoring: {
      weights: {
        target: 40,
        engagement: 25,
        share: 15,
        save: 10,
        completion: 10,
      },
      grades: { A: 85, B: 70, C: 55, D: 40 },
      benchmarks: {
        Instagram: { engagement: 5, share: 1, save: 1, completion: 35 },
        TikTok: { engagement: 8, share: 1.5, save: 2, completion: 35 },
        YouTube: { engagement: 4, share: 0.5, save: 0, completion: 45 },
        Facebook: { engagement: 5, share: 1, save: 0.5, completion: 30 },
      },
    },
    auto_update_hours: 24,
  };
}
function insightTrackerStatusV1155_(link) {
  if (link && link.last_error) return 'error';
  if (!insightHasMetricsV1155_(link)) return 'never';
  const confidence = Number(link.last_confidence || 0),
    validation = String(link.last_validation_status || '').toLowerCase();
  if (
    confidence < 80 ||
    ['review', 'partial', 'low', 'rejected'].indexOf(validation) >= 0
  )
    return 'review';
  return 'connected';
}
function insightHasMetricsV1155_(link) {
  const m = link && link.last_metrics;
  return !!(
    m &&
    typeof m === 'object' &&
    Object.keys(m).some(function (k) {
      return isFinite(Number(m[k]));
    })
  );
}
function insightManualOnlyV1155_(link) {
  return (
    ['Instagram', 'TikTok', 'YouTube', 'Facebook'].indexOf(
      String((link && link.platform) || ''),
    ) < 0
  );
}
function insightMatchesTrackerFilterV1155_(link, status) {
  if (!status) return true;
  if (status === 'manual') return insightManualOnlyV1155_(link);
  return insightTrackerStatusV1155_(link) === status;
}
function normalizeCapturedComments_(comments) {
  const seen = {},
    out = [];
  let totalChars = 0;
  const source = Array.isArray(comments) ? comments : [];
  for (let index = 0; index < Math.min(source.length, 300); index++) {
    const item = source[index] || {},
      text = maskCommentSensitiveText_(item.comment_text || item.text || '');
    if (!text || text.length < 2) continue;
    const key = text
      .toLowerCase()
      .replace(
        /[^a-z0-9\u00c0-\u024f\u1e00-\u1eff\u0400-\u04ff\u0600-\u06ff\u0900-\u097f\u3040-\u30ff\u4e00-\u9fff]+/gi,
        ' ',
      )
      .trim();
    if (!key || seen[key]) continue;
    const projected = totalChars + text.length + 120;
    if (projected > 38000) break;
    seen[key] = true;
    totalChars = projected;
    out.push({
      id: 'C' + String(index + 1).padStart(4, '0'),
      comment_text: text,
      author_hash: commentAuthorHash_(item.author || item.username || ''),
      like_count: Math.max(0, Number(item.like_count) || 0),
      source_selector: String(item.source_selector || '').slice(0, 250),
    });
    if (out.length >= 250) break;
  }
  return out;
}
function maskCommentSensitiveText_(value) {
  let text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  text = text.replace(
    /\b(?:\+?62|0)8[1-9][0-9\s.-]{7,15}\b/g,
    '[NOMOR TELEPON]',
  );
  text = text.replace(/\b\d{16}\b/g, '[NOMOR IDENTITAS]');
  text = text.replace(/\b\d{13,15}\b/g, '[NOMOR DOKUMEN]');
  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]');
  return text.slice(0, 1600);
}
function commentAuthorHash_(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (!raw) return '';
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    raw,
    Utilities.Charset.UTF_8,
  );
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/, '').slice(0, 20);
}
module.exports = {
  defaults: defaultInsightSettings_,
  status: insightTrackerStatusV1155_,
  manual: insightManualOnlyV1155_,
  matches: insightMatchesTrackerFilterV1155_,
  comments: normalizeCapturedComments_,
};
