'use strict';
const {
  Service,
  MUTATIONS,
  SAVE,
  DELETE,
  canonical,
} = require('./service.cjs');
const { Domain, array, parse, archived, norm } = require('./domain.cjs');
const {
  error,
  has,
  requirePermission,
  ownTask,
  fingerprint,
} = require('./auth.cjs');
const { id, now, today, clean } = require('./store.cjs');
const { transaction } = require('./database.cjs');

async function mutate(db, user, action, p = {}) {
  const d = new Domain(db, user),
    s = d.store;
  if (action === 'saveBrief') {
    const record = await d.saveBrief(p.record || {});
    return {
      record,
      relations_applied: true,
      related_records: await s.list('tasks', 'brief_id', record.id),
    };
  }
  if (action === 'saveTask') return d.saveTask(p.record || {});
  if (action === 'saveAccount') return d.saveAccount(p.record || {});
  if (SAVE[action]) return d.generic(SAVE[action], p.record || p);
  if (action === 'patchBrief') {
    const row = await s.get('briefs', p.id);
    if (!row) throw error('Brief tidak ditemukan.', 404);
    const record = await d.saveBrief(
      {
        ...row,
        ...p.changes,
        id: row.id,
        _publication_links:
          p.changes?._publication_links || p.relations?.publication_links,
      },
      { expected: p.expected_updated_at },
    );
    return {
      record,
      relations_applied: !!p.relations,
      related_records: await s.list('tasks', 'brief_id', record.id),
    };
  }
  if (action === 'syncBriefRelations') {
    requirePermission(
      user,
      'brief.edit',
      'calendar.edit',
      'brief.create',
      'calendar.create',
    );
    const row = await s.get('briefs', p.record?.id || p.brief_id || p.id);
    if (!row) throw error('Brief tidak ditemukan.', 404);
    await d.publicationLinks(row, p.publication_links || p._publication_links);
    if (p.primary_link) {
      const current = (await s.list('contentLinks', 'brief_id', row.id)).filter(
        (x) => !archived(x) && x.url !== p.primary_link.previous_url,
      );
      if (p.primary_link.url) current.push(p.primary_link);
      await d.publicationLinks(row, current);
    }
    const tasks =
      p.sync_tasks || p.complete_tasks ? await d.syncTasks(row) : null;
    return {
      record: row,
      related_records: await s.list('tasks', 'brief_id', row.id),
      summary: { tasks },
    };
  }
  if (
    [
      'updateBriefField',
      'quickUpdateBriefField',
      'setBriefArchive',
      'markBriefWhatsAppSent',
    ].includes(action)
  ) {
    const row = await s.get('briefs', p.id || p.brief_id);
    if (!row) throw error('Brief tidak ditemukan.', 404);
    if (action === 'setBriefArchive')
      requirePermission(user, 'brief.archive', 'calendar.archive');
    else requirePermission(user, 'brief.edit', 'calendar.edit');
    const next = { ...row };
    if (action === 'setBriefArchive')
      Object.assign(next, {
        archived: !!p.archived,
        archived_at: p.archived ? now() : '',
        archived_by: p.archived ? user.nama : '',
      });
    else if (action === 'markBriefWhatsAppSent')
      next.wa_sent_status = {
        ...parse(row.wa_sent_status, {}),
        [String(p.person)]: {
          status: 'sent',
          sent_at: now(),
          sent_by: user.nama,
          phone: String(p.phone || ''),
        },
      };
    else {
      if (
        ![
          'tanggal',
          'deadline',
          'status',
          'approval_status',
          'konten_pilar',
          'kategori_konten',
          'link_konten',
          'insight_reach',
          'hasil_performa',
        ].includes(p.field)
      )
        throw error('Field brief tidak diizinkan.');
      next[p.field] = p.value;
      if (
        p.field === 'status' &&
        p.value === 'Publish' &&
        !next.link_konten &&
        !(await s.list('contentLinks', 'brief_id', row.id)).some(
          (x) => x.url && !archived(x),
        )
      )
        throw error('Link publikasi wajib diisi untuk status Publish.');
    }
    next.updated_at = now();
    await s.save('briefs', next);
    if (
      action === 'setBriefArchive' ||
      ['deadline', 'status'].includes(p.field)
    )
      await d.syncTasks(next);
    await s.audit(user, 'EDIT', 'BRIEF', row.id);
    if (action === 'markBriefWhatsAppSent')
      return {
        brief_id: row.id,
        person: p.person,
        entry: next.wa_sent_status[p.person],
        wa_sent_status: next.wa_sent_status,
        record: next,
      };
    return {
      record: next,
      ...(action === 'setBriefArchive' ||
      ['deadline', 'status'].includes(p.field)
        ? { related_records: await s.list('tasks', 'brief_id', row.id) }
        : {}),
    };
  }
  if (
    ['updateTaskField', 'quickUpdateTaskField', 'setTaskArchive'].includes(
      action,
    )
  ) {
    const row = await s.get('tasks', p.id);
    if (!row) throw error('Tugas tidak ditemukan.', 404);
    requirePermission(user, 'task.edit_all', 'task.edit_own');
    if (!has(user, 'task.edit_all') && !ownTask(user, row))
      throw error('Tugas tidak dapat diubah.', 403);
    const next = { ...row, updated_at: now() };
    if (action === 'setTaskArchive')
      Object.assign(next, {
        archived: !!p.archived,
        archived_at: p.archived ? now() : '',
        archived_by: p.archived ? user.nama : '',
      });
    else {
      if (!['deadline', 'status', 'catatan', 'prioritas'].includes(p.field))
        throw error('Field tugas tidak diizinkan.');
      next[p.field] = p.value;
    }
    if (p.field === 'status')
      Object.assign(next, {
        status_updated_by: user.nama,
        status_updated_by_id: user.id,
        status_updated_at: now(),
      });
    await s.save('tasks', next);
    await s.audit(user, 'EDIT', 'TUGAS', row.id);
    return next;
  }
  if (DELETE[action]) {
    const kind = DELETE[action];
    if (kind === 'accounts') {
      requirePermission(user, 'account.manage_permissions');
      if (String(p.id) === String(user.id))
        throw error('Akun sendiri tidak dapat dihapus.');
      await d.assertAnotherAdmin(String(p.id));
      const refs = await db.query(
        "SELECT id FROM mwg_records WHERE (collection='tasks' AND data->>'petugas_id'=$1) OR (collection='briefs' AND data->'petugas_ids' @> $2::jsonb) LIMIT 1",
        [String(p.id), JSON.stringify([String(p.id)])],
      );
      if (refs.rows.length)
        throw error('Akun memiliki riwayat penugasan. Gunakan status Resign.');
      await db.query('DELETE FROM mwg_users WHERE id=$1', [String(p.id)]);
      await s.change('accounts', p.id, 'DELETE');
      return { deleted: true, id: p.id };
    }
    const row = await s.get(kind, p.id);
    if (!row) throw error('Data tidak ditemukan.', 404);
    if (kind === 'briefs')
      requirePermission(user, 'brief.archive', 'calendar.archive');
    else if (kind === 'tasks') {
      requirePermission(user, 'task.edit_all', 'task.edit_own');
      if (!has(user, 'task.edit_all') && !ownTask(user, row))
        throw error('Tugas tidak dapat dihapus.', 403);
    } else
      requirePermission(
        user,
        ...({
          hotIssues: ['hotissue.archive'],
          meetings: ['meeting.edit'],
          templates: ['template.manage'],
          footages: ['footage.delete'],
          htmlDocuments: ['html.manage'],
          aiRules: ['ai.manage'],
          aiExamples: ['ai.manage'],
        }[kind] || []),
      );
    const taskIds = [];
    if (kind === 'briefs') {
      for (const task of await s.list('tasks', 'brief_id', p.id)) {
        await s.remove('tasks', task.id);
        taskIds.push(task.id);
      }
      // Publication history is retained but no longer counted as active content.
      for (const link of await s.list('contentLinks', 'brief_id', p.id))
        await s.save('contentLinks', {
          ...link,
          archived: true,
          updated_at: now(),
        });
    }
    await s.remove(kind, p.id);
    await s.audit(user, 'DELETE', kind, p.id);
    return {
      deleted: true,
      id: p.id,
      brief_id: kind === 'briefs' ? p.id : undefined,
      deleted_tasks: taskIds.length,
      deleted_task_ids: taskIds,
    };
  }
  if (
    [
      'patchHotIssue',
      'startHotIssueComplaint',
      'finalizeHotIssueComplaint',
      'cancelHotIssueComplaint',
      'updateHotIssueWorkflow',
      'saveHotIssueIntelligenceFeedback',
    ].includes(action)
  ) {
    requirePermission(
      user,
      action === 'saveHotIssueIntelligenceFeedback'
        ? 'ai.use'
        : 'hotissue.edit',
    );
    const row = await s.get('hotIssues', p.id);
    if (!row) throw error('Hot Issue tidak ditemukan.', 404);
    d.conflict(row, p.expected_updated_at);
    const next = { ...row, updated_at: now() };
    if (action === 'patchHotIssue') {
      const allowed = [
        'tanggal',
        'judul',
        'deskripsi',
        'link',
        'sumber',
        'status',
        'verification_status',
        'source_credibility',
        'opd_primary',
        'opd_support',
        'pic',
        'pic_id',
        'followup_deadline',
        'followup_progress',
        'followup_note',
        'lifecycle_status',
        'ai_feedback',
      ];
      for (const [key, value] of Object.entries(p.changes || {}))
        if (allowed.includes(key)) next[key] = value;
      if (next.judul !== row.judul || next.deskripsi !== row.deskripsi)
        return { record: await d.generic('hotIssues', next) };
    } else if (action === 'startHotIssueComplaint') {
      if (row.aduan_id)
        throw error('Hot Issue sudah terhubung ke aduan ' + row.aduan_id);
      Object.assign(next, {
        aduan_status: 'Proses Menjadi Aduan',
        aduan_started_by: user.nama,
        aduan_started_by_id: user.id,
        aduan_started_at: now(),
        aduan_form_url:
          'https://wadulgus.jemberkab.go.id/report/queue_reports/add',
      });
    } else if (action === 'finalizeHotIssueComplaint') {
      const key = String(p.aduan_id || '').trim();
      if (!key) throw error('ID Aduan wajib diisi.');
      if (row.aduan_id && row.aduan_id !== key)
        throw error('Sudah terhubung dengan aduan lain.');
      Object.assign(next, {
        status: 'Sudah Menjadi Aduan',
        aduan_status: 'Sudah Menjadi Aduan',
        aduan_id: key,
        aduan_created_by: user.nama,
        aduan_created_by_id: user.id,
        aduan_created_at: now(),
      });
    } else if (action === 'cancelHotIssueComplaint') {
      if (row.aduan_id)
        throw error('Aduan yang sudah terhubung tidak dapat dibatalkan.');
      Object.assign(next, {
        aduan_status: '',
        aduan_started_by: '',
        aduan_started_by_id: '',
        aduan_started_at: '',
      });
    } else if (action === 'updateHotIssueWorkflow') {
      for (const k of [
        'lifecycle_status',
        'pic',
        'pic_id',
        'followup_deadline',
        'followup_progress',
        'followup_note',
        'verification_status',
        'opd_primary',
        'opd_support',
      ])
        if (Object.hasOwn(p, k)) next[k] = p[k];
      if (
        p.lifecycle_status &&
        ![
          'Baru',
          'Dianalisis',
          'Dipantau',
          'Tindak Lanjut',
          'Selesai',
          'Arsip',
        ].includes(p.lifecycle_status)
      )
        throw error('Status lifecycle tidak valid.');
      next.followup_progress = Math.max(
        0,
        Math.min(100, Number(next.followup_progress) || 0),
      );
    } else {
      if (!['up', 'down'].includes(p.rating))
        throw error('Feedback AI tidak valid.');
      next.ai_feedback = p.rating;
      await s.save('aiFeedback', {
        id: id('AIF'),
        feature: 'Hot Issue Intelligence',
        context_type: 'HOT_ISSUE',
        context_id: row.id,
        rating: p.rating === 'up' ? 'Tepat' : 'Kurang Tepat',
        original_output: row.ai_detail || '',
        note: String(p.note || '').slice(0, 1000),
        created_by: user.nama,
        created_by_id: user.id,
        created_at: now(),
      });
    }
    await s.save('hotIssues', next);
    await s.audit(user, 'EDIT', 'HOT_ISSUE', row.id);
    return { record: next };
  }
  if (action === 'bulkImportHotIssues') {
    requirePermission(user, 'hotissue.create');
    const input = array(p.records);
    if (input.length > 500) throw error('Maksimal 500 baris per impor.');
    const seen = new Set(),
      keys = (r) =>
        [
          r.id ? 'ID|' + r.id : '',
          r.link ? 'URL|' + norm(r.link).replace(/\/$/, '') : '',
          r.judul
            ? 'TITLE|' + (r.tanggal || today()) + '|' + norm(r.judul)
            : '',
        ].filter(Boolean);
    (await s.list('hotIssues')).forEach((r) =>
      keys(r).forEach((k) => seen.add(k)),
    );
    const inserted = [],
      queued = [],
      skipped = [],
      failed = [];
    for (let i = 0; i < input.length; i++) {
      const r = {
          ...input[i],
          id: input[i].id || id('HOT'),
          tanggal: input[i].tanggal || today(),
        },
        row = Number(input[i]._import_row) || i + 2;
      if (!String(r.judul || '').trim() || !String(r.deskripsi || '').trim()) {
        failed.push({ row, error: 'Judul dan deskripsi wajib diisi.' });
        continue;
      }
      if (keys(r).some((k) => seen.has(k))) {
        skipped.push({ row, reason: 'Duplikat' });
        continue;
      }
      const record = await d.generic('hotIssues', r);
      keys(record).forEach((k) => seen.add(k));
      inserted.push(record.id);
      if (record.ai_status === 'Antre') queued.push(record.id);
    }
    return {
      imported: inserted.length,
      inserted_ids: inserted,
      skipped: skipped.length,
      failed: failed.length,
      skipped_rows: skipped,
      failed_rows: failed,
      ai_queued: queued.length,
      ai_queued_ids: queued,
      ai_available: !!(await new Service(db, user).settings()).gemini_ai
        .configured,
      generated_at: now(),
    };
  }
  if (action === 'saveAccountPermissions') {
    requirePermission(user, 'account.manage_permissions');
    const target = String(p.account_id || p.id || p.user_id || '');
    const account = (await s.accounts()).find((a) => a.id === target);
    if (!account) throw error('Akun tidak ditemukan.');
    if (account.role === 'SUPERADMIN')
      throw error('Hak SUPERADMIN tidak dapat dibatasi.');
    const map = await s.settings('permission_overrides');
    if (p.reset === true || p.use_preset === true) delete map[target];
    else map[target] = array(p.permissions).map(String);
    await s.saveSettings('permission_overrides', map);
    await db.query('DELETE FROM mwg_sessions WHERE user_id=$1', [target]);
    await s.change('accounts', target, 'UPSERT');
    return {
      account_id: target,
      permissions: map[target] || [],
      permissions_override: Object.hasOwn(map, target),
    };
  }
  if (action === 'saveSystemSettings') {
    requirePermission(user, 'settings.edit');
    const key = String(p.key || '');
    if (!['staff_roster', 'insight_tracker', 'brief_defaults'].includes(key))
      throw error('Pengaturan ini harus disimpan melalui tindakan khusus.');
    const result = await s.saveSettings(key, p.settings || p.value || {});
    if (key === 'staff_roster')
      await s.change('accounts', 'directory', 'REFRESH');
    await s.audit(user, 'EDIT', 'SYSTEM_SETTINGS', key);
    return result;
  }
  if (action === 'saveGeminiSettings') {
    requirePermission(user, 'settings.edit');
    const previous = await s.settings('gemini_ai'),
      model = String(p.model || previous.model || 'gemini-3.1-flash-lite');
    if (!/^[A-Za-z0-9._-]{3,100}$/.test(model))
      throw error('Nama model Gemini tidak valid.');
    const apiKey = p.remove_api_key
      ? ''
      : String(p.api_key || previous.api_key || '');
    await s.saveSettings('gemini_ai', {
      enabled: p.enabled !== false,
      model,
      auto_analyze: p.auto_analyze !== false,
      api_key: apiKey,
    });
    return (await new Service(db, user).settings()).gemini_ai;
  }
  if (action === 'saveInsightSnapshot') {
    requirePermission(user, 'insight.manage');
    const link = await s.get('contentLinks', p.link_id);
    if (!link) throw error('Link publikasi tidak ditemukan.', 404);
    const key = String(p.snapshot_id || id('INS')),
      old = await s.get('insightSnapshots', key);
    if (old) return { link, snapshot: old, duplicate: true };
    const snapshot = {
      id: key,
      link_id: link.id,
      brief_id: link.brief_id,
      platform: link.platform,
      collected_at: p.collected_at || now(),
      source: p.source || 'manual',
      metrics: p.metrics || {},
      raw_data: p.raw || {},
      confidence_score: Number(p.confidence_score) || 0,
      validation_status: p.validation_status || '',
      metric_evidence: p.metric_evidence || {},
      audit_summary: p.audit_summary || {},
      extension_version: p.extension_version || '',
      collected_by: user.nama,
      collected_by_id: user.id,
      created_at: now(),
    };
    const metrics = Object.fromEntries(
      Object.entries(p.metrics || {})
        .filter(
          ([, v]) =>
            v !== null &&
            v !== '' &&
            Number.isFinite(Number(v)) &&
            Number(v) >= 0,
        )
        .map(([k, v]) => [k, Number(v)]),
    );
    snapshot.metrics = p.merge_previous
      ? { ...link.last_metrics, ...metrics }
      : metrics;
    const next = {
      ...link,
      last_metrics: snapshot.metrics,
      last_source: snapshot.source,
      last_updated_at: snapshot.collected_at,
      last_confidence: snapshot.confidence_score,
      last_validation_status: snapshot.validation_status,
      last_metadata: p.raw?.metadata || {},
      last_error: String(p.error || ''),
      updated_at: now(),
    };
    if (Object.keys(snapshot.metrics).length)
      Object.assign(next, { score: null, grade: '-', scoring_pending: true });
    await s.save('insightSnapshots', snapshot);
    await s.save('contentLinks', next);
    const all = (
        await s.list('contentLinks', 'brief_id', link.brief_id)
      ).filter((x) => !archived(x)),
      primary = all.reduce(
        (sum, x) =>
          sum +
          Number(
            x.last_metrics?.reach ||
              x.last_metrics?.views ||
              x.last_metrics?.impressions ||
              0,
          ),
        0,
      ),
      brief = await s.get('briefs', link.brief_id);
    if (brief)
      await s.save('briefs', {
        ...brief,
        insight_reach: primary,
        updated_at: now(),
      });
    return { link: next, snapshot, primary };
  }
  if (action === 'saveCommentCapture') {
    requirePermission(user, 'insight.manage');
    const link = await s.get('contentLinks', p.link_id);
    if (!link) throw error('Link publikasi tidak ditemukan.', 404);
    const comments = require('./insight-tools.cjs').comments(p.comments || []);
    if (!comments.length) throw error('Komentar kosong atau tidak valid.');
    const record = {
      id: p.capture_id || id('COM'),
      link_id: link.id,
      brief_id: link.brief_id,
      platform: link.platform,
      captured_at: p.captured_at || now(),
      capture_method: p.capture_method || 'manual',
      total_captured: comments.length,
      coverage_known: !!p.coverage_known,
      sorting_method: p.sorting_method || 'visible_dom',
      comments_json: comments,
      created_at: now(),
      created_by: user.nama,
      created_by_id: user.id,
    };
    const old = await s.get('commentCaptures', record.id);
    if (old) return { capture: old, comments: old.comments_json };
    await s.save('commentCaptures', record);
    return { capture: record, comments };
  }
  if (
    action === 'markNotificationRead' ||
    action === 'markAllNotificationsRead'
  ) {
    let rows = await d.visible('notifications');
    if (action === 'markNotificationRead')
      rows = rows.filter((x) => x.id === p.id);
    for (const r of rows)
      await s.save('notifications', {
        ...r,
        read_by: [...new Set([...array(r.read_by), String(user.id)])],
      });
    return { id: p.id, read: true, updated: rows.length };
  }
  if (action === 'logClientError') {
    await s.save('errorLogs', {
      id: id('ERR'),
      user_id: user.id,
      user: user.nama,
      role: user.role,
      source: String(p.source || 'browser').slice(0, 100),
      action: String(p.action || '').slice(0, 100),
      page: String(p.page || '').slice(0, 200),
      message: String(p.message || '').slice(0, 2000),
      stack: String(p.stack || '').slice(0, 5000),
      created_at: now(),
      resolved: false,
    });
    return { logged: true };
  }
  if (action === 'clearErrorLogs') {
    requirePermission(user, 'health.repair');
    const rows = await s.list('errorLogs');
    for (const r of rows) await s.remove('errorLogs', r.id);
    return { cleared: rows.length };
  }
  if (action === 'repairSystemCache') {
    requirePermission(user, 'health.repair');
    return {
      ok: true,
      revision: String(await s.revision()),
      message: 'PostgreSQL tidak menggunakan cache Spreadsheet.',
    };
  }
  if (action === 'repairAiStudioSetup') {
    requirePermission(user, 'ai.manage');
    return {
      ok: true,
      ready: true,
      created_sheets: [],
      message:
        'Struktur PostgreSQL tersedia; master prompt diimpor dari data lama.',
    };
  }
  throw error('Mutasi tidak dikenal: ' + action, 400);
}

async function commit(pool, user, action, p, requestId) {
  if (!MUTATIONS.has(action)) throw error('Mutasi tidak diizinkan.');
  const key = String(requestId || p._request_id || p.record?._request_id || '');
  const hash = fingerprint(canonical({ action, payload: p }));
  return transaction(pool, async (db) => {
    // Re-read permissions inside the write lock: queued requests cannot retain revoked rights.
    const { effectiveProfile } = require('./auth.cjs');
    const result = await db.query(
      'SELECT id,username,profile,enabled FROM mwg_users WHERE id=$1',
      [user.id],
    );
    if (!result.rows[0]?.enabled)
      throw error('Sesi berakhir. Silakan login kembali.', 401);
    const current = await effectiveProfile(db, {
      ...result.rows[0].profile,
      id: user.id,
      username: result.rows[0].username,
    });
    if (key) {
      if (key.length > 200) throw error('Request ID terlalu panjang.');
      const receipt = await db.query(
        'SELECT fingerprint,result FROM mwg_requests WHERE user_id=$1 AND request_id=$2',
        [user.id, key],
      );
      if (receipt.rows.length) {
        if (receipt.rows[0].fingerprint !== hash)
          throw error('Request ID sudah digunakan untuk perubahan lain.', 409);
        return receipt.rows[0].result;
      }
    }
    const output = await mutate(db, current, action, p);
    if (key)
      await db.query(
        'INSERT INTO mwg_requests(user_id,request_id,fingerprint,result) VALUES($1,$2,$3,$4::jsonb)',
        [user.id, key, hash, JSON.stringify(output)],
      );
    return output;
  });
}
module.exports = { mutate, commit };
