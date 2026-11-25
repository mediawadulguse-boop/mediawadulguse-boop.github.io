'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const publicFiles = [
  'index.html', 'app.js', 'app.css', 'sw.js', 'manifest.webmanifest',
  'staff-roster.js', 'staff-roster.css',
  'brief-import.js', 'brief-import.css',
  'hot-pdf-import.js', 'hot-pdf-import.css',
  'long-text-editor.js', 'long-text-editor.css',
  'WADUL_GUSE_AUTOFILL_HELPER_v1.26.8.user.js'
];
const publicDirectories = [
  'icons', 'templates', 'vendor',
  'aiclipper', 'aiclipper-bridge', 'aiclipper-runtime'
];
const publicExtensions = new Set([
  '.html', '.js', '.mjs', '.css', '.png', '.jpg', '.jpeg', '.webp', '.svg',
  '.ico', '.woff', '.woff2', '.ttf', '.xlsx', '.webmanifest'
]);

function publicTreeFiles(relative) {
  const source = path.join(root, relative);
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error(`Tautan simbolik tidak didukung dalam aset publik: ${relative}`);
  if (stat.isDirectory()) {
    return fs.readdirSync(source).sort().filter(name => !name.startsWith('.'))
      .flatMap(name => publicTreeFiles(path.join(relative, name)));
  }
  if (publicExtensions.has(path.extname(relative)) || path.basename(relative) === 'LICENSE') return [relative];
  return [];
}

function readConfig() {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
  const allowed = ['apiUrl', 'listeningApiUrl', 'config_version', 'updated_at'];
  const unexpected = Object.keys(config).filter(key => !allowed.includes(key));
  if (unexpected.length) throw new Error('config.json memuat field yang belum disetujui untuk deployment publik.');
  if (typeof config.apiUrl !== 'string' || !/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(config.apiUrl)) {
    throw new Error('Konfigurasi Core API belum valid.');
  }
  return JSON.stringify(config, null, 2) + '\n';
}

function build() {
  // Validate all inputs before replacing the previous build directory.
  const config = readConfig();
  const files = [...publicFiles, ...publicDirectories.flatMap(publicTreeFiles)];
  for (const relative of files) {
    if (!fs.lstatSync(path.join(root, relative)).isFile()) throw new Error(`Aset publik tidak tersedia: ${relative}`);
  }
  fs.rmSync(output, {recursive:true, force:true});
  fs.mkdirSync(output, {recursive:true});
  for (const relative of files) {
    const target = path.join(output, relative);
    fs.mkdirSync(path.dirname(target), {recursive:true});
    fs.copyFileSync(path.join(root, relative), target);
  }
  fs.writeFileSync(path.join(output, 'config.json'), config);
  fs.writeFileSync(path.join(output, '_headers'), [
    '/', '  Cache-Control: no-cache',
    '/index.html', '  Cache-Control: no-cache',
    '/config.json', '  Cache-Control: no-store',
    '/sw.js', '  Cache-Control: no-cache', ''
  ].join('\n'));
  console.log(`Cloudflare Pages build ready: ${files.length + 2} files in dist/`);
}

build();
