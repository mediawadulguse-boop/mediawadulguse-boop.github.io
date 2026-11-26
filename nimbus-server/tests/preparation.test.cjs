'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fingerprint } = require('../lib/auth.cjs');
const { verifyRelease } = require('../scripts/install-nimbus.cjs');
const { publicAddress } = require('../lib/metadata.cjs');
const { validate } = require('../lib/ai.cjs');
const { transformApp } = require('../../scripts/build-nimbus.cjs');
test('release validation rejects changed content, extra files and path traversal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mwg-release-'));
  try {
    fs.writeFileSync(path.join(dir, 'app.js'), 'example');
    const manifest = {
      format: 'mwg-nimbus-release-v1',
      files: [{ path: 'app.js', sha256: fingerprint('example') }],
    };
    fs.writeFileSync(path.join(dir, 'release.json'), JSON.stringify(manifest));
    assert.equal(verifyRelease(dir).files.length, 1);
    fs.writeFileSync(path.join(dir, 'app.js'), 'changed');
    assert.throws(() => verifyRelease(dir), /Checksum/);
    fs.writeFileSync(path.join(dir, 'app.js'), 'example');
    fs.writeFileSync(path.join(dir, '.env'), 'PRIVATE');
    assert.throws(() => verifyRelease(dir), /manifest/);
    fs.unlinkSync(path.join(dir, '.env'));
    manifest.files[0].path = '../private';
    fs.writeFileSync(path.join(dir, 'release.json'), JSON.stringify(manifest));
    assert.throws(() => verifyRelease(dir), /Path/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('metadata prevents private/reserved network targets and AI validates incomplete responses', () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '::1',
    'fc00::1',
    '::ffff:127.0.0.1',
    '2001:db8::1',
  ])
    assert(!publicAddress(address), address);
  assert(publicAddress('1.1.1.1'));
  assert(publicAddress('2606:4700:4700::1111'));
  const schema = {
    type: 'object',
    properties: { score: { type: 'integer', minimum: 0, maximum: 100 } },
    required: ['score'],
  };
  assert.throws(() => validate({}, schema), /lengkap/);
  assert.throws(() => validate({ score: 101 }, schema), /tidak valid/);
  assert.doesNotThrow(() => validate({ score: 0 }, schema));
});
test('Nimbus source targets the local API and fails if transport anchors change', () => {
  const original = fs.readFileSync(
      path.join(__dirname, '..', '..', 'app.js'),
      'utf8',
    ),
    compiled = transformApp(original);
  assert(compiled.includes("CORE_FALLBACK_URL='./api'"));
  assert(compiled.includes("NimbusAPI.call('login'"));
  assert(compiled.includes('relations:relationPayload'));
  assert(!compiled.includes('navigator.sendBeacon(Config.data.apiUrl,blob)'));
  assert.throws(
    () =>
      transformApp(
        original.replace(
          'async function simpleLogin(username,password)',
          'async function changedLogin(username,password)',
        ),
      ),
    /Kontrak/,
  );
});
