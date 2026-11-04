/* Staff availability and employment status. Uses the existing shared settings API. */
'use strict';
const StaffRoster = (() => {
  const KEY='staff_roster',DAYS=['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
  const object=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
  const cleanStatus=v=>v==='On'||v==='Siaga'||v==='Off'?v:'';
  let loadedFor='',loading=null,busy=false,error='',lastLoaded=0,staffFilter='',statusFilter='',viewCursor=null;
  const identity=()=>Auth.session?String(Config.data.apiUrl||'demo')+'|'+Auth.session.token:'';
  const canView=()=>Auth.has('settings.view');
  const canManage=()=>Auth.has('settings.edit');
  function validDate(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||'')))return false;
    const d=new Date(value+'T12:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;
  }
  function dateKeys(from,to=from){
    if(!validDate(from)||!validDate(to)||to<from)throw new Error('Rentang tanggal tidak valid.');
    const out=[],end=new Date(to+'T12:00:00Z'),d=new Date(from+'T12:00:00Z');
    for(;d<=end;d.setUTCDate(d.getUTCDate()+1)){if(out.length>=366)throw new Error('Maksimal 366 hari dalam sekali pengaturan.');out.push(d.toISOString().slice(0,10))}
    return out;
  }
  function normalize(raw){
    const v=object(typeof raw==='string'?Utils.parseJSON(raw,{}):raw);
    return {version:1,weekly:{...object(v.weekly)},overrides:{...object(v.overrides)},employment:{...object(v.employment)},updated_at:String(v.updated_at||''),write_id:String(v.write_id||'')};
  }
  const EMPLOYMENT_QUEUE='MWG_EMPLOYMENT_V134';
  let employmentJobs=null,employmentTimer=0,employmentWorker=false,activeEmployment='';
  const jobOwner=()=>Auth.session?String(Config.data.apiUrl||'demo')+'|'+String(Auth.session.user?.id||Auth.session.user?.username||''):'';
  function jobs(){
    if(employmentJobs)return employmentJobs;
    try{const saved=JSON.parse(localStorage.getItem(EMPLOYMENT_QUEUE)||'[]');employmentJobs=Array.isArray(saved)?saved.filter(x=>x&&x.id&&x.owner&&x.account_id&&['Aktif','Resign'].includes(x.status)):[]}catch{employmentJobs=[]}
    return employmentJobs;
  }
  function saveJobs(next){
    // A pending status must survive reload before it is shown in the directory.
    localStorage.setItem(EMPLOYMENT_QUEUE,JSON.stringify(next));employmentJobs=next;
  }
  function config(){const cfg=normalize(Store.systemSettings?.[KEY]);for(const job of jobs())if(job.owner===jobOwner())cfg.employment[String(job.account_id)]={status:job.status,resigned_at:job.resigned_at};return cfg}
  const employmentPending=id=>jobs().some(j=>j.owner===jobOwner()&&String(j.account_id)===String(id));
  function scheduleEmployment(delay=0){clearTimeout(employmentTimer);employmentTimer=setTimeout(()=>{employmentTimer=0;flushEmployment()},delay)}
  async function flushEmployment(){
    if(employmentWorker||!Auth.session||!navigator.onLine||!canManage()||!Auth.has('account.manage_permissions'))return;
    const job=jobs().find(j=>j.owner===jobOwner());if(!job)return;
    if(busy){scheduleEmployment(500);return}
    const who=jobOwner();employmentWorker=true;activeEmployment=job.id;
    try{
      await setEmployment(job.account_id,job.status,job.resigned_at);
      saveJobs(jobs().filter(x=>x.id!==job.id));
      if(jobOwner()===who)window.dispatchEvent(new CustomEvent('mwg:staff-roster'));
    }catch(e){
      const retry=!navigator.onLine||/timeout|koneksi|network|fetch|sesi|login|terverifikasi|sibuk|sebelumnya|dicoba ulang/i.test(String(e.message));
      if(retry){job.error=String(e.message);job.attempts=(job.attempts||0)+1;try{saveJobs(jobs())}catch{};scheduleEmployment(Math.min(30000,1500*Math.max(1,job.attempts)))}
      else{try{saveJobs(jobs().filter(x=>x.id!==job.id))}catch{};if(jobOwner()===who){window.dispatchEvent(new CustomEvent('mwg:staff-roster'));Utils.toast?.('Status staf belum tersimpan: '+e.message,'error')}}
    }finally{employmentWorker=false;activeEmployment='';if(!employmentTimer&&jobs().some(j=>j.owner===jobOwner()))scheduleEmployment(100)}
  }
  function queueEmployment(id,status,resigned_at=''){
    if(!canManage()||!Auth.has('account.manage_permissions'))throw new Error('Anda tidak memiliki akses mengubah status staf.');
    if(!['Aktif','Resign'].includes(status)||!Store.accounts.some(a=>String(a.id)===String(id)))throw new Error('Akun atau status staf tidak valid.');
    if(status==='Resign'&&!validDate(resigned_at))throw new Error('Tanggal resign wajib diisi.');
    const owner=jobOwner();if(!owner)throw new Error('Silakan masuk kembali.');
    const next=jobs().filter(j=>j.id===activeEmployment||j.owner!==owner||String(j.account_id)!==String(id));
    if(next.length>=100)throw new Error('Antrean status staf penuh. Tunggu sinkronisasi.');
    const job={id:Utils.id('EMP'),owner,account_id:String(id),status,resigned_at:status==='Resign'?resigned_at:'',created_at:Date.now()};
    try{saveJobs([...next,job])}catch{throw new Error('Antrean status staf tidak dapat disimpan. Periksa ruang penyimpanan browser.')}
    window.dispatchEvent(new CustomEvent('mwg:staff-roster'));scheduleEmployment();return {queued:true,id:job.id};
  }
  function employmentStatus(account,cfg=config()){
    const rec=object(cfg.employment[String(account?.id||'')]);
    const newer=!employmentPending(account?.id)&&account?.status_staf_updated_at&&String(account.status_staf_updated_at)>String(cfg.updated_at||'');
    const status=String(newer?account.status_staf:(rec.status||account?.status_staf||account?.status_kepegawaian||'Aktif')).trim().toLowerCase();
    return status==='resign'?'Resign':'Aktif';
  }
  function resignedAt(account,cfg=config()){
    const value=String(object(cfg.employment[String(account?.id||'')]).resigned_at||account?.tanggal_resign||'');
    return validDate(value)?value:'';
  }
  function isActive(account){return employmentStatus(account)==='Aktif'}
  function activeOn(account,date,cfg=config()){
    if(employmentStatus(account,cfg)!=='Resign')return true;
    const end=resignedAt(account,cfg);return !!end&&date<end;
  }
  function statusAt(account,date,cfg=config()){
    if(!validDate(date)||!activeOn(account,date,cfg))return {status:'Resign',source:'employment',start:'',end:'',note:''};
    const id=String(account.id),day=object(cfg.overrides[date]);
    if(own(day,id)&&cleanStatus(day[id]?.status)){
      const row=day[id],status=cleanStatus(row.status);
      return {status,source:'override',start:status!=='Off'?String(row.start||''):'',end:status!=='Off'?String(row.end||''):'',note:String(row.note||'')};
    }
    const weekday=new Date(date+'T12:00:00Z').getUTCDay();
    return {status:cleanStatus(cfg.weekly[id]?.[weekday]),source:'weekly',start:'',end:'',note:''};
  }
  const ready=()=>!!identity()&&loadedFor===identity();
  function publish(settings){
    Store.systemSettings={...(Store.systemSettings||{}),[KEY]:normalize(settings)};
    Store.persistCache?.().catch(()=>{});
    window.dispatchEvent(new CustomEvent('mwg:staff-roster'));
  }
  async function ensure({force=false}={}){
    if(!canView())throw new Error('Jadwal staf hanya tersedia untuk pengelola dengan akses melihat Pengaturan.');
    const who=identity();if(!who)throw new Error('Silakan masuk untuk melihat jadwal staf.');
    if(!force&&ready()&&Date.now()-lastLoaded<60000)return config();
    if(loading?.who===who)return loading.promise;
    error='';
    const work=(async()=>{
      try{
        const [,out]=await Promise.all([ReferenceManager.ensure({force}),API.call('getSystemSettings',{}, {skipQueue:true})]);
        if(identity()!==who)throw new Error('Sesi berubah. Buka kembali jadwal staf.');
        Store.systemSettings={...(Store.systemSettings||{}),...(out||{})};loadedFor=who;lastLoaded=Date.now();publish(out?.[KEY]);return config();
      }catch(e){if(identity()===who)error=String(e.message||e);throw e}
      finally{if(loading?.who===who)loading=null}
    })();
    loading={who,promise:work};return work;
  }
  function hasSnapshot(){return ready()||own(Store.systemSettings,KEY)}
  function pruneOptions(root=document){
    const retired=(Store.accounts||[]).filter(a=>!isActive(a)),ids=new Set(retired.map(a=>String(a.id))),names=new Set(retired.map(a=>String(a.nama||'').trim().toLowerCase()));
    root.querySelectorAll('select.team-person,select[name="petugas_id"],#briefPic,#taskPic,#kanbanPic,#rosterStaffFilter,#hotPicList').forEach(select=>{
      const chosen=select.value,isAssignment=select.matches('select.team-person,select[name="petugas_id"]');let removed=false;
      [...select.querySelectorAll('option')].forEach(option=>{if(ids.has(String(option.value))||names.has(String(option.value).trim().toLowerCase())){if(option.value===chosen)removed=true;option.remove()}});
      if(!removed||select.tagName==='DATALIST')return;
      if(!select.querySelector('option[value=""]')){const blank=document.createElement('option');blank.value='';blank.textContent=isAssignment?'Pilih petugas aktif':'Semua petugas';select.prepend(blank)}
      select.value='';
      if(isAssignment&&select.dataset.originalPersonId===chosen){select.dataset.retainedPersonId=chosen;select.dataset.retainedPersonName=select.dataset.originalPersonName||'';select.required=false;select.querySelector('option[value=""]').textContent='Pertahankan penugasan sebelumnya'}
    });
  }
  async function update(mutator){
    if(!canManage())throw new Error('Anda tidak memiliki akses mengubah pengaturan staf.');
    if(busy)throw new Error('Perubahan sebelumnya masih disimpan.');
    if(!navigator.onLine)throw new Error('Hubungkan internet untuk menyimpan jadwal bersama.');
    const who=identity();if(!who)throw new Error('Silakan masuk kembali.');
    busy=true;
    try{
      // Read immediately before writing so a form does not overwrite stale settings.
      const fresh=await API.call('getSystemSettings',{}, {skipQueue:true});
      if(identity()!==who)throw new Error('Sesi berubah. Silakan coba kembali.');
      const next=normalize(fresh?.[KEY]);mutator(next);
      next.updated_at=Utils.isoNow();next.write_id=Utils.id('RST');
      if(JSON.stringify(next).length>45000)throw new Error('Jadwal khusus terlalu besar. Gunakan pola mingguan untuk jadwal rutin atau kurangi rentang tanggal.');
      await API.call('saveSystemSettings',{key:KEY,settings:next},{skipQueue:true});
      const confirmed=await API.call('getSystemSettings',{}, {skipQueue:true});
      if(identity()!==who)throw new Error('Sesi berubah. Muat ulang untuk memeriksa hasil penyimpanan.');
      const saved=normalize(confirmed?.[KEY]);
      if(saved.write_id!==next.write_id)throw new Error('Penyimpanan pengaturan staf belum terverifikasi. Muat ulang jadwal sebelum mencoba lagi.');
      loadedFor=who;lastLoaded=Date.now();error='';publish(saved);return saved;
    }finally{busy=false}
  }
  function setEmployment(id,status,resigned_at=''){
    if(!Auth.has('account.manage_permissions'))return Promise.reject(new Error('Anda tidak memiliki akses mengubah status akun.'));
    if(!['Aktif','Resign'].includes(status)||!id||!Store.accounts.some(a=>String(a.id)===String(id)))return Promise.reject(new Error('Akun atau status staf tidak valid.'));
    if(status==='Resign'&&!validDate(resigned_at))return Promise.reject(new Error('Tanggal resign wajib diisi.'));
    return update(cfg=>{cfg.employment[String(id)]={status,resigned_at:status==='Resign'?resigned_at:''}});
  }
  function saveWeekly(changes,expected={}){
    return update(cfg=>{
      for(const [id,days] of Object.entries(changes)){
        if(!Store.accounts.some(a=>String(a.id)===id&&employmentStatus(a,cfg)==='Aktif'))throw new Error('Staf aktif tidak ditemukan. Muat ulang daftar staf.');
        if(!Array.isArray(days)||days.length!==7||days.some(x=>x!==''&&!cleanStatus(x)))throw new Error('Pola mingguan tidak valid.');
        const before=expected[id],current=Array.from({length:7},(_,i)=>cleanStatus(cfg.weekly[id]?.[i]));
        if(Array.isArray(before))days.forEach((value,i)=>{
          if(value===before[i])return;
          if(current[i]!==before[i])throw new Error('Pola staf ini sudah berubah di perangkat lain. Muat ulang sebelum menyimpan.');
          current[i]=value;
        });
        cfg.weekly[id]=Array.isArray(before)?current:days.slice();
      }
    });
  }
  function setOverrides({from,to,ids,status,start='',end='',note=''}){
    let dates;try{dates=dateKeys(from,to)}catch(e){return Promise.reject(e)}
    if(!Array.isArray(ids)||!ids.length||!['On','Siaga','Off','default'].includes(status))return Promise.reject(new Error('Pilih staf dan status jadwal.'));
    const time=v=>!v||/^([01]\d|2[0-3]):[0-5]\d$/.test(v);
    if(!time(start)||!time(end)||Boolean(start)!==Boolean(end))return Promise.reject(new Error('Isi jam mulai dan selesai dengan lengkap, atau kosongkan keduanya.'));
    if(note.length>160)return Promise.reject(new Error('Catatan maksimal 160 karakter.'));
    return update(cfg=>{
      ids.forEach(id=>{const a=Store.accounts.find(x=>String(x.id)===String(id));if(!a||dates.some(d=>!activeOn(a,d,cfg)))throw new Error('Rentang mencakup staf yang sudah resign. Sesuaikan tanggal atau staf.');});
      dates.forEach(date=>{
        const rows={...object(cfg.overrides[date])};
        ids.forEach(id=>{if(status==='default')delete rows[String(id)];else{const row={status};if(status!=='Off'&&start){row.start=start;row.end=end}if(note.trim())row.note=note.trim();rows[String(id)]=row}});
        if(Object.keys(rows).length)cfg.overrides[date]=rows;else delete cfg.overrides[date];
      });
    });
  }
  function accounts(){return (Store.accounts||[]).filter(a=>a&&a.id&&String(a.nama||'').trim()).slice().sort((a,b)=>a.nama.localeCompare(b.nama,'id-ID'))}
  const esc=value=>Utils.esc(String(value??''));
  const statusClass=status=>status==='On'?'on':status==='Siaga'?'siaga':status==='Off'?'off':'unset';
  const badge=status=>`<span class="badge roster-status ${statusClass(status)}">${esc(status||'Belum diatur')}</span>`;
  function headerActions(){return `${canManage()?'<button class="btn" type="button" data-roster-weekly>⚙ Pola Mingguan</button><button class="btn btn-primary" type="button" data-roster-override>＋ Atur Tanggal</button>':''}<button class="btn" type="button" data-roster-reload>↻ Muat Ulang</button>`}
  function range(cursor){const y=cursor.getFullYear(),m=cursor.getMonth(),first=new Date(y,m,1),start=new Date(y,m,1-first.getDay());return Array.from({length:42},(_,i)=>{const d=new Date(start);d.setDate(start.getDate()+i);return {key:Utils.dateKey(d),day:d.getDate(),outside:d.getMonth()!==m}})}
  function render(cursor=viewCursor){
    if(cursor)viewCursor=new Date(cursor);
    const root=Utils.q('#rosterView');if(!root||!viewCursor)return;
    bindHeader();
    if(!ready()){
      root.innerHTML=`<div class="empty" role="status">${error?`<strong>Jadwal staf belum dapat dimuat.</strong><p>${esc(error)}</p><button class="btn" data-roster-retry>Coba Lagi</button>`:'<div class="skeleton" style="height:100px"></div><p>Memuat jadwal dan status staf…</p>'}</div>`;
      root.querySelector('[data-roster-retry]')?.addEventListener('click',()=>loadView(true));return;
    }
    const cfg=config(),all=accounts(),active=all.filter(isActive);if(staffFilter&&!active.some(a=>String(a.id)===staffFilter))staffFilter='';const rows=all.filter(a=>!staffFilter||String(a.id)===staffFilter);
    const days=range(viewCursor),current=Utils.today(),todayRows=rows.filter(a=>activeOn(a,current,cfg)).map(a=>({a,s:statusAt(a,current,cfg)}));
    const count=status=>todayRows.filter(x=>x.s.status===status).length;
    const cells=days.map(d=>{
      const eligible=rows.filter(a=>activeOn(a,d.key,cfg)).map(a=>({a,s:statusAt(a,d.key,cfg)})),groups=['On','Siaga','Off',''].filter(s=>!statusFilter||s===statusFilter);
      return `<button type="button" class="roster-day ${d.outside?'outside':''} ${d.key===current?'today':''}" data-roster-day="${d.key}" aria-label="Jadwal staf ${d.key}"><span class="roster-date"><span>${d.day}</span><small>${esc(new Date(d.key+'T12:00:00Z').toLocaleDateString('id-ID',{weekday:'short',timeZone:'UTC'}))}</small></span>${groups.map(status=>{const list=eligible.filter(x=>x.s.status===status);if(!list.length)return '';return `<span class="roster-group ${statusClass(status)}"><strong>${status||'Belum diatur'} <b>${list.length}</b></strong><span>${list.slice(0,3).map(x=>esc(x.a.nama)).join(', ')}${list.length>3?` +${list.length-3}`:''}</span></span>`}).join('')||'<span class="roster-no-staff">Tidak ada staf pada filter ini</span>'}</button>`;
    }).join('');
    root.innerHTML=`<div class="roster-toolbar"><div><strong>Jadwal Staf</strong><p>Pola mingguan dapat diganti khusus untuk tanggal tertentu.</p></div><div class="roster-filters"><label>Staf<select class="select" id="rosterStaffFilter"><option value="">Semua staf</option>${active.map(a=>`<option value="${esc(a.id)}" ${String(a.id)===staffFilter?'selected':''}>${esc(a.nama)}${isActive(a)?'':' • Resign'}</option>`).join('')}</select></label><label>Status<select class="select" id="rosterStatusFilter"><option value="">Semua status</option><option ${statusFilter==='On'?'selected':''}>On</option><option ${statusFilter==='Siaga'?'selected':''}>Siaga</option><option ${statusFilter==='Off'?'selected':''}>Off</option></select></label></div></div><div class="roster-summary" aria-label="Ringkasan hari ini"><span class="roster-status on"><b>${count('On')}</b> On hari ini</span><span class="roster-status siaga"><b>${count('Siaga')}</b> Siaga hari ini</span><span class="roster-status off"><b>${count('Off')}</b> Off hari ini</span><span><b>${count('')}</b> Belum diatur</span></div>${error?`<div class="roster-warning" role="alert">${esc(error)}</div>`:''}${!all.length?'<div class="empty">Belum ada akun staf. Tambahkan staf melalui menu Akun.</div>':`<div class="calendar-week roster-week">${['Min','Sen','Sel','Rab','Kam','Jum','Sab'].map(d=>`<div>${d}</div>`).join('')}</div><div class="roster-grid">${cells}</div>`}<div class="roster-help">Klik tanggal untuk melihat seluruh staf, jam kerja / siaga, dan catatan.${canManage()?' Gunakan Pola Mingguan untuk jadwal rutin atau Atur Tanggal untuk perubahan khusus.':''}</div>`;
    root.querySelector('#rosterStaffFilter').onchange=e=>{staffFilter=e.target.value;render()};
    root.querySelector('#rosterStatusFilter').onchange=e=>{statusFilter=e.target.value;render()};
    root.querySelectorAll('[data-roster-day]').forEach(b=>b.onclick=()=>openDay(b.dataset.rosterDay));
  }
  async function loadView(force=false){
    const work=ensure({force});render();try{await work}catch{}render();
  }
  function bindHeader(){
    Utils.qa('[data-roster-weekly]').forEach(b=>b.onclick=openWeekly);
    Utils.qa('[data-roster-override]').forEach(b=>b.onclick=()=>openOverride(Utils.today()));
    Utils.qa('[data-roster-reload]').forEach(b=>b.onclick=()=>loadView(true));
  }
  async function formReady(){
    if(!canManage()){Utils.toast('Anda tidak memiliki akses mengubah jadwal staf.','error');return false}
    try{await ensure();return true}catch(e){Utils.toast(e.message,'error');return false}
  }
  async function submit(button,work){
    if(button.disabled)return;button.disabled=true;const old=button.textContent;button.textContent='Menyimpan…';
    try{await work();Utils.closeModal();render();Utils.toast('Pengaturan staf tersimpan dan terverifikasi.','success')}
    catch(e){Utils.toast(e.message,'error');const feedback=Utils.q('#rosterFormError');if(feedback){feedback.hidden=false;feedback.textContent=e.message}}
    finally{button.disabled=false;button.textContent=old}
  }
  async function openWeekly(){
    if(!await formReady())return;
    const rows=accounts().filter(isActive),cfg=config();
    Utils.modal('Pola Mingguan Staf',`<form id="rosterWeeklyForm"><p class="roster-form-note">Atur On / Siaga / Off untuk setiap hari. Pilihan “—” berarti belum diatur. Jadwal khusus tanggal tetap berlaku.</p><div class="roster-table-scroll"><table class="roster-weekly-table"><thead><tr><th>Staf</th>${DAYS.map(d=>`<th>${d.slice(0,3)}</th>`).join('')}</tr></thead><tbody>${rows.map(a=>`<tr><th scope="row">${esc(a.nama)}</th>${DAYS.map((day,i)=>{const val=cleanStatus(cfg.weekly[String(a.id)]?.[i]);return `<td><select class="select" data-roster-person="${esc(a.id)}" data-roster-weekday="${i}" aria-label="${esc(a.nama)} ${day}"><option value="">—</option>${['On','Siaga','Off'].map(s=>`<option ${val===s?'selected':''}>${s}</option>`).join('')}</select></td>`}).join('')}</tr>`).join('')||'<tr><td colspan="8">Belum ada staf aktif.</td></tr>'}</tbody></table></div><p id="rosterFormError" class="roster-warning" role="alert" hidden></p></form>`,`<button class="btn" data-close-modal>Batal</button><button class="btn btn-primary" id="saveRosterWeekly" ${rows.length?'':'disabled'}>Simpan Pola</button>`,'wide');
    Utils.q('#saveRosterWeekly').onclick=()=>{
      const changes={},expected={};Utils.qa('[data-roster-weekday]').forEach(el=>{const id=el.dataset.rosterPerson;changes[id]=changes[id]||Array(7).fill('');changes[id][Number(el.dataset.rosterWeekday)]=el.value});
      Object.keys(changes).forEach(id=>{expected[id]=Array.from({length:7},(_,i)=>cleanStatus(cfg.weekly[id]?.[i]));if(changes[id].every((s,i)=>s===expected[id][i]))delete changes[id]});
      if(!Object.keys(changes).length){Utils.closeModal();Utils.toast('Tidak ada perubahan pola mingguan.','info');return}
      submit(Utils.q('#saveRosterWeekly'),()=>saveWeekly(changes,expected));
    };
  }
  function openDay(date){
    if(!ready())return;
    const cfg=config(),rows=accounts().filter(a=>(!staffFilter||String(a.id)===staffFilter)&&activeOn(a,date,cfg));
    Utils.modal('Jadwal Staf • '+Utils.formatDate(date),`<div class="roster-day-list">${rows.map(a=>{const s=statusAt(a,date,cfg);return `<div class="roster-person"><div class="avatar">${esc(Utils.initials(a.nama))}</div><div class="roster-person-copy"><strong>${esc(a.nama)}</strong><small>${s.source==='override'?'Jadwal khusus':'Pola mingguan'}${s.start?` • ${esc(s.start)}–${esc(s.end)} WIB${s.end<s.start?' (+1 hari)':''}`:''}</small>${s.note?`<p>${esc(s.note)}</p>`:''}</div>${badge(s.status)}${canManage()?`<button class="btn btn-sm" data-roster-edit-person="${esc(a.id)}">Ubah</button>`:''}</div>`}).join('')||'<div class="empty">Tidak ada staf aktif pada tanggal ini.</div>'}</div>`,`<button class="btn" data-close-modal>Tutup</button>${canManage()?'<button class="btn btn-primary" id="editRosterDay">Atur Tanggal Ini</button>':''}`,'wide');
    Utils.qa('[data-roster-edit-person]').forEach(b=>b.onclick=()=>openOverride(date,b.dataset.rosterEditPerson));
    Utils.q('#editRosterDay')?.addEventListener('click',()=>openOverride(date));
  }
  async function openOverride(date,id=''){
    if(!await formReady())return;
    const rows=accounts().filter(a=>isActive(a)&&activeOn(a,date)),current=id?statusAt(Store.accountById(id)||{id},date):null;
    Utils.modal('Atur On / Siaga / Off',`<form id="rosterOverrideForm"><div class="form-grid"><div class="form-group"><label>Dari Tanggal</label><input class="input" type="date" name="from" required value="${esc(date)}"></div><div class="form-group"><label>Sampai Tanggal</label><input class="input" type="date" name="to" required value="${esc(date)}"></div><div class="form-group full"><label>Staf</label><label class="roster-select-all"><input type="checkbox" id="rosterSelectAll"> Pilih semua staf dalam daftar</label><div class="roster-staff-checks">${rows.map(a=>`<label class="check"><input type="checkbox" name="staff" value="${esc(a.id)}" ${String(a.id)===id||(!id&&String(a.id)===staffFilter)?'checked':''}>${esc(a.nama)}</label>`).join('')||'<span>Belum ada staf pada tanggal ini.</span>'}</div></div><div class="form-group full"><label>Status</label><select class="select" name="status" id="rosterOverrideStatus"><option value="On" ${current?.status==='On'?'selected':''}>On</option><option value="Siaga" ${current?.status==='Siaga'||!current?.status?'selected':''}>Siaga</option><option value="Off" ${current?.status==='Off'?'selected':''}>Off</option><option value="default">Ikuti Pola Mingguan (hapus perubahan khusus)</option></select></div><div class="form-group"><label>Jam Mulai (opsional, WIB)</label><input class="input" type="time" name="start" value="${esc(current?.start||'')}"></div><div class="form-group"><label>Jam Selesai (opsional, WIB)</label><input class="input" type="time" name="end" value="${esc(current?.end||'')}"></div><div class="form-group full"><label>Catatan (opsional)</label><input class="input" name="note" maxlength="160" placeholder="Misalnya: siaga live / libur pengganti" value="${esc(current?.note||'')}"><div class="file-note">Jam selesai yang lebih awal berarti berakhir pada hari berikutnya. Maksimal 366 hari per penyimpanan.</div></div></div><p id="rosterFormError" class="roster-warning" role="alert" hidden></p></form>`,`<button class="btn" data-close-modal>Batal</button><button class="btn btn-primary" id="saveRosterOverride">Simpan Jadwal</button>`,'wide');
    const form=Utils.q('#rosterOverrideForm'),status=form.elements.status;
    const sync=()=>{form.elements.start.disabled=!['On','Siaga'].includes(status.value);form.elements.end.disabled=!['On','Siaga'].includes(status.value);form.elements.note.disabled=status.value==='default'};
    status.onchange=sync;sync();Utils.q('#rosterSelectAll').onchange=e=>Utils.qa('input[name="staff"]',form).forEach(c=>c.checked=e.target.checked);
    Utils.q('#saveRosterOverride').onclick=()=>{if(!form.reportValidity())return;const d=Utils.formData(form);d.ids=Utils.qa('input[name="staff"]:checked',form).map(c=>c.value);d.start=d.start||'';d.end=d.end||'';d.note=d.note||'';submit(Utils.q('#saveRosterOverride'),()=>setOverrides(d))};
  }
  window.addEventListener('mwg:references-ready',()=>{pruneOptions();scheduleEmployment();if(Utils.q('#rosterView')&&ready())render()});
  window.addEventListener('mwg:staff-roster',()=>{pruneOptions();if(Utils.q('#rosterView'))render()});
  window.addEventListener('online',()=>scheduleEmployment());
  return {ensure,ready,hasSnapshot,pruneOptions,employmentPending,queueEmployment,flushEmployment,employmentStatus,resignedAt,isActive,activeOn,statusAt,dateKeys,canView,canManage,setEmployment,saveWeekly,setOverrides,headerActions,render,loadView};
})();
