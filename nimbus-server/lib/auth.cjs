'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const PRESETS = {
  SUPERADMIN: ['*'],
  ANALIS: [
    'dashboard.view',
    'brief.view',
    'brief.create',
    'brief.edit',
    'task.view_own',
    'task.create',
    'task.edit_own',
    'calendar.view',
    'calendar.create',
    'hotissue.view',
    'hotissue.create',
    'hotissue.edit',
    'meeting.view',
    'report.view',
    'report.export',
    'html.view',
    'html.manage',
    'footage.view',
    'footage.create',
    'footage.edit',
    'insight.view',
    'insight.manage',
    'ai.use',
    'listening.view',
    'listening.convert',
    'template.view',
  ],
  STAF: [
    'dashboard.view',
    'task.view_own',
    'task.create',
    'task.edit_own',
    'calendar.view',
    'report.view',
    'footage.view',
    'footage.create',
    'footage.edit',
    'insight.view',
    'listening.view',
  ],
};
function error(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
function has(user, permission) {
  if (!user) return false;
  const own = Array.isArray(user.permissions) ? user.permissions : [];
  const permissions =
    user.permissions_override || own.length ? own : PRESETS[user.role] || [];
  return permissions.includes('*') || permissions.includes(permission);
}
function requirePermission(user, ...permissions) {
  if (!user) throw error('Sesi berakhir. Silakan login kembali.', 401);
  if (!permissions.some((permission) => has(user, permission)))
    throw error('Anda tidak memiliki izin untuk tindakan ini.', 403);
}
function ownTask(user, task) {
  return (
    String(task.petugas_id || '') === String(user.id) ||
    (!task.petugas_id &&
      String(task.petugas || '').toLowerCase() ===
        String(user.nama || '').toLowerCase())
  );
}
function publicProfile(profile) {
  const fields = [
    'id',
    'username',
    'nama',
    'role',
    'whatsapp',
    'permissions',
    'permissions_override',
    'status_staf',
    'tanggal_resign',
    'status_staf_updated_at',
    'created_at',
    'updated_at',
    'enabled',
  ];
  return Object.fromEntries(
    fields
      .filter((key) => Object.hasOwn(profile, key))
      .map((key) => [key, profile[key]]),
  );
}
function fingerprint(value) {
  return crypto
    .createHash('sha256')
    .update(
      Buffer.isBuffer(value) || ArrayBuffer.isView(value)
        ? value
        : String(value),
    )
    .digest('hex');
}
async function passwordHash(password, { legacy = false } = {}) {
  if (
    typeof password !== 'string' ||
    password.length < (legacy ? 1 : 8) ||
    password.length > 1024
  )
    throw error('Password baru harus 8–1024 karakter.');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${hash.toString('hex')}`;
}
async function passwordMatches(password, stored) {
  if (typeof password !== 'string' || password.length > 1024) return false;
  const [format, salt, hex] = String(stored || '').split(':');
  if (format !== 'scrypt' || !salt || !hex || !/^[a-f0-9]{128}$/.test(hex))
    return false;
  const hash = await scrypt(password, salt, 64),
    expected = Buffer.from(hex, 'hex');
  return crypto.timingSafeEqual(hash, expected);
}
async function login(db, payload, remoteAddress = '') {
  const username = String(payload.username || '')
    .trim()
    .toLowerCase();
  const bucket = fingerprint(username + '|' + remoteAddress);
  const count = await db.query(
    `INSERT INTO mwg_login_attempts(bucket,count,reset_at) VALUES($1,1,now()+interval '15 minutes')
    ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN mwg_login_attempts.reset_at<now() THEN 1 ELSE mwg_login_attempts.count+1 END,
    reset_at=CASE WHEN mwg_login_attempts.reset_at<now() THEN now()+interval '15 minutes' ELSE mwg_login_attempts.reset_at END RETURNING count`,
    [bucket],
  );
  if (count.rows[0].count > 12)
    throw error(
      'Terlalu banyak percobaan login. Coba kembali 15 menit lagi.',
      429,
    );
  const result = await db.query(
    'SELECT * FROM mwg_users WHERE username=$1 AND enabled=true',
    [username],
  );
  const row = result.rows[0];
  const valid = await passwordMatches(
    String(payload.password || ''),
    row?.password_hash || '',
  );
  if (!row || !valid) throw error('Username atau password tidak sesuai.', 401);
  await db.query('DELETE FROM mwg_login_attempts WHERE bucket=$1', [bucket]);
  const token = crypto.randomBytes(32).toString('base64url');
  const days = Math.max(
    1,
    Math.min(365, Number(process.env.SESSION_DAYS) || 30),
  );
  const expires = new Date(Date.now() + days * 86400000).toISOString();
  await db.query(
    'INSERT INTO mwg_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)',
    [fingerprint(token), row.id, expires],
  );
  const profile = await effectiveProfile(db, {
    ...row.profile,
    id: row.id,
    username: row.username,
  });
  return { token, user: profile, expires_at: expires };
}
async function authenticate(db, token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200)
    throw error('Sesi berakhir. Silakan login kembali.', 401);
  const result = await db.query(
    `SELECT u.id,u.username,u.profile FROM mwg_sessions s JOIN mwg_users u ON u.id=s.user_id
    WHERE s.token_hash=$1 AND s.expires_at>now() AND u.enabled=true`,
    [fingerprint(token)],
  );
  const row = result.rows[0];
  if (!row) throw error('Sesi berakhir. Silakan login kembali.', 401);
  return effectiveProfile(db, {
    ...row.profile,
    id: row.id,
    username: row.username,
  });
}
async function effectiveProfile(db, profile) {
  if (profile.role === 'SUPERADMIN')
    return {
      ...publicProfile(profile),
      permissions: ['*'],
      permissions_override: false,
    };
  const settings = await db.query(
    "SELECT value FROM mwg_settings WHERE key='permission_overrides'",
  );
  const override = settings.rows[0]?.value?.[String(profile.id)];
  const result = publicProfile(profile);
  if (Array.isArray(override)) {
    result.permissions = override;
    result.permissions_override = true;
  } else {
    result.permissions = result.permissions_override
      ? result.permissions || []
      : PRESETS[result.role] || [];
  }
  return result;
}
module.exports = {
  PRESETS,
  error,
  has,
  requirePermission,
  ownTask,
  publicProfile,
  effectiveProfile,
  fingerprint,
  passwordHash,
  passwordMatches,
  login,
  authenticate,
};
