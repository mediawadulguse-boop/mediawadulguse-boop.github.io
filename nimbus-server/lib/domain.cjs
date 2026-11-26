'use strict';
const zlib = require('node:zlib');
const { Store, id, now, today, clean } = require('./store.cjs');
const {
  error,
  has,
  requirePermission,
  ownTask,
  publicProfile,
  effectiveProfile,
  passwordHash,
  fingerprint,
} = require('./auth.cjs');
const parse = (v, fallback = []) => {
  if (v && typeof v === 'object') return v;
  try {
    return JSON.parse(v) || fallback;
  } catch {
    return fallback;
  }
};
const array = (v) => {
  const result = parse(v, []);
  return Array.isArray(result) ? result : [];
};
const archived = (r) =>
  r?.archived === true || String(r?.archived).toLowerCase() === 'true';
const norm = (v) =>
  String(v || '')
    .trim()
    .toLowerCase();
const READ = {
  briefs: ['brief.view', 'calendar.view', 'report.view', 'task.view_own'],
  tasks: ['task.view_all', 'task.view_own', 'calendar.view', 'report.view'],
  hotIssues: ['hotissue.view'],
  meetings: ['meeting.view'],
  templates: ['template.view'],
  footages: ['footage.view'],
  htmlDocuments: ['html.view'],
  contentLinks: ['insight.view'],
  insightSnapshots: ['insight.view'],
  commentCaptures: ['insight.view'],
  commentAnalyses: ['insight.view'],
  activity: ['activity.view'],
  briefHistory: ['activity.view', 'brief.view'],
  notifications: [],
  aiRules: ['ai.use', 'ai.manage'],
  aiExamples: ['ai.use', 'ai.manage'],
  aiFeedback: ['ai.manage'],
  aiHistory: ['ai.use'],
  aiPromptVersions: ['ai.use'],
  contentPillars: ['ai.use', 'brief.view'],
  masterPrompts: ['ai.use', 'brief.view'],
  hotDaily: ['hotissue.view'],
  hotWeekly: ['hotissue.view'],
  errorLogs: ['health.view'],
  backups: ['backup.manage'],
};
const WRITE = {
  hotIssues: ['hotissue.create', 'hotissue.edit'],
  meetings: ['meeting.create', 'meeting.edit'],
  templates: ['template.manage'],
  footages: ['footage.create', 'footage.edit'],
  htmlDocuments: ['html.manage'],
  aiRules: ['ai.manage'],
  aiExamples: ['ai.manage'],
  aiFeedback: ['ai.use'],
};

class Domain {
  constructor(db, user) {
    this.db = db;
    this.user = user;
    this.store = new Store(db);
  }
  async accounts({ admin = false } = {}) {
    const roster = await this.store.settings('staff_roster');
    const canAdmin =
      admin &&
      (has(this.user, 'account.view') ||
        has(this.user, 'account.manage_permissions'));
    const canAssign =
      canAdmin ||
      has(this.user, 'brief.create') ||
      has(this.user, 'brief.edit') ||
      has(this.user, 'task.edit_all');
    const profiles = await this.store.accounts(),
      out = [];
    for (const a of profiles) {
      if (!canAssign && String(a.id) !== String(this.user.id)) continue;
      const e = roster.employment?.[a.id] || {},
        status =
          norm(e.status || a.status_staf) === 'resign' ? 'Resign' : 'Aktif';
      const safe = {
        id: a.id,
        nama: a.nama,
        role: a.role,
        status_staf: status,
        tanggal_resign:
          status === 'Resign' ? e.resigned_at || a.tanggal_resign || '' : '',
        status_staf_updated_at: roster.updated_at || '',
      };
      out.push(
        canAdmin ? { ...(await effectiveProfile(this.db, a)), ...safe } : safe,
      );
    }
    return out;
  }
  async visible(collection) {
    if (collection === 'accounts') {
      requirePermission(this.user, 'account.view');
      return this.accounts({ admin: true });
    }
    if (!Object.hasOwn(READ, collection)) throw error('Modul tidak dikenal.');
    if (
      READ[collection].length &&
      !READ[collection].some((p) => has(this.user, p))
    )
      return [];
    let rows = await this.store.list(collection);
    if (collection === 'tasks' && !has(this.user, 'task.view_all'))
      rows = rows.filter((t) => ownTask(this.user, t));
    if (collection === 'briefs' && !has(this.user, 'brief.view')) {
      const tasks = (await this.store.list('tasks')).filter((t) =>
          ownTask(this.user, t),
        ),
        ids = new Set(tasks.map((t) => String(t.brief_id)));
      rows = rows.filter(
        (b) =>
          ids.has(String(b.id)) ||
          array(b.petugas_ids).map(String).includes(String(this.user.id)) ||
          array(b.jobdesk).some(
            (a) => String(a.petugas_id) === String(this.user.id),
          ),
      );
    }
    if (collection === 'notifications')
      rows = rows
        .filter((n) => this.notificationVisible(n))
        .map((n) => ({
          ...n,
          read: array(n.read_by).map(String).includes(String(this.user.id)),
        }));
    if (collection === 'htmlDocuments')
      rows = await require('./documents.cjs').withPublicUrls(
        this.db,
        rows.map(
          ({ html_content, html_gzip_base64, html_base64, ...metadata }) => ({
            ...metadata,
            _lite: true,
          }),
        ),
      );
    return rows;
  }
  notificationVisible(n) {
    return (
      has(this.user, '*') ||
      (!n.target_user_id && !n.target_user) ||
      String(n.target_user_id || '') === String(this.user.id) ||
      (!n.target_user_id && norm(n.target_user) === norm(this.user.nama))
    );
  }
  async detail(collection, key) {
    const row = (await this.visible(collection)).find(
      (r) => String(r.id) === String(key),
    );
    if (!row)
      throw error('Data tidak ditemukan atau tidak dapat diakses.', 404);
    return { ...row, _lite: false };
  }
  conflict(old, expected) {
    if (old && expected && String(old.updated_at) !== String(expected))
      throw error('Data telah berubah. Muat ulang sebelum menyimpan.', 409);
  }
  async resolveAssignments(record, old) {
    const accounts = await this.accounts({ admin: true }),
      byId = new Map(accounts.map((a) => [String(a.id), a]));
    record.jobdesk = array(record.jobdesk)
      .map((a) => {
        const account =
          byId.get(String(a.petugas_id)) ||
          accounts.find((p) => norm(p.nama) === norm(a.petugas));
        if (!account) throw error('Pilih petugas dari daftar akun.');
        const jobs = Array.isArray(a.jobdesk)
          ? a.jobdesk
          : String(a.jobdesk || '')
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
        const before = array(old?.jobdesk).find(
          (p) => String(p.petugas_id) === String(account.id),
        );
        if (
          account.status_staf === 'Resign' &&
          jobs.some((job) => !array(before?.jobdesk).includes(job))
        )
          throw error('Staf resign tidak dapat diberi penugasan baru.');
        return {
          petugas_id: String(account.id),
          petugas: account.nama,
          jobdesk: [...new Set(jobs)],
        };
      })
      .filter((a) => a.jobdesk.length);
    record.petugas_ids = [...new Set(record.jobdesk.map((a) => a.petugas_id))];
    record.petugas = [...new Set(record.jobdesk.map((a) => a.petugas))];
    return record;
  }
  async syncTasks(brief) {
    const existing = await this.store.list('tasks', 'brief_id', brief.id),
      used = new Set(),
      result = { created: 0, updated: 0, archived: 0, reassigned: 0 };
    for (const a of array(brief.jobdesk))
      for (const job of array(a.jobdesk)) {
        let task = existing.find(
          (t) =>
            !used.has(t.id) &&
            String(t.petugas_id) === String(a.petugas_id) &&
            norm(t.jobdesk) === norm(job),
        );
        if (!task)
          task =
            existing.find(
              (t) =>
                !used.has(t.id) &&
                !archived(t) &&
                norm(t.jobdesk) === norm(job),
            ) ||
            existing.find(
              (t) => !used.has(t.id) && norm(t.jobdesk) === norm(job),
            );
        const before = task,
          stamp = now();
        if (task) {
          used.add(task.id);
          if (String(task.petugas_id) !== String(a.petugas_id))
            result.reassigned++;
          result.updated++;
        } else {
          task = {
            id: id('TSK'),
            status: 'Belum mulai',
            prioritas: 'Tinggi',
            catatan: 'Dibuat otomatis dari brief.',
            created_by: this.user.nama,
            created_at: stamp,
          };
          result.created++;
        }
        const next = {
          ...task,
          brief_id: brief.id,
          judul_tugas: brief.judul + ' - ' + job,
          petugas_id: a.petugas_id,
          petugas: a.petugas,
          jobdesk: job,
          deadline: brief.deadline,
          archived: archived(brief),
          archived_at: archived(brief) ? before?.archived_at || stamp : '',
          archived_by: archived(brief) ? this.user.nama : '',
          updated_at: stamp,
        };
        if (brief.status === 'Insight')
          Object.assign(next, {
            status: 'Selesai',
            status_updated_by: this.user.nama,
            status_updated_by_id: this.user.id,
            status_updated_at: stamp,
          });
        await this.store.save('tasks', next);
        if (!before || String(before.petugas_id) !== String(a.petugas_id))
          await this.store.save('notifications', {
            id: id('NOT'),
            title: before ? 'Penugasan berubah' : 'Tugas baru',
            message: next.judul_tugas,
            target_user_id: a.petugas_id,
            target_user: a.petugas,
            read_by: [],
            created_at: stamp,
          });
      }
    for (const task of existing.filter(
      (t) => !used.has(t.id) && !archived(t),
    )) {
      await this.store.save('tasks', {
        ...task,
        archived: true,
        archived_at: now(),
        archived_by: this.user.nama,
        updated_at: now(),
      });
      result.archived++;
    }
    return result;
  }
  async publicationLinks(brief, links) {
    if (!Array.isArray(links)) return;
    const old = await this.store.list('contentLinks', 'brief_id', brief.id),
      used = new Set();
    for (const input of links) {
      if (!String(input.url || '').trim()) continue;
      let url;
      try {
        url = new URL(input.url);
        if (!['https:', 'http:'].includes(url.protocol)) throw 0;
      } catch {
        throw error('URL publikasi tidak valid.');
      }
      const previous =
        old.find((x) => String(x.id) === String(input.id)) ||
        old.find((x) => x.url === url.href);
      const next = {
        ...previous,
        id: previous?.id || id('LINK'),
        brief_id: brief.id,
        url: url.href,
        platform: input.platform || 'Lainnya',
        account_label: input.account_label || '',
        content_type: input.content_type || '',
        archived: false,
        created_at: previous?.created_at || now(),
        created_by: previous?.created_by || this.user.nama,
        updated_at: now(),
      };
      if (input._initial_metrics) {
        next.last_metrics = input._initial_metrics;
        next.last_source = 'manual';
        next.last_updated_at = now();
      }
      used.add(next.id);
      await this.store.save('contentLinks', next);
    }
    for (const row of old.filter((x) => !used.has(x.id)))
      await this.store.save('contentLinks', {
        ...row,
        archived: true,
        updated_at: now(),
      });
  }
  async saveBrief(input, options = {}) {
    const old = input.id ? await this.store.get('briefs', input.id) : null;
    requirePermission(
      this.user,
      old ? 'brief.edit' : 'brief.create',
      old ? 'calendar.edit' : 'calendar.create',
    );
    this.conflict(old, options.expected || input._expected_updated_at);
    const record = await this.resolveAssignments(
      { ...old, ...clean(input), id: old?.id || String(input.id || id('BRF')) },
      old,
    );
    for (const field of ['judul', 'tanggal', 'deadline'])
      if (!String(record[field] || '').trim())
        throw error(field + ' wajib diisi.');
    if (record.status === 'Publish') {
      const links = Array.isArray(input._publication_links)
        ? input._publication_links
        : await this.store.list('contentLinks', 'brief_id', record.id);
      if (!record.link_konten && !links.some((x) => x.url && !archived(x)))
        throw error('Link publikasi wajib diisi untuk status Publish.');
    }
    Object.assign(record, {
      status: record.status || 'Draft',
      approval_status: record.approval_status || 'Draft',
      created_at: old?.created_at || now(),
      created_by: old?.created_by || this.user.nama,
      updated_at: now(),
      archived: archived(record),
    });
    if (old?.status !== record.status)
      Object.assign(record, {
        status_updated_by: this.user.nama,
        status_updated_by_id: this.user.id,
        status_updated_at: now(),
      });
    await this.store.save('briefs', record);
    const relevant = ['judul', 'deadline', 'jobdesk', 'status', 'archived'];
    let taskSync = { skipped: true };
    if (
      !old ||
      relevant.some((k) => JSON.stringify(old[k]) !== JSON.stringify(record[k]))
    )
      taskSync = await this.syncTasks(record);
    await this.publicationLinks(record, input._publication_links);
    if (old)
      await this.store.save('briefHistory', {
        id: id('VER'),
        brief_id: record.id,
        edited_by: this.user.nama,
        edited_at: now(),
        changes: Object.keys(record)
          .filter((k) => JSON.stringify(old[k]) !== JSON.stringify(record[k]))
          .join(', '),
        snapshot_before: '',
        snapshot_after: '',
      });
    await this.store.audit(this.user, old ? 'EDIT' : 'ADD', 'BRIEF', record.id);
    return { ...record, _task_sync: taskSync };
  }
  async saveTask(input) {
    const old = input.id ? await this.store.get('tasks', input.id) : null;
    requirePermission(
      this.user,
      old ? 'task.edit_own' : 'task.create',
      'task.edit_all',
    );
    if (old && !has(this.user, 'task.edit_all') && !ownTask(this.user, old))
      throw error('Tugas ini tidak dapat diubah.', 403);
    this.conflict(old, input._expected_updated_at);
    const record = { ...old, ...clean(input) };
    if (!has(this.user, 'task.edit_all'))
      Object.assign(record, {
        petugas_id: this.user.id,
        petugas: this.user.nama,
      });
    const accounts = await this.store.accounts(),
      account = accounts.find(
        (a) => String(a.id) === String(record.petugas_id),
      );
    if (!account) throw error('Petugas tidak ditemukan.');
    const roster = await this.store.settings('staff_roster');
    if (
      norm(roster.employment?.[account.id]?.status || account.status_staf) ===
        'resign' &&
      String(old?.petugas_id) !== String(account.id)
    )
      throw error('Staf resign tidak dapat diberi tugas baru.');
    record.petugas = account.nama;
    if (record.brief_id) await this.detail('briefs', record.brief_id);
    for (const field of ['judul_tugas', 'deadline'])
      if (!record[field]) throw error(field + ' wajib diisi.');
    Object.assign(record, {
      id: old?.id || record.id || id('TSK'),
      created_at: old?.created_at || now(),
      created_by: old?.created_by || this.user.nama,
      updated_at: now(),
      status: record.status || 'Belum mulai',
      archived: archived(record),
    });
    if (old?.status !== record.status)
      Object.assign(record, {
        status_updated_by: this.user.nama,
        status_updated_by_id: this.user.id,
        status_updated_at: now(),
      });
    await this.store.save('tasks', record);
    await this.store.audit(this.user, old ? 'EDIT' : 'ADD', 'TUGAS', record.id);
    return record;
  }
  async generic(collection, input) {
    const old = input.id ? await this.store.get(collection, input.id) : null;
    requirePermission(this.user, ...(WRITE[collection] || []));
    if (collection === 'hotIssues')
      requirePermission(this.user, old ? 'hotissue.edit' : 'hotissue.create');
    if (collection === 'meetings')
      requirePermission(this.user, old ? 'meeting.edit' : 'meeting.create');
    if (collection === 'footages')
      requirePermission(this.user, old ? 'footage.edit' : 'footage.create');
    this.conflict(old, input._expected_updated_at);
    const record = {
      ...old,
      ...clean(input),
      id: old?.id || input.id || id('REC'),
      created_at: old?.created_at || now(),
      created_by: old?.created_by || this.user.nama,
      updated_at: now(),
    };
    const required =
      {
        hotIssues: ['judul', 'deskripsi'],
        meetings: ['judul_rapat', 'tanggal'],
        templates: ['nama'],
        footages: ['judul', 'link_gdrive'],
        htmlDocuments: ['judul'],
      }[collection] || [];
    for (const field of required)
      if (!String(record[field] || '').trim())
        throw error(field + ' wajib diisi.');
    const statusField =
      collection === 'meetings' ? 'status_followup' : 'status';
    if (record[statusField] !== old?.[statusField])
      Object.assign(record, {
        status_updated_by: this.user.nama,
        status_updated_by_id: this.user.id,
        status_updated_at: now(),
      });
    if (collection === 'hotIssues') {
      record.tanggal = record.tanggal || today();
      record.status = record.status || 'Baru';
      const settings = await this.store.settings('gemini_ai'),
        secret = process.env.GEMINI_API_KEY || settings.api_key;
      const changed =
        !old ||
        old.judul !== record.judul ||
        old.deskripsi !== record.deskripsi;
      const freshAnalysis =
        input.ai_detail &&
        input.ai_detail !== old?.ai_detail &&
        parse(input.ai_detail, {}).analyzed_at;
      if (changed && !freshAnalysis) {
        if (
          secret &&
          settings.enabled !== false &&
          settings.auto_analyze !== false
        ) {
          record.ai_status = 'Antre';
          await this.store.queueHot(record);
        } else record.ai_status = secret ? 'Menunggu' : 'Belum dikonfigurasi';
      }
    }
    if (collection === 'htmlDocuments') {
      let bytes;
      if (input.html_gzip_base64)
        bytes = zlib.gunzipSync(Buffer.from(input.html_gzip_base64, 'base64'), {
          maxOutputLength: 20 * 1024 * 1024,
        });
      else if (input.html_base64)
        bytes = Buffer.from(input.html_base64, 'base64');
      else if (input.html_content !== undefined)
        bytes = Buffer.from(String(input.html_content));
      if (bytes) {
        if (bytes.length > 20 * 1024 * 1024)
          throw error('Dokumen maksimal 20 MB.');
        if (input.content_sha256 && fingerprint(bytes) !== input.content_sha256)
          throw error('Checksum HTML berbeda.');
        record.html_content = bytes.toString('utf8');
        record.file_size = bytes.length;
        record.content_sha256 = fingerprint(bytes);
      }
      if (!record.html_content) throw error('Isi HTML belum tersedia.');
      for (const key of ['html_base64', 'html_gzip_base64', 'drive_file_id'])
        delete record[key];
      record.storage_type = 'POSTGRESQL';
      record.mime_type = 'text/html';
      record.content_encoding = 'identity';
    }
    await this.store.save(collection, record);
    await this.store.audit(
      this.user,
      old ? 'EDIT' : 'ADD',
      collection,
      record.id,
    );
    return collection === 'htmlDocuments'
      ? {
          ...record,
          html_content: '',
          saved: true,
          public_url: await require('./documents.cjs').publicUrl(
            this.db,
            record,
          ),
        }
      : record;
  }
  async saveAccount(input) {
    requirePermission(this.user, 'account.manage_permissions');
    const key = String(input.id || id('ACC')),
      result = await this.db.query('SELECT * FROM mwg_users WHERE id=$1', [
        key,
      ]),
      old = result.rows[0];
    const username = norm(input.username),
      role = String(input.role || 'STAF').toUpperCase();
    if (
      !username ||
      !input.nama ||
      !['SUPERADMIN', 'ANALIS', 'STAF'].includes(role)
    )
      throw error('Nama, username, dan role valid wajib diisi.');
    if (old?.profile.role === 'SUPERADMIN' && role !== 'SUPERADMIN')
      await this.assertAnotherAdmin(key);
    const hash = input.password
      ? await passwordHash(input.password)
      : old?.password_hash;
    if (!hash) throw error('Password akun baru wajib diisi.');
    const profile = publicProfile({
      ...old?.profile,
      id: key,
      username,
      nama: String(input.nama),
      role,
      whatsapp: String(input.whatsapp || ''),
      updated_at: now(),
      created_at: old?.profile.created_at || now(),
    });
    await this.db.query(
      `INSERT INTO mwg_users(id,username,password_hash,profile) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username,password_hash=EXCLUDED.password_hash,profile=EXCLUDED.profile`,
      [key, username, hash, JSON.stringify(profile)],
    );
    if (Array.isArray(input.permissions)) {
      const map = await this.store.settings('permission_overrides');
      if (role === 'SUPERADMIN' || input.permissions_override === false)
        delete map[key];
      else map[key] = input.permissions.map(String);
      await this.store.saveSettings('permission_overrides', map);
    }
    if (input.password || old?.profile.role !== role)
      await this.db.query('DELETE FROM mwg_sessions WHERE user_id=$1', [key]);
    await this.store.change('accounts', key, 'UPSERT');
    await this.store.audit(this.user, old ? 'EDIT' : 'ADD', 'AKUN', key);
    return publicProfile(profile);
  }
  async assertAnotherAdmin(key) {
    const result = await this.db.query(
      "SELECT id FROM mwg_users WHERE enabled=true AND profile->>'role'='SUPERADMIN' AND id<>$1",
      [key],
    );
    if (!result.rows.length)
      throw error('Minimal satu SUPERADMIN aktif harus tersedia.');
  }
}
module.exports = { Domain, READ, WRITE, parse, array, archived, norm };
