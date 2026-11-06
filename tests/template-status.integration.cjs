'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {loadApp,root}=require('./helpers/load-app.cjs');
(async()=>{
 const {dom,w,q,click,t,wait,errors}=await loadApp('briefs');
 assert.ok(process.env.MWG_XLSX_BROWSER,'Set MWG_XLSX_BROWSER to the SheetJS 0.20.3 browser bundle.');
 w.eval(fs.readFileSync(process.env.MWG_XLSX_BROWSER,'utf8'));
 const bytes=new w.Uint8Array(fs.readFileSync(path.join(root,'templates/Template_Impor_Brief.xlsx')));
 const workbook=w.XLSX.read(bytes,{type:'array'}),headers=w.XLSX.utils.sheet_to_json(workbook.Sheets.BRIEF,{header:1,raw:true,defval:''})[0];
 assert.deepEqual(Array.from(headers),Array.from(t.BriefImport.COLUMNS));assert.equal(headers[5],'kategori_konten');assert.equal(headers[6],'status');
 const file={name:'Template_Impor_Brief.xlsx',size:bytes.byteLength,arrayBuffer:async()=>bytes.buffer};
 await assert.rejects(t.BriefImport.parseFile(file),/belum berisi/);
 // Import the template's existing example data without generating another workbook.
 const realRead=w.XLSX.read;w.XLSX.read=(...args)=>{const data=realRead(...args);data.Sheets.BRIEF=data.Sheets.CONTOH;return data};
 await t.BriefImport.open();Object.defineProperty(q('#briefImportFile'),'files',{configurable:true,value:[file]});q('#briefImportFile').dispatchEvent(new w.Event('change'));
 await wait(()=>q('#briefImportPreview').textContent.includes('Status: Planning'),'XLSX preview status');
 assert.ok(q('#briefImportPreview').textContent.includes('Carousel'));click('#runBriefImport');
 await wait(()=>t.LocalDB.load().briefs.some(b=>b.judul==='Edukasi alur pengaduan Wadul Gus’e'&&b.status==='Planning'),'saved workbook status');
 assert.equal(t.LocalDB.load().briefs.find(b=>b.judul==='Edukasi alur pengaduan Wadul Gus’e').kategori_konten,'Carousel');
 click('.modal-overlay [data-close-modal]');w.XLSX.read=realRead;
 await t.BriefImport.open();const csv='tanggal,judul,detail_brief,kategori_konten,status,link_konten\n2026-11-06,Contoh publish dari Excel,Arahan produksi,Video,Publish,https://www.instagram.com/p/contoh/';
 Object.defineProperty(q('#briefImportFile'),'files',{configurable:true,value:[{name:'status.csv',size:csv.length,text:async()=>csv}]});q('#briefImportFile').dispatchEvent(new w.Event('change'));
 await wait(()=>q('#briefImportPreview').textContent.includes('Status: Publish'),'Publish preview');click('#runBriefImport');
 await wait(()=>t.LocalDB.load().briefs.some(b=>b.judul==='Contoh publish dari Excel'&&b.status==='Publish'),'Publish persisted');
 const saved=t.LocalDB.load().briefs.find(b=>b.judul==='Contoh publish dari Excel');assert.equal(saved.kategori_konten,'Video');assert.equal(saved.link_konten,'https://www.instagram.com/p/contoh/');
 await wait(()=>t.LocalDB.load().contentLinks.some(l=>l.brief_id===saved.id),'publication relation');
 assert.deepEqual(errors,[]);dom.window.close();console.log('PASS: XLSX template headers, empty template validation, status and category preview, saved Planning/Carousel, and Publish with publication relation.');
})().catch(e=>{console.error(e);process.exit(1)});
