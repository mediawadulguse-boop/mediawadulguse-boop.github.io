'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
function quote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}
function deploy() {
  const env = process.env,
    required = [
      'NIMBUS_SSH_HOST',
      'NIMBUS_SSH_USER',
      'NIMBUS_SSH_PORT',
      'NIMBUS_SSH_PRIVATE_KEY',
      'NIMBUS_SSH_KNOWN_HOSTS',
      'NIMBUS_APP_ROOT',
      'NIMBUS_NODE_BIN',
      'GITHUB_SHA',
    ];
  for (const key of required)
    if (!env[key])
      throw new Error('Konfigurasi deployment belum lengkap: ' + key);
  const host = env.NIMBUS_SSH_HOST,
    user = env.NIMBUS_SSH_USER,
    port = env.NIMBUS_SSH_PORT,
    root = env.NIMBUS_APP_ROOT,
    nodeBin = env.NIMBUS_NODE_BIN,
    revision = env.GITHUB_SHA;
  if (
    !/^[A-Za-z0-9.-]+$/.test(host) ||
    !/^\d{1,5}$/.test(port) ||
    !/^\w+$/.test(user) ||
    !/^\/home\/[A-Za-z0-9_-]+\/[A-Za-z0-9_./-]+$/.test(root) ||
    !/^\/[A-Za-z0-9_./-]+$/.test(nodeBin) ||
    !/^[a-f0-9]{40}$/.test(revision)
  )
    throw new Error('Format konfigurasi SSH tidak valid.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mwg-deploy-')),
    key = path.join(dir, 'key'),
    known = path.join(dir, 'known_hosts');
  try {
    fs.writeFileSync(key, env.NIMBUS_SSH_PRIVATE_KEY + '\n', { mode: 0o600 });
    fs.writeFileSync(known, env.NIMBUS_SSH_KNOWN_HOSTS + '\n', { mode: 0o600 });
    const common = [
        '-i',
        key,
        '-o',
        'BatchMode=yes',
        '-o',
        'StrictHostKeyChecking=yes',
        '-o',
        'IdentitiesOnly=yes',
        '-o',
        'UserKnownHostsFile=' + known,
      ],
      target = user + '@' + host;
    const ssh = (command) =>
      execFileSync('ssh', [...common, '-p', port, target, command], {
        stdio: 'inherit',
      });
    ssh('umask 077; mkdir -p ' + quote(root + '/incoming'));
    const archive = path.join(dir, 'release.tar.gz');
    execFileSync('tar', [
      '-czf',
      archive,
      '-C',
      path.resolve(__dirname, '..', 'dist', 'nimbus'),
      '.',
    ]);
    const remoteArchive = root + '/incoming/' + revision + '.tar.gz',
      remoteScript = root + '/incoming/' + revision + '-install.cjs';
    for (const [local, remote] of [
      [archive, remoteArchive],
      [
        path.resolve(
          __dirname,
          '..',
          'nimbus-server',
          'scripts',
          'install-nimbus.cjs',
        ),
        remoteScript,
      ],
    ])
      execFileSync(
        'scp',
        [...common, '-P', port, local, target + ':' + remote],
        { stdio: 'inherit' },
      );
    ssh(
      'PATH=' +
        quote(nodeBin) +
        ':"$PATH" ' +
        quote(nodeBin + '/node') +
        ' ' +
        [remoteScript, root, revision, remoteArchive].map(quote).join(' '),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
if (require.main === module)
  try {
    deploy();
  } catch (e) {
    console.error('Deployment Nimbus gagal: ' + e.message);
    process.exitCode = 1;
  }
module.exports = { quote, deploy };
