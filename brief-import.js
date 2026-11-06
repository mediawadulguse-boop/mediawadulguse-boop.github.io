/* Bulk brief input. Shares the application's durable, verified CRUD queue. */
'use strict';
const BriefImport = (() => {
  const MAX_ROWS=100, MAX_BYTES=8*1024*1024;
  const COLUMNS=['tanggal','judul','detail_brief','tujuan_konten','konten_pilar','kategori_konten','status','deadline','petugas','jobdesk','target_audience','custom_audience','target_realistis','target_optimis','target_ambisius','peralatan','link_konten'];
  const REQUIRED=['tanggal','judul','detail_brief'];
  const ALIASES={tanggal_tayang:'tanggal',judul_brief:'judul',detail:'detail_brief',pilar:'konten_pilar',format:'kategori_konten',format_konten:'kategori_konten',status_produksi:'status',link_publish:'link_konten',deadline_produksi:'deadline',nama_petugas:'petugas',pic:'petugas',jobs:'jobdesk',tujuan:'tujuan_konten'};
  const norm=v=>String(v??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
  const header=v=>norm(v).replace(/\s*\*$/,'').replace(/[\s-]+/g,'_');
  const split=v=>String(v??'').split(/[;\n]/).map(x=>x.trim()).filter(Boolean);
  const esc=v=>Utils.esc(String(v??''));
  let state={items:[],file:'',busy:false,submitted:false,owner:''},readerPromise=null,monitor=0,readVersion=0;
  const owner=()=>String(Config.data.apiUrl||'demo')+'|'+String(Auth.session?.user?.id||'')+'|'+String(Auth.session?.token||'');
  function validDate(s){return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s}
  function dateValue(value,date1904=false){
    let s='';
    if(value instanceof Date){if(!Number.isFinite(value.getTime()))return '';s=[value.getUTCFullYear(),String(value.getUTCMonth()+1).padStart(2,'0'),String(value.getUTCDate()).padStart(2,'0')].join('-')}
    else if(typeof value==='number'&&Number.isFinite(value)&&value>=1&&value<100000){
      const d=new Date(Date.UTC(1899,11,30)+(Math.floor(value)+(date1904?1462:0))*86400000);s=d.toISOString().slice(0,10);
    }else{
      const text=String(value??'').trim();let m=text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if(m)s=`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
      else if((m=text.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/)))s=`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    }
    return validDate(s)?s:'';
  }
  const key=r=>dateValue(r.tanggal)+'|'+norm(r.judul);
  // Stable across retries and file names. No personal data is put in record IDs.
  function stableId(value){let a=2166136261,b=2246822519;for(let i=0;i<value.length;i++){a=Math.imul(a^value.charCodeAt(i),16777619);b=Math.imul(b^value.charCodeAt(i),3266489917)}return 'BRF-IMP-'+(a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0')}
  function schema(raw){
    const fields=raw.map(v=>ALIASES[header(v)]||header(v)),seen=new Set();
    fields.forEach(f=>{if(f&&seen.has(f))throw new Error('Kolom ganda: '+f);if(f)seen.add(f)});
    const missing=REQUIRED.filter(f=>!seen.has(f));if(missing.length)throw new Error('Kolom wajib belum ada: '+missing.join(', ')+'. Gunakan template BRIEF.');
    const unknown=fields.filter(f=>f&&!COLUMNS.includes(f));if(unknown.length)throw new Error('Kolom tidak dikenal: '+unknown.join(', ')+'. Sesuaikan dengan template agar data tidak terlewat.');
    return fields;
  }
  function csvMatrix(text){
    text=String(text).replace(/^\uFEFF/,'');const first=text.split(/\r?\n/,1)[0];
    const count=d=>{let q=false,n=0;for(let i=0;i<first.length;i++){if(first[i]==='"'){if(q&&first[i+1]==='"')i++;else q=!q}else if(!q&&first[i]===d)n++}return n};
    const delimiter=[',',';','\t'].sort((a,b)=>count(b)-count(a))[0];
    const rows=[],row=[];let cell='',quoted=false;
    for(let i=0;i<text.length;i++){
      const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++}else if(c==='"')quoted=false;else cell+=c;continue}
      if(c==='"'){quoted=true;continue}if(c===delimiter){row.push(cell);cell='';continue}
      if(c==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row.splice(0));cell='';continue}cell+=c;
    }
    if(quoted)throw new Error('Tanda kutip pada CSV belum ditutup.');
    row.push(cell.replace(/\r$/,''));if(row.some(v=>v.trim()))rows.push(row);return rows;
  }
  function tableRows(matrix,date1904=false){
    if(!matrix.length)throw new Error('File kosong.');
    const fields=schema(matrix[0]),result=[];
    for(let i=1;i<matrix.length;i++){
      const cells=matrix[i];if(!cells.some(v=>String(v??'').trim()))continue;
      if(cells.some((v,j)=>String(v??'').trim()&&!fields[j]))throw new Error('Baris '+(i+1)+': data berada di kolom tanpa judul.');
      result.push({row:i+1,raw:Object.fromEntries(fields.filter(Boolean).map(f=>[f,cells[fields.indexOf(f)]??''])),date1904});
      if(result.length>MAX_ROWS)throw new Error(`Maksimal ${MAX_ROWS} brief per impor. Bagi file menjadi beberapa bagian.`);
    }
    if(!result.length)throw new Error('Sheet BRIEF belum berisi data. Isi mulai baris 2; sheet CONTOH tidak diimpor.');
    return result;
  }
  function ensureReader(){
    if(window.XLSX)return Promise.resolve(window.XLSX);if(readerPromise)return readerPromise;
    readerPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');let timer;
      const fail=()=>{clearTimeout(timer);script.remove();readerPromise=null;reject(new Error('Pembaca Excel gagal dimuat. Periksa koneksi atau simpan sheet BRIEF sebagai CSV.'))};
      timer=setTimeout(fail,20000);script.src='https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';script.async=true;
      script.onload=()=>{if(!window.XLSX)return fail();clearTimeout(timer);resolve(window.XLSX)};script.onerror=fail;document.head.appendChild(script);
    });return readerPromise;
  }
  async function parseFile(file){
    if(!file)throw new Error('Pilih file Excel terlebih dahulu.');if(file.size>MAX_BYTES)throw new Error('Ukuran file maksimal 8 MB.');
    const extension=String(file.name).split('.').pop().toLowerCase();
    if(extension==='csv')return tableRows(csvMatrix(await file.text()));
    if(!['xlsx','xls'].includes(extension))throw new Error('Gunakan file .xlsx, .xls, atau .csv.');
    const X=await ensureReader(),wb=X.read(await file.arrayBuffer(),{type:'array',cellDates:false,sheetRows:1002});
    const name=wb.SheetNames.find(n=>norm(n)==='brief')||(wb.SheetNames.length===1?wb.SheetNames[0]:'');
    if(!name)throw new Error('Sheet BRIEF tidak ditemukan. Gunakan template atau beri nama sheet input BRIEF.');
    const sheet=wb.Sheets[name],range=sheet['!fullref']||sheet['!ref'];
    if(range&&X.utils.decode_range(range).e.r>1000)throw new Error('Sheet terlalu panjang. Sisakan paling banyak 100 baris data dan hapus baris tambahan.');
    return tableRows(X.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true,blankrows:true}),!!wb.Workbook?.WBProps?.date1904);
  }
  function normalizeRow(input){
    const {raw,row,date1904}=input,errors=[],warnings=[];
    const text=(field,max)=>{const s=String(raw[field]??'').trim();if(s.length>max)errors.push(field+' maksimal '+max+' karakter');return s};
    const tanggal=dateValue(raw.tanggal,date1904),judul=text('judul',500),detail_brief=text('detail_brief',20000);
    if(!tanggal)errors.push('Tanggal wajib dan harus valid');if(!judul)errors.push('Judul wajib');if(!detail_brief)errors.push('Detail brief wajib');
    const deadline=String(raw.deadline??'').trim()?dateValue(raw.deadline,date1904):tanggal;
    if(!deadline)errors.push('Deadline tidak valid');else if(tanggal&&deadline>tanggal)warnings.push('Deadline sesudah tanggal tayang');
    const choice=(field,values,defaultValue)=>{const v=text(field,500);if(!v)return defaultValue||values[0]||'';const resolved=field==='konten_pilar'?Config.resolvePillar(v):v;const found=values.find(x=>norm(x)===norm(resolved));if(!found)errors.push(field+' tidak dikenali: '+v);return found||v};
    const konten_pilar=choice('konten_pilar',Config.pillars),kategori_konten=choice('kategori_konten',Config.categories),status=choice('status',Config.briefStatuses,'Draft');
    let link_konten=text('link_konten',2000);
    if(link_konten){try{const url=new URL(link_konten);if(!['http:','https:'].includes(url.protocol)||!url.hostname)throw new Error('url');link_konten=url.href}catch{errors.push('link_konten harus berupa URL http/https yang valid')}}
    if(status==='Publish'&&!link_konten)errors.push('Status Publish wajib memiliki link_konten');
    const publicationLinks=link_konten?[{url:link_konten,platform:InsightTracker.detectPlatform(link_konten),account_label:''}]:[];
    const people=split(raw.petugas),groups=split(raw.jobdesk),jobdesk=[],seen=new Set();
    if(people.length!==groups.length)errors.push('Jumlah petugas dan kelompok jobdesk harus sama (pisahkan dengan titik koma)');
    people.forEach((person,i)=>{
      const accounts=Store.accounts||[],exact=accounts.find(a=>String(a.id)===person),matches=exact?[exact]:accounts.filter(a=>norm(a.nama)===norm(person)||norm(a.username)===norm(person));
      if(matches.length!==1){errors.push(matches.length?'Nama petugas ambigu, gunakan ID: '+person:'Petugas tidak ditemukan: '+person);return}
      const account=matches[0];if(!StaffRoster.isActive(account)){errors.push('Petugas sudah resign: '+person);return}
      if(seen.has(String(account.id))){errors.push('Petugas berulang: '+person);return}seen.add(String(account.id));
      const jobs=String(groups[i]||'').split(',').map(x=>x.trim()).filter(Boolean);
      if(!jobs.length)errors.push('Jobdesk wajib untuk '+person);
      const canonical=jobs.map(job=>{const alias={designer:'Desainer',videographer:'Videografer'}[norm(job)]||job;const known=Config.jobs.find(j=>norm(j)===norm(alias));if(!known)errors.push('Jobdesk tidak dikenali: '+job);return known||job});
      jobdesk.push({petugas_id:account.id,petugas:account.nama,jobdesk:[...new Set(canonical)]});
    });
    const target_audience=split(raw.target_audience).map(a=>{const found=Config.audiences.find(x=>norm(x)===norm(a));if(!found)errors.push('Audience tidak dikenali: '+a+' (gunakan custom_audience untuk tambahan)');return found||a});
    const defaults=InsightTracker.defaultTargetsForBrief({kategori_konten}),number=(name,defaultValue)=>{const v=raw[name];if(v===null||v===undefined||String(v).trim()==='')return Number(defaultValue)||0;const n=typeof v==='number'?v:Number(String(v).trim());if((typeof v!=='number'&&!/^\d+$/.test(String(v).trim()))||!Number.isSafeInteger(n)||n<0)errors.push(name+' harus bilangan bulat >= 0, tanpa pemisah ribuan');return n};
    const equipment=split(raw.peralatan),record={tanggal,judul,detail_brief,deadline,tujuan_konten:text('tujuan_konten',10000),konten_pilar,kategori_konten,jobdesk,petugas_ids:jobdesk.map(x=>x.petugas_id),petugas:jobdesk.map(x=>x.petugas),target_audience:[...new Set(target_audience)],custom_audience:text('custom_audience',1000),target_realistis:number('target_realistis',defaults.realistis),target_optimis:number('target_optimis',defaults.optimis),target_ambisius:number('target_ambisius',defaults.ambisius),peralatan:equipment,status,approval_status:'Draft',link_konten,_publication_links:publicationLinks,insight_reach:0,hasil_performa:''};
    record.id=stableId(key(record));return {row,record,errors,warnings,duplicate:false,status:'ready',message:''};
  }
  function prepareRows(rows){
    const existing=new Set((Store.briefs||[]).map(key)),ids=new Set((Store.briefs||[]).map(r=>String(r.id))),seen=new Set();
    return rows.map(input=>{const item=normalizeRow(input),k=key(item.record);if(!item.errors.length){item.duplicate=existing.has(k)||ids.has(item.record.id)||seen.has(k);seen.add(k)}return item});
  }
  const counts=()=>({ready:state.items.filter(x=>!x.errors.length&&!x.duplicate&&x.status==='ready').length,error:state.items.filter(x=>x.errors.length).length,duplicate:state.items.filter(x=>x.duplicate).length});
  function syncStatuses(){
    for(const item of state.items){
      if(item.status!=='queued')continue;
      const pending=API.getBriefSyncState(item.record.id),record=Store.briefById(item.record.id);
      if(pending.length){item.message=pending.find(x=>x.error)?.error||'Menunggu konfirmasi server';continue}
      if(record&&!record._sync_pending){item.status='saved';item.message='Brief dan penugasan tersimpan'}
      else if(!record){item.status='failed';item.message='Belum tersimpan. Periksa notifikasi, lalu coba ulang.'}
    }
  }
  function preview(){
    syncStatuses();const c=counts(),submitted=state.items.filter(x=>['queued','saved','failed'].includes(x.status));
    const summary=state.submitted?`<strong>${submitted.filter(x=>x.status==='saved').length} tersimpan</strong><span>${submitted.filter(x=>x.status==='queued').length} menunggu sinkronisasi</span><span>${state.items.filter(x=>x.status==='partial').length} tugas belum tersimpan</span><span>${submitted.filter(x=>x.status==='failed').length} gagal</span>`:`<strong>${c.ready} siap diimpor</strong><span>${c.error} bermasalah</span>`;
    return `<div class="brief-import-summary" role="status" aria-live="polite">${summary}<span>${c.duplicate} duplikat dilewati</span></div><div class="brief-import-table"><table><thead><tr><th>Baris</th><th>Brief</th><th>Tayang / Deadline</th><th>Petugas</th><th>Hasil pemeriksaan</th></tr></thead><tbody>${state.items.map(item=>{const r=item.record,bad=item.errors.length||['failed','partial'].includes(item.status),label=item.errors.length?'Perbaiki':item.duplicate?'Duplikat':item.status==='saved'?'Tersimpan':item.status==='queued'?'Antrean sinkronisasi':item.status==='failed'?'Gagal':item.status==='partial'?'Tugas belum tersimpan':'Siap';return `<tr><td>${item.row}</td><td><strong>${esc(r.judul)}</strong><small>${esc(r.konten_pilar)} · ${esc(r.kategori_konten)}<br>Status: ${esc(r.status)}</small></td><td>${esc(r.tanggal)}<small>${esc(r.deadline)}</small></td><td>${r.jobdesk.map(t=>`${esc(t.petugas)}<small>${esc(t.jobdesk.join(', '))}</small>`).join('')||'Belum ditugaskan'}</td><td><span class="badge badge-${bad?'red':item.duplicate?'gray':item.status==='saved'?'green':'blue'}">${label}</span>${[...item.errors,...item.warnings,item.message].filter(Boolean).map(m=>`<small>${esc(m)}</small>`).join('')}</td></tr>`}).join('')||'<tr><td colspan="5">Pilih file untuk melihat pratinjau.</td></tr>'}</tbody></table></div>`;
  }
  function renderPreview(){
    const box=Utils.q('#briefImportPreview');if(!box)return;box.innerHTML=preview();const c=counts(),run=Utils.q('#runBriefImport');
    if(run){run.disabled=state.busy||!c.ready;run.textContent=state.busy?'Menyiapkan antrean…':`Impor ${c.ready} Brief`}
    const retry=Utils.q('#retryBriefImport');if(retry)retry.hidden=!state.items.some(x=>['failed','partial'].includes(x.status));
    const file=Utils.q('#briefImportFile');if(file)file.disabled=state.busy||state.items.some(x=>x.status==='queued');
  }
  function startMonitor(){clearInterval(monitor);monitor=setInterval(()=>{if(!Utils.q('#briefImportPreview')){clearInterval(monitor);return}if(owner()!==state.owner){clearInterval(monitor);Utils.closeModal();return}renderPreview()},1000)}
  async function loadFile(file){
    if(state.busy)return;const version=++readVersion;const who=owner();state.items=[];state.file=file?.name||'';state.submitted=false;const hint=Utils.q('#briefImportHint');
    if(hint)hint.textContent='Membaca dan memeriksa file…';renderPreview();
    try{const rows=await parseFile(file);if(version!==readVersion||who!==owner()||!Utils.q('#briefImportFile'))return;state.items=prepareRows(rows);hint.textContent=state.file+' — '+state.items.length+' baris. Hanya baris valid yang akan diimpor.'}
    catch(e){if(version!==readVersion||who!==owner())return;state.items=[];if(hint)hint.textContent=e.message;Utils.toast(e.message,'error')}
    finally{if(version===readVersion&&who===owner())renderPreview()}
  }
  async function run(){
    if(state.busy||!Auth.has('brief.create')||owner()!==state.owner)return;
    state.busy=true;renderPreview();
    try{
      // Refresh resignation status and duplicate input immediately before submitting.
      if(StaffRoster.canView())await StaffRoster.ensure({force:true});
      const existing=new Set((Store.briefs||[]).map(key));
      const candidates=state.items.filter(x=>!x.errors.length&&!x.duplicate&&x.status==='ready');
      const needed=candidates.filter(x=>!existing.has(key(x.record))).length;
      if(API.pendingSimpleCrud()+needed>180)throw new Error('Antrean hampir penuh. Tunggu sinkronisasi selesai atau kurangi jumlah baris impor.');
      for(const item of candidates){
        if(owner()!==state.owner||!Auth.has('brief.create'))throw new Error('Sesi berubah. Buka kembali impor setelah login.');
        if(existing.has(key(item.record))||Store.briefById(item.record.id)){item.duplicate=true;continue}
        if(item.record.jobdesk.some(t=>!Store.accountById(t.petugas_id)||!StaffRoster.isActive(Store.accountById(t.petugas_id)))){item.errors.push('Status petugas berubah atau sudah resign. Perbaiki file.');continue}
        const now=Utils.isoNow(),record={...item.record,created_by:Auth.session.user.nama,created_at:now,updated_at:now,archived:false,_request_id:Utils.id('REQIMP')};
        item.record=record;Store.mergeRows('briefs',[{...record,_sync_pending:true,_sync_error:''}]);
        let out;try{out=await API.simpleCrudWrite('saveBrief',{record,_request_id:record._request_id},{collection:'briefs',operation:'save',route:'briefs',id:record.id,current:record,silent_render:true,label:'Impor Brief baris '+item.row})}catch(e){out={queued:false,error:e.message}}
        if(!out?.queued){item.status='failed';item.message=out?.error||'Antrean tidak dapat disimpan.';Store.removeIds('briefs',[record.id]);break}
        item.status='queued';item.message='Menunggu konfirmasi server';existing.add(key(record));state.submitted=true;
      }
      Store.persistCache('briefs').catch(()=>{});if(location.hash==='#briefs')BriefModule.refreshImmediate();
      if(state.submitted)Utils.toast('Brief masuk antrean. Hasil penyimpanan diperbarui setelah konfirmasi server.','info');
    }catch(e){Utils.toast(e.message,'error');const hint=Utils.q('#briefImportHint');if(hint)hint.textContent=e.message}
    finally{state.busy=false;renderPreview();startMonitor()}
  }
  async function retryFailed(){
    if(state.busy||!Auth.has('brief.create')||owner()!==state.owner)return;
    state.busy=true;
    try{
      for(const item of state.items){
        if(item.status==='failed'){item.status='ready';item.message='';continue}
        if(item.status!=='partial')continue;
        const out=await API.simpleCrudWrite('syncBriefRelations',{record:item.record,sync_tasks:true},{route:'tasks',id:item.record.id,label:'Penugasan impor baris '+item.row});
        if(out?.queued){item.status='queued';item.message='Menunggu sinkronisasi tugas'}else item.message=out?.error||'Tugas belum dapat diantrekan';
      }
      state.submitted=state.items.some(x=>['queued','partial','saved'].includes(x.status));
    }finally{state.busy=false;renderPreview();startMonitor()}
  }
  function report(){
    const quote=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')+'"';
    syncStatuses();const rows=[['baris','judul','tanggal','status','keterangan'],...state.items.map(x=>[x.row,x.record.judul,x.record.tanggal,x.errors.length?'Perbaiki':x.duplicate?'Duplikat':({ready:'Siap',queued:'Menunggu sinkronisasi',saved:'Tersimpan',failed:'Gagal',partial:'Tugas belum tersimpan'})[x.status],[...x.errors,...x.warnings,x.message].filter(Boolean).join('; ')])];
    Utils.download('Hasil_Impor_Brief.csv','\uFEFF'+rows.map(r=>r.map(quote).join(',')).join('\r\n'),'text/csv;charset=utf-8');
  }
  async function open(){
    if(!Auth.has('brief.create'))return Utils.toast('Anda tidak memiliki akses menambah brief.','error');
    const who=owner();++readVersion;
    try{await ReferenceManager.ensure();if(StaffRoster.canView())await StaffRoster.ensure();if(!Store.isModuleReady('briefs'))throw new Error('Daftar brief masih dimuat. Tunggu hingga selesai sebelum mengimpor.')}
    catch(e){Utils.toast('Impor belum dapat dibuka: '+e.message,'error');return}
    if(owner()!==who)return;
    if(state.owner!==who)state={items:[],file:'',busy:false,submitted:false,owner:who};
    Utils.modal('Impor Brief dari Excel',`<div class="brief-import-intro"><div><strong>1. Isi template · 2. Periksa data · 3. Impor</strong><p>Maksimal 100 brief / 8 MB. Hanya sheet BRIEF yang diimpor. Status dan kategori konten mengikuti file Excel. Status kosong memakai Draft; Publish wajib memiliki link_konten.</p></div><a class="btn btn-soft" href="./templates/Template_Impor_Brief.xlsx?v=1.34.1" download="Template_Impor_Brief.xlsx">⇩ Unduh Template Excel</a></div><label class="brief-import-picker" for="briefImportFile">Pilih file Excel atau CSV<input class="input" id="briefImportFile" type="file" accept=".xlsx,.xls,.csv"></label><p class="file-note" id="briefImportHint" role="status">${esc(state.file||'Kolom wajib: tanggal, judul, detail_brief. Deadline kosong mengikuti tanggal tayang.')}</p><details class="brief-import-guide"><summary>Panduan petugas, jobdesk, dan pilihan yang tersedia</summary><p>Gunakan nama lengkap, username, atau ID petugas aktif. Pisahkan petugas dengan titik koma (;). Pisahkan jobdesk satu petugas dengan koma, lalu antarpetugas dengan titik koma. Tanpa petugas, kosongkan keduanya.</p><p><strong>Contoh:</strong> petugas: Fathurrohman; Fahmi Ilham Pahwana<br>jobdesk: Designer; Videografer, Editor</p><p><strong>Pilar:</strong> ${Config.pillars.map(esc).join(', ')}<br><strong>Kategori:</strong> ${Config.categories.map(esc).join(', ')}<br><strong>Status produksi:</strong> ${Config.briefStatuses.map(esc).join(', ')}<br><strong>Jobdesk:</strong> ${Config.jobs.map(esc).join(', ')}<br><strong>Audience:</strong> ${Config.audiences.map(esc).join(', ')}</p><p>Duplikat ditentukan dari tanggal tayang dan judul, termasuk data arsip. Baris valid tetap bisa diimpor saat baris lain bermasalah. Perbaiki baris bermasalah di Excel, lalu impor kembali.</p></details><div id="briefImportPreview"></div>`,`<button class="btn" data-close-modal>Tutup</button><button class="btn" id="briefImportReport">⇩ Hasil Pemeriksaan</button><button class="btn" id="retryBriefImport" hidden>Coba Ulang yang Gagal</button><button class="btn btn-primary" id="runBriefImport" disabled>Impor 0 Brief</button>`,'wide brief-import-modal');
    Utils.q('#briefImportFile').onchange=e=>loadFile(e.target.files?.[0]);Utils.q('#runBriefImport').onclick=run;Utils.q('#briefImportReport').onclick=report;
    Utils.q('#retryBriefImport').onclick=retryFailed;
    renderPreview();startMonitor();
  }
  window.addEventListener('mwg:crud-result',e=>{
    if(e.detail?.ok!==false||owner()!==state.owner)return;
    const item=state.items.find(x=>String(x.record.id)===String(e.detail.id));if(!item)return;
    item.status=e.detail.action==='syncBriefRelations'?'partial':'failed';item.message=String(e.detail.error||'Penyimpanan ditolak server.');renderPreview();
  });
  return {open,parseFile,tableRows,csvMatrix,dateValue,normalizeRow,prepareRows,stableId,COLUMNS,MAX_ROWS};
})();
