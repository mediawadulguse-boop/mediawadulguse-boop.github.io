'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..'),
  output = path.join(root, 'dist', 'nimbus');
const publicFiles = [
  'index.html',
  'app.js',
  'app.css',
  'sw.js',
  'manifest.webmanifest',
  'staff-roster.js',
  'staff-roster.css',
  'brief-import.js',
  'brief-import.css',
  'hot-pdf-import.js',
  'hot-pdf-import.css',
  'long-text-editor.js',
  'long-text-editor.css',
  'WADUL_GUSE_AUTOFILL_HELPER_v1.26.8.user.js',
];
const publicDirs = [
  'icons',
  'templates',
  'vendor',
  'aiclipper',
  'aiclipper-bridge',
  'aiclipper-runtime',
];
const extensions = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.svg',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.xlsx',
  '.webmanifest',
]);
function files(dir) {
  return fs
    .readdirSync(path.join(root, dir))
    .sort()
    .filter((n) => !n.startsWith('.'))
    .flatMap((n) => {
      const relative = path.join(dir, n),
        stat = fs.lstatSync(path.join(root, relative));
      if (stat.isSymbolicLink())
        throw new Error('Symlink ditolak: ' + relative);
      return stat.isDirectory()
        ? files(relative)
        : extensions.has(path.extname(n)) || n === 'LICENSE'
          ? [relative]
          : [];
    });
}
function once(source, from, to) {
  if (
    !source.includes(from) ||
    source.indexOf(from) !== source.lastIndexOf(from)
  )
    throw new Error('Kontrak build berubah: ' + from.slice(0, 90));
  return source.replace(from, to);
}
function span(source, start, end, replacement) {
  const a = source.indexOf(start),
    b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0 || source.indexOf(start, a + 1) >= 0)
    throw new Error('Kontrak fungsi build berubah: ' + start);
  return source.slice(0, a) + replacement + source.slice(b);
}
function transformApp(source) {
  source = once(
    source,
    "const APP_VERSION='1.36.0';",
    "const APP_VERSION='1.36.1-nimbus';",
  );
  source = once(
    source,
    "const APP_BUILD='2026-11-07.1';",
    "const APP_BUILD='2026-11-26.nimbus.1';",
  );
  source = source.replace(
    /const CORE_FALLBACK_URL='https:\/\/script\.google\.com[^']+';/,
    "const CORE_FALLBACK_URL='./api';",
  );
  source = source.replace(
    /  const validApiUrl=url=>[^\n]+/,
    "  const validApiUrl=url=>String(url||'').trim()==='./api';",
  );
  source = source
    .replaceAll(
      'GitHub config.json • Core terverifikasi',
      'Nimbus Go • PostgreSQL',
    )
    .replaceAll('Fallback Core terverifikasi', 'Nimbus Go • API lokal');
  source = span(
    source,
    '  async function call(action,payload={},options={}){',
    '  function iframeCall(',
    `  async function call(action,payload={},options={}){
    payload=prepareWritePayload(action,payload);
    try{return await NimbusAPI.call(action,payload,{...options,token:Auth.session?.token||'',onTransport:markTransport});}
    catch(err){signalSessionExpired(err,options);throw err;}
  }
`,
  );
  source = once(
    source,
    '  function iframeCall(action,payload={},timeoutMs=25000){',
    `  function iframeCall(action,payload={},timeoutMs=25000){return call(action,payload,{fetchTimeoutMs:timeoutMs});`,
  );
  source = once(
    source,
    '  function jsonpCall(action,payload={},timeoutMs=15000,options={}){',
    `  function jsonpCall(action,payload={},timeoutMs=15000,options={}){return call(action,payload,{...options,fetchTimeoutMs:timeoutMs});`,
  );
  source = span(
    source,
    '  async function simpleLogin(username,password){',
    '  const inflightReads=',
    `  async function simpleLogin(username,password){
    return NimbusAPI.call('login',{username:String(username||'').trim(),password:String(password||'')},{onTransport:markTransport});
  }

`,
  );
  source = span(
    source,
    '  async function simpleCrudCommitBatch(items){',
    '  async function simpleCrudVerifyBatch(',
    `  async function simpleCrudCommitBatch(items){
    return call('simpleCrudCommitBatch',{items:simpleCrudCommitItems(items)},{skipQueue:true});
  }
`,
  );
  source = once(
    source,
    "      let packed='';try{packed=await simpleCrudDirectPayload(item)}catch(_e){packed=''}\n      if(!packed){simpleCrudPromoteToBatch(item);return}\n      const result=await jsonpCall('simpleCrudPacked',{packed},5200);",
    '      const result=await call(item.source_action,item.payload,{skipQueue:true});',
  );
  source = once(
    source,
    "return simpleCrudWrite('patchBrief',{id,changes,expected_updated_at:previous.updated_at||''}",
    "return simpleCrudWrite('patchBrief',{id,changes,expected_updated_at:previous.updated_at||'',relations:relationPayload}",
  );
  source = span(
    source,
    '  async function processSimpleCrudCommitBatch(items){',
    '  async function processSimpleCrudVerifyBatch(',
    `  async function processSimpleCrudCommitBatch(items){
    if(!items?.length||simpleCrudBatchBusy)return;
    simpleCrudBatchBusy=true;simpleCrudActive=1;items.forEach(x=>simpleCrudActiveIds.add(x.id));
    try{
      const out=await simpleCrudCommitBatch(items),receipts=new Map((out?.rows||[]).map(r=>[String(r.request_id),r]));
      for(const item of items){
        const receipt=receipts.get(String(item.request_id));
        if(receipt?.status==='SUCCESS'){simpleCrudRemove(item.id);simpleCrudApply(item,receipt.result||{});}
        else simpleCrudHandleFailure(item,new Error(receipt?.error||'Koneksi terputus sebelum konfirmasi server.'));
      }
    }catch(err){items.forEach(item=>simpleCrudHandleFailure(item,err));}
    finally{items.forEach(x=>simpleCrudActiveIds.delete(x.id));simpleCrudActive=0;simpleCrudBatchBusy=false;try{BackgroundSyncManager?.renderIndicator?.()}catch(_e){}scheduleSimpleCrud(80);}
  }

`,
  );
  // Passwords are never read back from PostgreSQL. Blank edits preserve the current hash.
  source = once(
    source,
    '<code>${Utils.esc(a.password)}</code>',
    '<span class="cell-sub">Tersimpan aman</span>',
  );
  source = once(
    source,
    '<input class="input" required name="password" value="${Utils.esc(a.password||\'\')}">',
    '<input class="input" type="password" autocomplete="new-password" minlength="8" ${a.id?\'\':\'required\'} name="password" value="" placeholder="${a.id?\'Kosongkan jika tetap\':\'Minimal 8 karakter\'}">',
  );
  source = span(
    source,
    '  function buildPublicUrl(meta){',
    '  async function ensurePublicAccess(',
    `  function buildPublicUrl(meta){return String(meta?.public_url||'');}
`,
  );
  source = source
    .replaceAll(
      'Upload Google Drive berjalan di background',
      'Upload database berjalan di background',
    )
    .replaceAll(
      'file dikirim ke Drive di background',
      'file disimpan di database di background',
    )
    .replaceAll('File Drive tetap privat.', 'Dokumen tersimpan di database.')
    .replaceAll(
      'File GZIP di Google Drive tetap privat;',
      'Dokumen di database tetap privat;',
    );
  return source;
}
function copy(source, target) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error('Symlink runtime ditolak.');
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const n of fs
      .readdirSync(source)
      .sort()
      .filter((n) => !n.startsWith('.')))
      copy(path.join(source, n), path.join(target, n));
  } else fs.copyFileSync(source, target);
}
function build() {
  const assets = [...publicFiles, ...publicDirs.flatMap(files)];
  const app = transformApp(fs.readFileSync(path.join(root, 'app.js'), 'utf8'));
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(path.join(output, 'public'), { recursive: true });
  for (const name of [
    'app.js',
    'package.json',
    'package-lock.json',
    'schema.sql',
    'lib',
    'scripts',
  ])
    copy(path.join(root, 'nimbus-server', name), path.join(output, name));
  fs.copyFileSync(
    path.join(root, 'nimbus-server', '.env.example'),
    path.join(output, '.env.example'),
  );
  for (const name of assets) {
    const target = path.join(output, 'public', name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, name), target);
  }
  fs.writeFileSync(path.join(output, 'public', 'app.js'), app);
  let index = fs.readFileSync(
    path.join(output, 'public', 'index.html'),
    'utf8',
  );
  index = once(
    index,
    '<script src="./app.js?v=1.36.0"></script>',
    '<script src="./nimbus-client.js?v=1.36.1-nimbus"></script>\n<script src="./app.js?v=1.36.1-nimbus"></script>',
  );
  index = index.replace(
    'href="./app.js?v=1.36.0"',
    'href="./app.js?v=1.36.1-nimbus"',
  );
  fs.writeFileSync(path.join(output, 'public', 'index.html'), index);
  fs.copyFileSync(
    path.join(root, 'scripts', 'nimbus-client.js'),
    path.join(output, 'public', 'nimbus-client.js'),
  );
  let sw = fs.readFileSync(path.join(output, 'public', 'sw.js'), 'utf8');
  sw = sw
    .replaceAll('mwg-shell-v1.36.0', 'mwg-shell-v1.36.1-nimbus')
    .replaceAll(
      "'./app.js?v=1.36.0'",
      "'./app.js?v=1.36.1-nimbus','./nimbus-client.js?v=1.36.1-nimbus'",
    );
  sw = once(
    sw,
    "  const isConfig=url.pathname.endsWith('/config.json');",
    "  if(url.pathname.endsWith('/api')||url.pathname.startsWith('/documents/'))return;\n  const isConfig=url.pathname.endsWith('/config.json');",
  );
  fs.writeFileSync(path.join(output, 'public', 'sw.js'), sw);
  fs.writeFileSync(
    path.join(output, 'public', 'config.json'),
    JSON.stringify(
      {
        backend: 'nimbus',
        apiUrl: './api',
        listeningApiUrl: './api',
        config_version: 'nimbus-1',
        updated_at: '2026-11-26T00:00:00+07:00',
      },
      null,
      2,
    ) + '\n',
  );
  const entries = [];
  function collect(dir) {
    for (const name of fs.readdirSync(path.join(output, dir)).sort()) {
      const relative = path.join(dir, name),
        file = path.join(output, relative);
      if (fs.statSync(file).isDirectory()) collect(relative);
      else
        entries.push({
          path: relative,
          sha256: crypto
            .createHash('sha256')
            .update(fs.readFileSync(file))
            .digest('hex'),
        });
    }
  }
  collect('');
  fs.writeFileSync(
    path.join(output, 'release.json'),
    JSON.stringify(
      {
        format: 'mwg-nimbus-release-v1',
        revision: process.env.GITHUB_SHA || 'local',
        files: entries,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'Nimbus build siap: ' + entries.length + ' file, tanpa konfigurasi privat.',
  );
  return output;
}
if (require.main === module) build();
module.exports = { build, transformApp, output };
