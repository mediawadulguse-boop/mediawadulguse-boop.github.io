'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const pdf=require('../hot-pdf-import.js'),{page}=require('./helpers/hot-pdf-fixture.cjs');
test('two-column PDF cards keep titles, sources and descriptions together',()=>{
  const input=page(3,'hot',['Judul satu','Judul dua','Judul tiga','Judul empat']);
  input.items.push({s:'lanjutan judul',x:536,y:102,w:100,h:12});
  const rows=pdf.parsePage(input);assert.equal(rows.length,4);assert.equal(rows[1].judul,'Judul dua lanjutan judul');
  rows.forEach((r,i)=>{assert.equal(r.deskripsi,'Kronologi kartu '+(i+1)+' tentang pelayanan publik.');assert.equal(r.sumber,'TikTok - Comment - Akun Contoh '+i);assert.equal(r._pdf_page,3);assert.equal(r._pdf_number,i+1);assert.equal(r._pdf_section,'hot')});
});
test('annotation URL takes precedence over truncated visible links; shared URLs stay separate',()=>{
  const rows=pdf.parsePage(page(4));assert.equal(rows[0].link,'https://example.com/post/bersama?ref=lengkap');assert.equal(rows[0].link,rows[1].link);assert.notEqual(rows[0].sumber,rows[1].sumber);
});
test('missing complete links are flagged; PDF excerpts are retained without inventing text',()=>{
  const input=page(5);input.annotations=[];input.items.find(x=>x.s.startsWith('Kronologi')).s='Kutipan yang terpotong…';
  const rows=pdf.parsePage(input);assert.equal(rows[0].link,'');assert.equal(rows[0].deskripsi,'Kutipan yang terpotong…');assert.equal(rows[0]._pdf_warnings.length,2);
});
test('cover totals and section separators never become issue records',()=>{
  const cover={number:1,width:959,height:540,items:[{s:'Periode Monitoring: 2 November 2026',x:50,y:70,h:12},{s:'51',x:780,y:384,h:40}]};
  const out=pdf.parsePages([cover,page(2,'negative'),page(3,'hot')]);assert.deepEqual(out.counts,{hot:2,negative:2});assert.equal(out.date,'2026-11-02');assert.equal(out.numPages,3);
});
test('scanned, unsupported, oversized, cancelled, and excessive-record PDFs fail explicitly',async()=>{
  assert.throws(()=>pdf.parsePages([{items:[]}]),/pindai/);assert.throws(()=>pdf.parsePages([{items:[{s:'Some unrelated document'}],width:900,height:500}]),/belum dikenali/);
  assert.throws(()=>pdf.parsePages(Array.from({length:126},(_,i)=>page(i,'hot',['a','b','c','d']))),/500/);
  await assert.rejects(pdf.read({size:pdf.MAX_BYTES+1}),/8 MB/);
  const abort=new AbortController();abort.abort();await assert.rejects(pdf.read({size:1},{signal:abort.signal}),{name:'AbortError'});
});
test('dates are strict and source URLs cannot execute scripts or expose credentials',()=>{
  assert.equal(pdf.monitoringDate('PERIODE: 29 FEBRUARI 2028'),'2028-02-29');assert.equal(pdf.monitoringDate('31 November 2026'),'');
  for(const u of ['javascript:alert(1)','file:///tmp/private','https://user:secret@example.com/','example.com/a…','example.com/a b'])assert.equal(pdf.safeUrl(u),'');
  assert.equal(pdf.safeUrl('example.com/a'),'https://example.com/a');
});
