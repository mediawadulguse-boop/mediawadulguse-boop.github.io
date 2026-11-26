'use strict';
const zlib = require('node:zlib');
const {
  Domain,
  READ,
  WRITE,
  array,
  parse,
  archived,
  norm,
} = require('./domain.cjs');
const { Store, id, now, today, clean } = require('./store.cjs');
const {
  error,
  has,
  requirePermission,
  ownTask,
  publicProfile,
  fingerprint,
} = require('./auth.cjs');
const { transaction } = require('./database.cjs');
const VERSION = '1.36.1-nimbus';
let RELEASE = 'local';
try {
  RELEASE = JSON.parse(
    require('node:fs').readFileSync(
      require('node:path').join(__dirname, '..', 'release.json'),
      'utf8',
    ),
  ).revision;
} catch {}
const CAPABILITIES = [
  'simple_core_sync_v1180',
  'simple_sync_v1221',
  'workspace_lite_v1190',
  'nimbus_postgresql_v1',
];
const health = () => ({
  app: "MEDIA WADUL GUS'E",
  version: VERSION,
  revision: RELEASE,
  backend: 'nimbus',
  message: 'Node.js API aktif',
});
const page = (rows, p = {}) => {
  const limit = Math.min(100, Math.max(1, Number(p.limit) || 15)),
    number = Math.max(1, Number(p.page) || 1);
  return {
    rows: rows.slice((number - 1) * limit, number * limit),
    total: rows.length,
    page: number,
    limit,
    total_pages: Math.max(1, Math.ceil(rows.length / limit)),
  };
};
const dateKey = (v) => String(v || '').slice(0, 10);
const canonical = (value) =>
  JSON.stringify(
    Array.isArray(value)
      ? value.map((x) => JSON.parse(canonical(x)))
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((k) => [k, JSON.parse(canonical(value[k]))]),
          )
        : (value ?? null),
  );
const SAVE = {
  saveHotIssue: 'hotIssues',
  saveMeeting: 'meetings',
  saveTemplate: 'templates',
  saveFootage: 'footages',
  saveHtmlDocument: 'htmlDocuments',
  saveAiRule: 'aiRules',
  saveAiExample: 'aiExamples',
  saveAiFeedback: 'aiFeedback',
};
const DELETE = {
  deleteBrief: 'briefs',
  deleteTask: 'tasks',
  deleteHotIssue: 'hotIssues',
  deleteMeeting: 'meetings',
  deleteTemplate: 'templates',
  deleteFootage: 'footages',
  deleteHtmlDocument: 'htmlDocuments',
  deleteAccount: 'accounts',
  deleteAiRule: 'aiRules',
  deleteAiExample: 'aiExamples',
};
const MUTATIONS = new Set([
  ...Object.keys(SAVE),
  ...Object.keys(DELETE),
  'saveBrief',
  'saveTask',
  'patchBrief',
  'syncBriefRelations',
  'patchHotIssue',
  'startHotIssueComplaint',
  'finalizeHotIssueComplaint',
  'cancelHotIssueComplaint',
  'updateHotIssueWorkflow',
  'saveHotIssueIntelligenceFeedback',
  'updateBriefField',
  'quickUpdateBriefField',
  'updateTaskField',
  'quickUpdateTaskField',
  'setBriefArchive',
  'setTaskArchive',
  'markBriefWhatsAppSent',
  'saveAccount',
  'saveAccountPermissions',
  'saveSystemSettings',
  'saveGeminiSettings',
  'saveInsightSnapshot',
  'saveCommentCapture',
  'bulkImportHotIssues',
  'markNotificationRead',
  'markAllNotificationsRead',
  'clearErrorLogs',
  'logClientError',
  'repairSystemCache',
  'repairAiStudioSetup',
]);

class Service {
  constructor(pool, user) {
    this.pool = pool;
    this.user = user;
    this.domain = new Domain(pool, user);
    this.store = this.domain.store;
  }
  async settings() {
    const raw = await this.store.settings();
    const allowed = [
      'staff_roster',
      'insight_tracker',
      'brief_defaults',
      'gemini_ai',
    ];
    const out = {};
    for (const key of allowed) if (raw[key]) out[key] = raw[key];
    if (!out.insight_tracker)
      out.insight_tracker = require('./insight-tools.cjs').defaults();
    const cfg = raw.gemini_ai || {},
      key = process.env.GEMINI_API_KEY || cfg.api_key || '';
    out.gemini_ai = {
      configured: !!key,
      enabled: !!key && cfg.enabled !== false,
      model: process.env.GEMINI_MODEL || cfg.model || 'gemini-3.1-flash-lite',
      auto_analyze: cfg.auto_analyze !== false,
      key_hint: key ? '••••' + key.slice(-4) : '',
    };
    return out;
  }
  async references() {
    const revision = await this.store.revision();
    return {
      accounts: await this.domain.accounts({ admin: true }),
      templates: await this.domain.visible('templates'),
      revisions: { accounts: String(revision), templates: String(revision) },
      complete: true,
      generated_at: now(),
    };
  }
  async core() {
    const briefs = await this.domain.visible('briefs'),
      tasks = await this.domain.visible('tasks'),
      cursor = await this.store.revision();
    return {
      briefs,
      tasks,
      accounts: has(this.user, 'account.view')
        ? await this.domain.accounts({ admin: true })
        : [],
      cursor,
      revision: String(cursor),
      generated_at: now(),
      server_counts: { briefs: briefs.length, tasks: tasks.length },
      sheet_rows: { briefs: briefs.length, tasks: tasks.length },
      apiInfo: { ...health(), capabilities: CAPABILITIES },
    };
  }
  async module(kind) {
    if (kind === 'dashboard')
      return {
        kind,
        data: await this.dashboard(),
        full: true,
        generated_at: now(),
      };
    if (['calendar', 'kanban', 'reporting'].includes(kind))
      return { kind, rows: [], full: true, derived: true, generated_at: now() };
    const rows = await this.domain.visible(kind);
    return {
      kind,
      rows,
      full: true,
      cursor: await this.store.revision(),
      revision: String(await this.store.revision()),
      server_count: rows.length,
      sheet_rows: rows.length,
      generated_at: now(),
      verified_direct_read: true,
    };
  }
  async dashboard() {
    requirePermission(this.user, 'dashboard.view');
    const b = (await this.domain.visible('briefs')).filter((x) => !archived(x)),
      t = (await this.domain.visible('tasks')).filter((x) => !archived(x)),
      h = await this.domain.visible('hotIssues');
    return {
      revision: String(await this.store.revision()),
      generated_at: now(),
      brief_total: b.length,
      task_total: t.length,
      hotIssues: {
        total: h.length,
        critical: h.filter((x) => ['Kritis', 'Tinggi'].includes(x.urgensi))
          .length,
        negative: h.filter((x) => norm(x.sentimen) === 'negatif').length,
        rows: h.slice(0, 5),
      },
    };
  }
  async read(action, p = {}) {
    const d = this.domain,
      s = this.store;
    if (['health', 'healthCheck'].includes(action)) {
      if (action === 'health') return health();
      requirePermission(this.user, 'health.view');
      return {
        ...health(),
        ok: true,
        database: 'PostgreSQL',
        revision: String(await s.revision()),
        integrity: await this.relations(),
        capabilities: CAPABILITIES,
        generated_at: now(),
      };
    }
    if (action === 'getMyPermissions')
      return {
        permissions: this.user.permissions || [],
        permissions_override: !!this.user.permissions_override,
      };
    if (action === 'getReferencePack') return this.references();
    if (
      [
        'getCoreDataSimple',
        'getCoreIndexV122',
        'getWorkspaceLite',
        'bootstrap',
        'bootstrapFast',
      ].includes(action)
    ) {
      const core = await this.core();
      if (action === 'getWorkspaceLite')
        return {
          ...core,
          account_options: (await this.references()).accounts,
          workspace_counts: core.server_counts,
          total_counts: core.server_counts,
        };
      if (action === 'bootstrap' || action === 'bootstrapFast')
        return {
          ...core,
          ...(await this.references()),
          notifications: await d.visible('notifications'),
          systemSettings: await this.settings(),
        };
      return core;
    }
    if (
      [
        'getModuleDataSimple',
        'getModuleIndexV122',
        'getVerifiedModuleIndexV1315',
        'getMeetingIndexV1306',
        'getModuleData',
      ].includes(action)
    )
      return this.module(
        action === 'getMeetingIndexV1306' ? 'meetings' : String(p.kind || ''),
      );
    if (action === 'getLazyModule') {
      const kind = p.kind === 'versions' ? 'briefHistory' : p.kind;
      if (kind === 'systemStatus') {
        requirePermission(this.user, 'health.view');
        return {
          kind,
          data: {
            enabled: true,
            storage: 'PostgreSQL',
            backup_external_required: true,
          },
        };
      }
      return this.module(kind);
    }
    const details = {
      getBriefDetail: 'briefs',
      getTaskDetail: 'tasks',
      getHotIssueDetail: 'hotIssues',
      getMeetingDetail: 'meetings',
    };
    if (details[action])
      return { record: await d.detail(details[action], p.id) };
    if (action === 'getFootages') return { rows: await d.visible('footages') };
    if (action === 'getBriefPage' || action === 'getTaskPage') {
      const kind = action === 'getBriefPage' ? 'briefs' : 'tasks',
        q = norm(p.search),
        isBrief = kind === 'briefs';
      let rows = (await d.visible(kind)).filter(
        (r) =>
          (p.archive === 'all' || (p.archive === 'archived') === archived(r)) &&
          (!q ||
            norm(
              [
                r.id,
                r.judul,
                r.judul_tugas,
                r.petugas,
                r.jobdesk,
                r.detail_brief,
                r.catatan,
              ].join(' '),
            ).includes(q)) &&
          (!p.status || r.status === p.status) &&
          (!p.category || r.kategori_konten === p.category) &&
          (!p.priority || r.prioritas === p.priority) &&
          (!p.date || dateKey(r.tanggal) === dateKey(p.date)),
      );
      if (!isBrief) {
        const briefs = new Map(
          (await d.visible('briefs')).map((b) => [String(b.id), b.judul]),
        );
        rows = rows.map((t) => ({
          ...t,
          brief_title: briefs.get(String(t.brief_id)) || '',
        }));
      }
      const sort = p.sort_key || (isBrief ? 'tanggal' : 'created_at');
      rows.sort((a, b) =>
        String(b[sort] || '').localeCompare(String(a[sort] || '')),
      );
      const summary = {
        total: rows.length,
        active: rows.filter((x) =>
          isBrief
            ? ['Planning', 'Produksi', 'Review'].includes(x.status)
            : x.status !== 'Selesai',
        ).length,
        published: rows.filter((x) => ['Publish', 'Insight'].includes(x.status))
          .length,
        draft: rows.filter((x) => (x.status || 'Draft') === 'Draft').length,
        done: rows.filter((x) => x.status === 'Selesai').length,
        today: rows.filter((x) => dateKey(x.deadline) === today()).length,
        overdue: rows.filter(
          (x) =>
            x.deadline &&
            dateKey(x.deadline) < today() &&
            !['Publish', 'Insight', 'Selesai'].includes(x.status),
        ).length,
      };
      return { ...page(rows, p), summary };
    }
    if (action === 'getCalendarWindowV123') {
      requirePermission(this.user, 'calendar.view');
      const inRange = (v) =>
          v &&
          (!p.from || dateKey(v) >= p.from) &&
          (!p.to || dateKey(v) <= p.to),
        briefs = (await d.visible('briefs')).filter(
          (b) => !archived(b) && (inRange(b.tanggal) || inRange(b.deadline)),
        ),
        ids = new Set(briefs.map((b) => String(b.id))),
        tasks = (await d.visible('tasks')).filter((t) =>
          ids.has(String(t.brief_id)),
        );
      return {
        briefs,
        tasks,
        window: { from: p.from, to: p.to, days: 42 },
        generated_at: now(),
        performance: { mode: 'postgresql_calendar' },
      };
    }
    if (action === 'publicCalendar') {
      // Authenticated projection: publishing an unauthenticated calendar is a separate decision.
      requirePermission(this.user, 'calendar.view');
      return (await d.visible('briefs'))
        .filter((x) => !archived(x))
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
    }
    if (action === 'getDashboardSummaryFast') return this.dashboard();
    if (action === 'globalSearchLite') {
      const q = norm(p.q);
      if (!q) return { rows: [] };
      const rows = [];
      for (const [kind, type, title, meta] of [
        ['briefs', 'brief', 'judul', 'status'],
        ['tasks', 'task', 'judul_tugas', 'petugas'],
      ])
        for (const r of await d.visible(kind))
          if (
            rows.length < 12 &&
            norm([r.id, r[title], r[meta]].join(' ')).includes(q)
          )
            rows.push({ type, id: r.id, title: r[title], meta: r[meta] || '' });
      return { rows };
    }
    if (action === 'getSystemSettings') {
      requirePermission(this.user, 'settings.view');
      return this.settings();
    }
    if (action === 'getBriefHistory') {
      await d.detail('briefs', p.brief_id || p.id);
      return {
        rows: (
          await s.list('briefHistory', 'brief_id', p.brief_id || p.id)
        ).slice(0, 100),
      };
    }
    if (action === 'getSyncIndex') {
      const cursor = String(await s.revision());
      return {
        version: VERSION,
        revision: cursor,
        modules: Object.fromEntries(
          Object.keys(READ).map((k) => [k, { revision: cursor }]),
        ),
        generated_at: now(),
      };
    }
    if (action === 'getChangesSince')
      return {
        ...(await this.core()),
        notifications: await d.visible('notifications'),
        not_modified: false,
      };
    if (action === 'getSyncChangesV122') return this.delta(p);
    if (action === 'verifySimpleCrudBatch') {
      const rows = [];
      for (const item of array(p.items).slice(0, 30)) {
        const result = await this.pool.query(
          'SELECT result FROM mwg_requests WHERE user_id=$1 AND request_id=$2',
          [this.user.id, String(item.request_id || '')],
        );
        rows.push({
          request_id: String(item.request_id || ''),
          status: result.rows.length ? 'SUCCESS' : 'PENDING',
          result: result.rows[0]?.result || null,
        });
      }
      return { rows, generated_at: now() };
    }
    if (action === 'verifyBriefSave' || action === 'verifyHtmlDocumentSave') {
      const kind = action === 'verifyBriefSave' ? 'briefs' : 'htmlDocuments',
        row = (await d.visible(kind)).find(
          (x) => String(x.id) === String(p.record?.id || p.id),
        );
      return {
        saved:
          !!row &&
          (!p.record?.content_sha256 ||
            row.content_sha256 === p.record.content_sha256),
        record: row || null,
      };
    }
    if (action === 'verifyEntityMutation') {
      const request = p.payload?._request_id || p.payload?.record?._request_id;
      if (request) {
        const result = await this.pool.query(
          'SELECT result FROM mwg_requests WHERE user_id=$1 AND request_id=$2',
          [this.user.id, request],
        );
        return { matched: !!result.rows.length, ...result.rows[0]?.result };
      }
      return { matched: false, reason: 'request_id_required' };
    }
    if (action === 'getHtmlDocumentContent') {
      await d.detail('htmlDocuments', p.id);
      const row = await s.get('htmlDocuments', p.id);
      if (!row.html_content)
        throw error(
          'HTML lama berada di Google Drive. Materialisasikan file saat migrasi.',
          409,
        );
      return { ...row, content_encoding: 'identity' };
    }
    if (action === 'getPublicationLinks') {
      requirePermission(this.user, 'insight.view');
      return {
        rows: (await s.list('contentLinks', 'brief_id', p.brief_id)).filter(
          (x) => !archived(x),
        ),
      };
    }
    if (
      [
        'getBriefInsight',
        'getInsightTracker',
        'getInsightAuditExport',
        'getCommentIntelligence',
      ].includes(action)
    )
      return this.insight(action, p);
    if (action === 'getHotIssueAiStatuses') {
      requirePermission(this.user, 'hotissue.view');
      const wanted = new Set(array(p.ids).map(String)),
        date = p.date || today();
      return {
        rows: (await d.visible('hotIssues')).filter((x) =>
          wanted.has(String(x.id)),
        ),
        coverage: await this.coverage(date),
        daily: (await s.list('hotDaily')).find((x) => x.date === date) || null,
        generated_at: now(),
      };
    }
    if (action === 'getHotIssueDailyHistory')
      return {
        ...page(
          (await d.visible('hotDaily')).filter(
            (x) => (!p.from || x.date >= p.from) && (!p.to || x.date <= p.to),
          ),
          p,
        ),
        generated_at: now(),
      };
    if (
      [
        'getHotIssueTrend7Days',
        'getHotIssueIntelligence',
        'getHotIssueWeeklyIntelligence',
        'getHotIssueEvidence',
      ].includes(action)
    )
      return require('./hot.cjs').read(this, action, p);
    if (action === 'getAiStudioData') {
      requirePermission(this.user, 'ai.use');
      const cfg = (await this.settings()).gemini_ai;
      return {
        ...cfg,
        rules: await d.visible('aiRules'),
        examples: await d.visible('aiExamples'),
        prompt_versions: await d.visible('aiPromptVersions'),
        content_pillars: await d.visible('contentPillars'),
        master_prompts: await d.visible('masterPrompts'),
        permissions: { trainer: has(this.user, 'ai.manage') },
        performance: { lazy: true },
      };
    }
    if (action === 'healthRelationIssues') {
      requirePermission(this.user, 'health.view');
      return this.relations();
    }
    if (action === 'getErrorLogs') {
      requirePermission(this.user, 'health.view');
      return page(await s.list('errorLogs'), p);
    }
    if (action === 'listBackups') {
      requirePermission(this.user, 'backup.manage');
      return {
        ...page(await s.list('backups'), p),
        enabled: true,
        retention_days: 30,
      };
    }
    if (action === 'getIntegrationStatus') return this.integrationStatus();
    throw error('Action belum didukung backend Nimbus: ' + action, 501);
  }
  async delta(p) {
    const cursor = Number(p.cursor) || 0,
      latest = await this.store.revision();
    if (!cursor || cursor > latest)
      return {
        full_required: true,
        cursor: latest,
        reason: 'FULL_REQUIRED',
        generated_at: now(),
      };
    const oldest = Number(
      (
        await this.pool.query(
          'SELECT COALESCE(MIN(sequence),0)::text AS cursor FROM mwg_changes',
        )
      ).rows[0].cursor,
    );
    if (cursor < oldest - 1)
      return {
        full_required: true,
        cursor: latest,
        reason: 'CURSOR_EXPIRED',
        generated_at: now(),
      };
    const changes = await this.pool.query(
      'SELECT collection,id,operation FROM mwg_changes WHERE sequence>$1 AND sequence<=$2 ORDER BY sequence LIMIT 2001',
      [cursor, latest],
    );
    if (
      changes.rows.length > 2000 ||
      changes.rows.some(
        (r) => r.collection === 'accounts' || r.collection === 'systemSettings',
      )
    )
      return {
        full_required: true,
        cursor: latest,
        reason: 'REFERENCE_CHANGED',
        generated_at: now(),
      };
    const groups = new Map();
    for (const c of changes.rows) {
      if (!Object.hasOwn(READ, c.collection)) continue;
      if (!groups.has(c.collection)) groups.set(c.collection, new Set());
      groups.get(c.collection).add(c.id);
    }
    const modules = {};
    for (const [kind, ids] of groups) {
      const visible = (await this.domain.visible(kind)).filter((r) =>
          ids.has(String(r.id)),
        ),
        found = new Set(visible.map((r) => String(r.id)));
      modules[kind] = {
        rows: visible,
        deleted_ids: [...ids].filter((key) => !found.has(key)),
        full: false,
      };
    }
    return {
      cursor: latest,
      modules,
      refresh_modules: [],
      change_count: changes.rows.length,
      generated_at: now(),
    };
  }
  async coverage(date = today()) {
    const rows = await this.domain.visible('hotIssues'),
      done = rows.filter((x) => x.ai_status === 'Selesai').length,
      current = rows.filter((x) => dateKey(x.tanggal) === date),
      todayDone = current.filter((x) => x.ai_status === 'Selesai').length;
    return {
      total: rows.length,
      analyzed: done,
      pending: rows.length - done,
      today_total: current.length,
      today_analyzed: todayDone,
      today_pending: current.length - todayDone,
      date,
      percent: rows.length ? Math.round((done / rows.length) * 100) : 100,
    };
  }
  async relations() {
    const briefs = await this.store.list('briefs'),
      tasks = await this.store.list('tasks'),
      accounts = await this.store.accounts(),
      b = new Set(briefs.map((x) => String(x.id))),
      a = new Set(accounts.map((x) => String(x.id)));
    const issues = tasks
      .filter(
        (x) =>
          (x.brief_id && !b.has(String(x.brief_id))) ||
          (x.petugas_id && !a.has(String(x.petugas_id))),
      )
      .map((x) => ({
        id: x.id,
        brief_id: x.brief_id,
        petugas_id: x.petugas_id,
      }));
    return {
      ok: !issues.length,
      issues,
      total_issues: issues.length,
      briefs: briefs.length,
      tasks: tasks.length,
      accounts: accounts.length,
    };
  }
  async insight(action, p) {
    requirePermission(this.user, 'insight.view');
    const s = this.store,
      links = (await s.list('contentLinks')).filter((x) => !archived(x));
    if (action === 'getCommentIntelligence') {
      const captures = await s.list('commentCaptures', 'link_id', p.link_id),
        analyses = await s.list('commentAnalyses', 'link_id', p.link_id),
        latest = captures[0] || null;
      return {
        link: links.find((x) => x.id === p.link_id) || null,
        captures,
        analyses,
        latest_capture: latest,
        latest_analysis:
          analyses.find((x) => x.capture_id === latest?.id) || null,
      };
    }
    if (action === 'getBriefInsight') {
      const rows = links.filter(
        (x) => String(x.brief_id) === String(p.brief_id),
      );
      return {
        links: rows,
        snapshots: await s.list('insightSnapshots', 'brief_id', p.brief_id),
        aggregate: {
          primary: rows.reduce(
            (v, x) =>
              v + Number(x.last_metrics?.reach || x.last_metrics?.views || 0),
            0,
          ),
        },
      };
    }
    const briefs = new Map((await s.list('briefs')).map((b) => [b.id, b]));
    const tools = require('./insight-tools.cjs');
    const rows = links
      .map((x) => ({
        ...x,
        brief_title: briefs.get(x.brief_id)?.judul || '',
        tracker_status: tools.status(x),
        manual_only: tools.manual(x),
      }))
      .filter(
        (x) =>
          (!p.link_id || x.id === p.link_id) &&
          (!p.search ||
            norm(
              [x.brief_id, x.brief_title, x.url, x.account_label].join(' '),
            ).includes(norm(p.search))) &&
          (!p.platform ||
            (p.platform === 'manual'
              ? x.manual_only
              : x.platform === p.platform)) &&
          tools.matches(x, p.status),
      );
    const codes = new Set(rows.map((x) => x.brief_id));
    if (action === 'getInsightAuditExport')
      return {
        rows: rows.slice(0, Math.min(5000, Number(p.limit) || 5000)),
        total: rows.length,
      };
    const grouped = new Map();
    for (const row of rows) {
      const key = row.brief_id || 'TANPA-BRIEF';
      if (!grouped.has(key))
        grouped.set(key, {
          brief_id: key,
          brief_title: row.brief_title,
          links: [],
        });
      grouped.get(key).links.push(row);
    }
    const selected = page([...grouped.values()], p);
    return {
      ...selected,
      rows: selected.rows.flatMap((g) => g.links),
      groups: selected.rows,
      total_links: rows.length,
      summary: {
        briefs: codes.size,
        links: rows.length,
        connected: rows.filter((x) => x.tracker_status === 'connected').length,
        review: rows.filter((x) => x.tracker_status === 'review').length,
        never: rows.filter((x) => x.tracker_status === 'never').length,
        errors: rows.filter((x) => x.last_error).length,
        primary: rows.reduce(
          (v, x) =>
            v + Number(x.last_metrics?.reach || x.last_metrics?.views || 0),
          0,
        ),
        platforms: new Set(rows.map((x) => x.platform)).size,
      },
    };
  }
  async integrationStatus() {
    requirePermission(this.user, 'settings.view');
    await this.pool.query('SELECT 1');
    const cfg = (await this.settings()).gemini_ai,
      stamp = now(),
      ok = (message) => ({
        ok: true,
        status: 'ok',
        message,
        last_success: stamp,
      });
    return {
      checked_at: stamp,
      core: { ...ok('Node.js aktif'), version: VERSION, mode: 'Nimbus Go' },
      spreadsheet: {
        ...ok('Database PostgreSQL dapat diakses'),
        name: 'PostgreSQL',
        access: 'Baca/Tulis',
      },
      drive_html: {
        ...ok('HTML disimpan dalam database'),
        folder: 'PostgreSQL',
      },
      internal_calendar: ok('Kalender internal aktif'),
      backup: {
        ok: null,
        status: 'external',
        message:
          'Backup privat melalui CLI dan cron hosting; periksa hasil backup terjadwal.',
      },
      gemini: {
        ...cfg,
        ok: cfg.configured,
        status: cfg.configured ? 'configured' : 'not_configured',
        message: 'Pengujian koneksi tersedia pada pengaturan Gemini.',
      },
      social_listening: {
        ok: true,
        status: 'ok',
        configured: true,
        mode: 'PostgreSQL',
        collector_configured: !!process.env.LISTENING_API_URL,
        message:
          'Dashboard lokal aktif; collector otomatis memerlukan konfigurasi terpisah.',
      },
      whatsapp_gateway: {
        ok: false,
        status: 'not_configured',
        message: 'Gateway WhatsApp perlu dipasangkan ulang.',
      },
      google_calendar: {
        ok: false,
        status: 'not_integrated',
        message: 'Google Calendar belum dikonfigurasi.',
      },
    };
  }
}
module.exports = {
  Service,
  VERSION,
  CAPABILITIES,
  health,
  MUTATIONS,
  SAVE,
  DELETE,
  canonical,
  dateKey,
  page,
};
