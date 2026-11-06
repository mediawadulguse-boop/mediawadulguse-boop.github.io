'use strict';
const assert=require('node:assert/strict');
const {loadApp}=require('./helpers/load-app.cjs'),{page}=require('./helpers/hot-pdf-fixture.cjs');
(async()=>{
  const {dom,w,q,qa,t,click,wait,errors}=await loadApp('hotissues');
  const parsed=t.HotPdfImport.parsePages([{number:1,width:959,height:540,items:[{s:'Periode Monitoring: 2 November 2026',x:40,y:70,h:12}]},page(2,'negative',['Isu negatif pertama','Isu negatif kedua']),page(3,'hot')]);
  const select=async(file)=>{Object.defineProperty(q('#hotImportFile'),'files',{configurable:true,value:[file]});q('#hotImportFile').dispatchEvent(new w.Event('change'));await wait(()=>!q('#runHotImport').textContent.includes('Membaca'),'file read')};
  t.HotPdfImport.read=async()=>parsed;t.HotIssue.openHotBulkImport();assert.match(q('#hotImportFile').accept,/\.pdf/);
  await select({name:'monitoring.pdf',size:200});assert.equal(q('#hotPdfSection').value,'hot');assert.equal(q('#hotPdfDate').value,'2026-11-02');assert.equal(qa('[data-hot-pdf-pick]').length,2);assert.equal(q('#runHotImport').textContent,'Impor 2 Data');
  q('#hotPdfSection').value='all';q('#hotPdfSection').dispatchEvent(new w.Event('change'));assert.equal(qa('[data-hot-pdf-pick]').length,4);
  click('[data-hot-pdf-pick="0"]');assert.equal(q('#runHotImport').textContent,'Impor 3 Data');click('[data-hot-pdf-pick="0"]');
  const calls=[],realWrite=t.API.simpleCrudWrite;t.API.simpleCrudWrite=(action,payload,meta)=>{calls.push({action,payload,meta});return realWrite(action,payload,meta)};
  click('#runHotImport');await wait(()=>q('#hotPdfReport'),'PDF report');await wait(()=>q('#hotPdfReportStatus').textContent.includes('Tersinkron')&&!q('#hotPdfReportStatus').textContent.includes('sedang berjalan'),'records synced');
  assert.equal(calls.length,4);assert.ok(calls.every(x=>x.action==='saveHotIssue'&&x.payload.record.tanggal==='2026-11-02'));assert.ok(calls.every(x=>!Object.keys(x.payload.record).some(k=>k.startsWith('_pdf'))));
  const saved=t.LocalDB.load().hotIssues.filter(x=>x.link==='https://example.com/post/bersama?ref=lengkap');assert.equal(saved.length,4);assert.equal(new Set(saved.map(x=>x.id)).size,4);
  click('.modal-overlay [data-close-modal]');t.HotIssue.openHotBulkImport();await select({name:'monitoring.pdf',size:200});assert.equal(q('#runHotImport').disabled,true);assert.match(q('#hotImportPreview').textContent,/Duplikat — dilewati/);
  // A different report date remains independently importable.
  q('#hotPdfDate').value='2026-11-03';q('#hotPdfDate').dispatchEvent(new w.Event('change'));assert.equal(q('#runHotImport').textContent,'Impor 2 Data');
  // A slower previous read cannot replace a later file or re-enable import while loading.
  let resolveOld;t.HotPdfImport.read=()=>new Promise(r=>resolveOld=r);const oldSelect=select({name:'slow.pdf',size:200});assert.equal(q('#runHotImport').disabled,true);
  const csv='judul,deskripsi,sumber,link\nContoh dari CSV,Deskripsi CSV,Media,https://example.org/csv';await select({name:'new.csv',size:csv.length,text:async()=>csv});resolveOld(parsed);await oldSelect;
  assert.equal(q('#hotPdfOptions').hidden,true);assert.match(q('#hotImportPreview').textContent,/Contoh dari CSV/);assert.doesNotMatch(q('#hotImportPreview').textContent,/Permintaan lampu/);
  click('#runHotImport');await wait(()=>t.LocalDB.load().hotIssues.some(x=>x.judul==='Contoh dari CSV'),'CSV regression');
  // Report truthful pending and terminal error states, without contacting a server.
  click('.modal-overlay [data-close-modal]');t.HotIssue.openHotBulkImport();t.HotPdfImport.read=async()=>({...parsed,date:'2026-11-04'});await select({name:'pending.pdf',size:200});
  t.API.simpleCrudWrite=async()=>({queued:true});click('#runHotImport');await wait(()=>q('#hotPdfReport'),'pending report');assert.match(q('#hotPdfReportStatus').textContent,/Sinkronisasi sedang berjalan/);
  const pending=t.Store.hotIssues.find(x=>x.tanggal==='2026-11-04');w.dispatchEvent(new w.CustomEvent('mwg:crud-result',{detail:{action:'saveHotIssue',id:pending.id,ok:false,error:'Penolakan contoh'}}));assert.match(q('#hotPdfReportList').textContent,/Penolakan contoh/);
  assert.deepEqual(errors,[]);dom.window.close();console.log('PASS: PDF section/date/selection, all shared-link mentions saved, duplicate prevention, async race, CSV regression, and truthful sync/error report.');
})().catch(e=>{console.error(e);process.exit(1)});
