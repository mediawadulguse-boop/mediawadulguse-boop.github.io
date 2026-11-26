'use strict';
// Run through the account's Node environment. Never place APP_ROOT in public_html.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
function within(root, file) {
  const resolved = path.resolve(root, file);
  if (!resolved.startsWith(root + path.sep))
    throw new Error('Path rilis tidak valid.');
  return resolved;
}
function verifyRelease(directory) {
  const release = JSON.parse(
    fs.readFileSync(path.join(directory, 'release.json'), 'utf8'),
  );
  if (
    release.format !== 'mwg-nimbus-release-v1' ||
    !Array.isArray(release.files)
  )
    throw new Error('Manifest rilis tidak valid.');
  const wanted = new Set(['release.json']);
  for (const entry of release.files) {
    const file = within(directory, entry.path),
      stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('File rilis tidak valid.');
    const hash = crypto
      .createHash('sha256')
      .update(fs.readFileSync(file))
      .digest('hex');
    if (hash !== entry.sha256)
      throw new Error('Checksum rilis berbeda: ' + entry.path);
    wanted.add(entry.path);
  }
  function walk(relative = '') {
    for (const name of fs.readdirSync(path.join(directory, relative))) {
      const key = path.join(relative, name),
        file = within(directory, key),
        stat = fs.lstatSync(file);
      if (stat.isSymbolicLink())
        throw new Error('Symlink dalam arsip ditolak.');
      if (stat.isDirectory()) walk(key);
      else if (!wanted.has(key))
        throw new Error('File di luar manifest: ' + key);
    }
  }
  walk();
  return release;
}
async function install(root, revision, archive) {
  root = path.resolve(root);
  if (
    !/^\/home\/[A-Za-z0-9_-]+\/[A-Za-z0-9_./-]+$/.test(root) ||
    root.split('/').includes('public_html') ||
    root.split('/').includes('..')
  )
    throw new Error(
      'APP_ROOT harus berada di /home/USER/ dan di luar public_html.',
    );
  if (!/^[a-f0-9]{40}$/.test(revision || ''))
    throw new Error('Revision GitHub tidak valid.');
  if (Number(process.versions.node.split('.')[0]) < 22)
    throw new Error('Node.js 22 atau lebih baru diperlukan.');
  const shared = path.join(root, 'shared'),
    env = path.join(shared, '.env');
  if (!fs.existsSync(env))
    throw new Error('Buat shared/.env privat terlebih dahulu.');
  if ((fs.statSync(env).mode & 0o077) !== 0)
    throw new Error('Permission shared/.env harus 600.');
  const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
    .trim()
    .split('\n');
  for (const name of entries)
    if (name.startsWith('/') || name.split('/').includes('..'))
      throw new Error('Path arsip tidak valid.');
  const details = execFileSync('tar', ['-tvzf', archive], { encoding: 'utf8' })
    .trim()
    .split('\n');
  if (details.some((line) => !['-', 'd'].includes(line[0])))
    throw new Error('Link atau perangkat dalam arsip ditolak.');
  const finalDir = path.join(root, 'releases', revision);
  if (fs.existsSync(finalDir))
    throw new Error(
      'Rilis sudah tersedia. Gunakan commit baru untuk deploy ulang.',
    );
  const releaseDir = finalDir + '.staging-' + crypto.randomUUID();
  fs.mkdirSync(releaseDir, { recursive: true, mode: 0o700 });
  execFileSync('tar', [
    '-xzf',
    archive,
    '--no-same-owner',
    '--no-same-permissions',
    '-C',
    releaseDir,
  ]);
  const release = verifyRelease(releaseDir);
  if (release.revision !== revision)
    throw new Error('Revision manifest berbeda.');
  fs.mkdirSync(path.join(shared, 'storage'), { recursive: true, mode: 0o700 });
  fs.symlinkSync(env, path.join(releaseDir, '.env'));
  fs.symlinkSync(
    path.join(shared, 'storage'),
    path.join(releaseDir, 'storage'),
  );
  execFileSync(
    'npm',
    ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd: releaseDir, stdio: 'inherit' },
  );
  const current = path.join(root, 'current'),
    previous = fs.existsSync(current) ? fs.realpathSync(current) : null;
  if (previous)
    execFileSync(
      process.execPath,
      [path.join(previous, 'scripts', 'admin.cjs'), 'backup'],
      { cwd: previous, stdio: 'inherit' },
    );
  execFileSync(
    process.execPath,
    [path.join(releaseDir, 'scripts', 'admin.cjs'), 'migrate'],
    { cwd: releaseDir, stdio: 'inherit' },
  );
  // Fail before activation if the production database is empty or unavailable.
  const check = `const {database}=require('./lib/database.cjs');(async()=>{const p=database();try{const r=await p.query('SELECT id FROM mwg_users WHERE enabled=true LIMIT 1');if(!r.rows.length)throw Error('Import or bootstrap the database first');}finally{await p.end();}})().catch(()=>process.exit(1));`;
  execFileSync(process.execPath, ['-e', check], {
    cwd: releaseDir,
    stdio: 'inherit',
  });
  const startup = path.join(root, 'app.js'),
    dispatcher = "'use strict';\nrequire('./current/app.js');\n";
  if (fs.existsSync(startup) && fs.readFileSync(startup, 'utf8') !== dispatcher)
    throw new Error('app.js pada APP_ROOT sudah berisi aplikasi lain.');
  fs.writeFileSync(startup, dispatcher, { mode: 0o600 });
  const activate = (target) => {
    const next = path.join(root, 'current-next');
    if (fs.existsSync(next)) fs.unlinkSync(next);
    fs.symlinkSync(target, next);
    fs.renameSync(next, current);
    fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tmp', 'restart.txt'), String(Date.now()));
  };
  process.loadEnvFile(env);
  if (!/^https:\/\/[^/]+\/?$/.test(process.env.PUBLIC_URL || ''))
    throw new Error('PUBLIC_URL HTTPS wajib dikonfigurasi.');
  fs.renameSync(releaseDir, finalDir);
  activate(finalDir);
  try {
    let healthy = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        const response = await fetch(
            process.env.PUBLIC_URL.replace(/\/$/, '') +
              '/healthz?r=' +
              revision,
            { signal: AbortSignal.timeout(5000), cache: 'no-store' },
          ),
          out = await response.json();
        if (response.ok && out.ok && out.data?.revision === revision) {
          healthy = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!healthy) throw new Error('Health check rilis baru belum berhasil.');
    console.log('Rilis Nimbus aktif dan health check berhasil.');
  } catch (e) {
    if (previous) {
      activate(previous);
      console.error('Rilis sebelumnya dipulihkan.');
    }
    throw e;
  }
}
if (require.main === module)
  install(...process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
module.exports = { install, verifyRelease };
