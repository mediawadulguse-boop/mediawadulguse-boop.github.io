'use strict';
const https = require('node:https');
const dns = require('node:dns/promises');
const net = require('node:net');
const { error } = require('./auth.cjs');
const blocked = new net.BlockList();
for (const [ip, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
])
  blocked.addSubnet(ip, prefix, 'ipv4');
function publicAddress(address) {
  if (net.isIP(address) === 4) return !blocked.check(address, 'ipv4');
  return (
    net.isIP(address) === 6 &&
    /^[23]/i.test(address) &&
    !/^2001:(?:db8|0:|10:|20:)/i.test(address) &&
    !/^2002:/i.test(address)
  );
}
async function html(url, depth = 0) {
  if (depth > 3) throw error('Redirect terlalu banyak.');
  let target;
  try {
    target = new URL(url);
  } catch {
    throw error('URL tidak valid.');
  }
  if (
    target.protocol !== 'https:' ||
    target.username ||
    target.password ||
    (target.port && target.port !== '443')
  )
    throw error('Metadata memerlukan URL HTTPS publik.');
  const hostname = target.hostname.replace(/^\[|\]$/g, ''),
    addresses = net.isIP(hostname)
      ? [{ address: hostname, family: net.isIP(hostname) }]
      : await dns.lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((r) => !publicAddress(r.address)))
    throw error('Alamat sumber metadata tidak diizinkan.');
  const selected = addresses[0];
  const result = await new Promise((resolve, reject) => {
    const req = https.get(
      target,
      {
        headers: {
          'User-Agent': 'MediaWadul/1.0 metadata',
          Accept: 'text/html',
          'Accept-Encoding': 'identity',
        },
        lookup: (_host, options, callback) =>
          options.all
            ? callback(null, [selected])
            : callback(null, selected.address, selected.family),
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.resume();
          resolve({ redirect: new URL(res.headers.location, target).href });
          return;
        }
        if (
          res.statusCode !== 200 ||
          !/^text\/html\b/i.test(res.headers['content-type'] || '')
        ) {
          res.resume();
          reject(error('Halaman metadata tidak tersedia.'));
          return;
        }
        let size = 0;
        const chunks = [];
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > 1024 * 1024) {
            res.destroy(error('Halaman metadata terlalu besar.'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({
            text: Buffer.concat(chunks).toString('utf8'),
            url: target,
          }),
        );
        res.on('error', reject);
      },
    );
    req.setTimeout(8000, () => req.destroy(error('Metadata timeout.')));
    req.on('error', reject);
  });
  return result.redirect ? html(result.redirect, depth + 1) : result;
}
const decode = (text) =>
  String(text || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) =>
      Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : '',
    )
    .trim();
async function metadata(url) {
  const result = await html(url),
    tags = {};
  for (const tag of result.text.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = {};
    for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
      attrs[m[1].toLowerCase()] = decode(m[2] ?? m[3]);
    const name = attrs.property || attrs.name;
    if (name && attrs.content) tags[name.toLowerCase()] = attrs.content;
  }
  const title =
      tags['og:title'] ||
      decode(result.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''),
    description = tags['og:description'] || tags.description || '';
  return {
    title: title.slice(0, 500),
    description: description.slice(0, 5000),
    caption: description.slice(0, 5000),
    source: tags['og:site_name'] || result.url.hostname,
    platform: 'Website',
    source_type: 'Web',
    http_code: 200,
  };
}
module.exports = { metadata, publicAddress };
