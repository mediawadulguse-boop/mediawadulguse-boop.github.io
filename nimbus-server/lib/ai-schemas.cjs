'use strict';
// Response schemas preserved from the existing application.
function hotIssueDailySchemaV1265_() {
  return {
    type: 'object',
    properties: {
      executive_summary: { type: 'string' },
      daily_analysis: { type: 'string' },
      key_findings: { type: 'array', items: { type: 'string' } },
      recommendations: { type: 'array', items: { type: 'string' } },
      priority_issues: { type: 'array', items: { type: 'string' } },
    },
    required: [
      'executive_summary',
      'daily_analysis',
      'key_findings',
      'recommendations',
      'priority_issues',
    ],
  };
}
function hotIssueAiSchema_() {
  return {
    type: 'object',
    properties: {
      sentimen: {
        type: 'string',
        enum: ['Positif', 'Netral', 'Negatif', 'Campuran'],
      },
      kategori: {
        type: 'string',
        enum: [
          'Pelayanan Publik',
          'Infrastruktur',
          'Kesehatan',
          'Pendidikan',
          'Sosial',
          'Ekonomi',
          'Ketertiban',
          'Bencana',
          'Pemerintahan',
          'Lingkungan',
          'Pariwisata',
          'Lainnya',
        ],
      },
      urgensi: {
        type: 'string',
        enum: ['Rendah', 'Sedang', 'Tinggi', 'Kritis'],
      },
      tipe_isu: {
        type: 'string',
        enum: [
          'Aduan',
          'Pertanyaan',
          'Informasi',
          'Klarifikasi',
          'Krisis',
          'Apresiasi',
        ],
      },
      ringkasan: { type: 'string' },
      kata_kunci: { type: 'array', items: { type: 'string' } },
      konten_pilar: {
        type: 'string',
        enum: [
          "Kabar Gus'e",
          "Kasih Tau Gus'e",
          "Sidak Gus'e",
          'Tindak Lanjut',
          'Infografis',
          'Homecare',
          'Human Interest',
          'Lainnya',
        ],
      },
      opd_rekomendasi: { type: 'string' },
      opd_pendukung: { type: 'array', items: { type: 'string' } },
      source_credibility: {
        type: 'string',
        enum: [
          'Resmi',
          'Media',
          'Komunitas',
          'Masyarakat',
          'Belum Terverifikasi',
        ],
      },
      verification_status: {
        type: 'string',
        enum: [
          'Terverifikasi dari teks',
          'Perlu Verifikasi',
          'Belum Terverifikasi',
        ],
      },
      ai_confidence: { type: 'integer', minimum: 0, maximum: 100 },
      entities: {
        type: 'object',
        properties: {
          lokasi: { type: 'array', items: { type: 'string' } },
          kecamatan: { type: 'array', items: { type: 'string' } },
          desa: { type: 'array', items: { type: 'string' } },
          program: { type: 'array', items: { type: 'string' } },
          instansi: { type: 'array', items: { type: 'string' } },
          sekolah: { type: 'array', items: { type: 'string' } },
          tokoh: { type: 'array', items: { type: 'string' } },
        },
      },
      rekomendasi_ai: { type: 'string' },
      alasan_ai: { type: 'string' },
      skor_prioritas: { type: 'integer', minimum: 0, maximum: 100 },
      judul_saran: { type: 'string' },
    },
    required: [
      'sentimen',
      'kategori',
      'urgensi',
      'tipe_isu',
      'ringkasan',
      'kata_kunci',
      'konten_pilar',
      'opd_rekomendasi',
      'opd_pendukung',
      'source_credibility',
      'verification_status',
      'ai_confidence',
      'entities',
      'rekomendasi_ai',
      'alasan_ai',
      'skor_prioritas',
      'judul_saran',
    ],
  };
}
function aiDraftBriefSchema_() {
  return {
    type: 'object',
    properties: {
      judul: { type: 'string' },
      tujuan: { type: 'array', items: { type: 'string' } },
      detail_brief: { type: 'string' },
    },
    required: ['judul', 'tujuan', 'detail_brief'],
  };
}
function aiBriefReviewSchema_() {
  return {
    type: 'object',
    properties: {
      score: { type: 'integer', minimum: 0, maximum: 100 },
      status: {
        type: 'string',
        enum: [
          'Siap Produksi',
          'Perlu Perbaikan Ringan',
          'Perlu Perbaikan Besar',
        ],
      },
      strengths: { type: 'array', items: { type: 'string' } },
      gaps: { type: 'array', items: { type: 'string' } },
      recommendations: { type: 'array', items: { type: 'string' } },
      improved_judul: { type: 'string' },
      improved_tujuan: { type: 'string' },
      improved_detail_brief: { type: 'string' },
      suggested_cta: { type: 'string' },
      missing_facts_to_verify: { type: 'array', items: { type: 'string' } },
    },
    required: [
      'score',
      'status',
      'strengths',
      'gaps',
      'recommendations',
      'improved_judul',
      'improved_tujuan',
      'improved_detail_brief',
      'suggested_cta',
      'missing_facts_to_verify',
    ],
  };
}
function aiInsightNarrativeSchema_() {
  return {
    type: 'object',
    properties: {
      executive_summary: { type: 'string' },
      key_findings: { type: 'array', items: { type: 'string' } },
      strengths: { type: 'array', items: { type: 'string' } },
      weaknesses: { type: 'array', items: { type: 'string' } },
      platform_comparison: { type: 'array', items: { type: 'string' } },
      audience_response: { type: 'string' },
      recommendations: { type: 'array', items: { type: 'string' } },
      next_content_ideas: { type: 'array', items: { type: 'string' } },
      limitations: { type: 'array', items: { type: 'string' } },
    },
    required: [
      'executive_summary',
      'key_findings',
      'strengths',
      'weaknesses',
      'platform_comparison',
      'audience_response',
      'recommendations',
      'next_content_ideas',
      'limitations',
    ],
  };
}
function aiStudioChatSchema_() {
  return {
    type: 'object',
    properties: {
      answer: { type: 'string' },
      action_suggestions: { type: 'array', items: { type: 'string' } },
      warnings: { type: 'array', items: { type: 'string' } },
      sources_used: { type: 'array', items: { type: 'string' } },
    },
    required: ['answer', 'action_suggestions', 'warnings', 'sources_used'],
  };
}
function commentAnalysisSchema_() {
  return {
    type: 'object',
    properties: {
      sentiment_summary: {
        type: 'object',
        properties: {
          positif: { type: 'integer' },
          netral: { type: 'integer' },
          negatif: { type: 'integer' },
          campuran_tidak_pasti: { type: 'integer' },
        },
        required: ['positif', 'netral', 'negatif', 'campuran_tidak_pasti'],
      },
      intent_summary: {
        type: 'object',
        properties: {
          apresiasi: { type: 'integer' },
          pertanyaan: { type: 'integer' },
          keluhan: { type: 'integer' },
          kritik: { type: 'integer' },
          usulan: { type: 'integer' },
          permintaan_bantuan: { type: 'integer' },
          candaan_lainnya: { type: 'integer' },
        },
        required: [
          'apresiasi',
          'pertanyaan',
          'keluhan',
          'kritik',
          'usulan',
          'permintaan_bantuan',
          'candaan_lainnya',
        ],
      },
      topics: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            topic: { type: 'string' },
            count: { type: 'integer' },
            sentiment_dominant: { type: 'string' },
            recommended_action: { type: 'string' },
          },
          required: [
            'topic',
            'count',
            'sentiment_dominant',
            'recommended_action',
          ],
        },
      },
      needs_response_count: { type: 'integer' },
      potential_complaint_count: { type: 'integer' },
      summary: { type: 'string' },
      recommendations: { type: 'array', items: { type: 'string' } },
      limitations: { type: 'array', items: { type: 'string' } },
    },
    required: [
      'sentiment_summary',
      'intent_summary',
      'topics',
      'needs_response_count',
      'potential_complaint_count',
      'summary',
      'recommendations',
      'limitations',
    ],
  };
}
function insightScreenshotSchemaV1290_() {
  const metricProps = {};
  [
    'views',
    'reach',
    'impressions',
    'viewers',
    'interactions',
    'accounts_engaged',
    'likes',
    'comments',
    'shares',
    'saves',
    'watch_time_seconds',
    'avg_watch_time_seconds',
    'completion_rate',
    'followers_gained',
    'profile_visits',
    'profile_activity',
    'clicks',
    'external_link_taps',
    'business_address_taps',
    'subscribers_gained',
    'followers_view_pct',
    'non_followers_view_pct',
    'followers_interaction_pct',
    'non_followers_interaction_pct',
    'views_from_home',
    'views_from_other',
    'views_from_profile',
  ].forEach(function (k) {
    metricProps[k] = { type: 'number' };
  });
  return {
    type: 'object',
    properties: {
      platform: {
        type: 'string',
        enum: [
          'Instagram',
          'TikTok',
          'YouTube',
          'Facebook',
          'X',
          'Threads',
          'Website',
          'Lainnya',
        ],
      },
      screenshot_type: {
        type: 'string',
        enum: ['analytics', 'public_post', 'unknown'],
      },
      account_label: { type: 'string' },
      content_type: { type: 'string' },
      visible_url: { type: 'string' },
      public_content_url: { type: 'string' },
      metrics: { type: 'object', properties: metricProps },
      confidence: { type: 'integer', minimum: 0, maximum: 100 },
      summary: { type: 'string' },
      warnings: { type: 'array', items: { type: 'string' } },
    },
    required: [
      'platform',
      'screenshot_type',
      'account_label',
      'content_type',
      'visible_url',
      'public_content_url',
      'metrics',
      'confidence',
      'summary',
      'warnings',
    ],
  };
}
module.exports = {
  hotIssueAiSchema: hotIssueAiSchema_,
  hotIssueDailySchema: hotIssueDailySchemaV1265_,
  aiDraftBriefSchema: aiDraftBriefSchema_,
  aiBriefReviewSchema: aiBriefReviewSchema_,
  aiInsightNarrativeSchema: aiInsightNarrativeSchema_,
  aiStudioChatSchema: aiStudioChatSchema_,
  commentAnalysisSchema: commentAnalysisSchema_,
  insightScreenshotSchema: insightScreenshotSchemaV1290_,
};
