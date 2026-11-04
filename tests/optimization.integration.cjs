'use strict';
const assert=require('node:assert/strict');
const {loadApp}=require('./helpers/load-app.cjs');
(async()=>{
 const {dom,w,d,q,qa,click,t,wait,errors}=await loadApp('accounts');
 const staff=t.Store.accounts.find(a=>a.role==='STAF'),id=staff.id,name=staff.nama,oldTask=t.Store.tasks.find(x=>x.petugas_id===id||x.petugas===name);assert.ok(oldTask);
 let confirms=0;w.confirm=()=>{confirms++;return true};let accountWrites=0;const write=t.API.simpleCrudWrite;t.API.simpleCrudWrite=(action,...args)=>{if(action==='saveAccount')accountWrites++;return write(action,...args)};
 await t.AdminModule.accountForm(staff);q('#staffEmploymentStatus').value='Resign';q('#staffEmploymentStatus').dispatchEvent(new w.Event('change'));q('#accountForm [name=resigned_at]').value='2026-11-04';
 const started=w.performance.now();click('#saveAccount');await Promise.resolve();assert.equal(q('#accountForm'),null);const accountMs=w.performance.now()-started;
 assert.equal(confirms,0);assert.equal(accountWrites,0);assert.equal(t.StaffRoster.isActive(staff),false);assert.equal(t.Store.accountOptions(id).some(a=>a.id===id),false);assert.equal(t.Store.staffNames().includes(name),false);
 assert.ok(JSON.parse(w.localStorage.getItem('MWG_EMPLOYMENT_V134')).some(x=>x.account_id===id));
 await wait(()=>!t.StaffRoster.employmentPending(id),'verified employment');
 assert.equal(t.LocalDB.load().systemSettings.staff_roster.employment[id].status,'Resign');
 // All filters and assignment controls exclude the retired account.
 for(const route of ['briefs','tasks','kanban','calendar']){
   t.App.navigate(route);if(route==='calendar'){click('[data-cal-mode=roster]');await wait(()=>q('#rosterStaffFilter'));}
   assert.equal(qa('#briefPic option,#taskPic option,#kanbanPic option,#rosterStaffFilter option').some(o=>o.value===id||o.value===name),false,route);
 }
 await t.TaskModule.openForm(oldTask);assert.equal(qa('#taskForm [name=petugas_id] option').some(o=>o.value===id),false);assert.equal(q('#taskForm [name=petugas_id]').value,'');assert.ok(q('#taskForm').textContent.includes(name));
 const newTitle='Riwayat penugasan tetap';q('#taskForm [name=judul_tugas]').value=newTitle;click('#saveTask');await wait(()=>!q('#taskForm'));await wait(()=>t.LocalDB.load().tasks.some(x=>x.id===oldTask.id&&x.judul_tugas===newTitle));
 assert.equal(t.Store.taskById(oldTask.id).petugas_id,id);assert.equal(t.Store.taskById(oldTask.id).petugas,name);
 const oldBrief=t.Store.briefs.find(b=>(b.jobdesk||[]).some(a=>a.petugas_id===id||a.petugas===name));assert.ok(oldBrief);
 await t.BriefModule.openForm(oldBrief);assert.equal(qa('.team-person option').some(o=>o.value===id),false);assert.ok(qa('.team-person').some(s=>s.dataset.retainedPersonId===id));click('.modal-overlay [data-close-modal]');
 // A warm editor must not wait for a slow background refresh of status.
 const originalCall=t.API.call;let release;const held=new Promise(r=>release=r);
 t.Config.data.apiUrl='https://script.google.com/macros/s/TEST_ONLY/exec';
 t.API.call=(action,...args)=>action==='getSystemSettings'?held:originalCall(action,...args);
 let opened=false;const openAt=w.performance.now();const opening=t.BriefModule.openForm().then(()=>opened=true);await Promise.resolve();await Promise.resolve();await Promise.resolve();assert.ok(q('#briefForm'));assert.equal(opened,true);const editorMs=w.performance.now()-openAt;
 release(t.Store.systemSettings);await opening;t.API.call=originalCall;t.Config.data.apiUrl='';click('.modal-overlay [data-close-modal]');
 // Large unrelated task indexes must remain intact when one brief changes.
 const taskIndex=t.Store._taskMap,groups=t.Store._tasksByBrief,accounts=t.Store._accountMap;
 const sample=t.Store.briefs[0];t.Store.mergeRows('briefs',[{...sample,judul:sample.judul+' v2'}]);
 assert.equal(t.Store._taskMap,taskIndex);assert.equal(t.Store._tasksByBrief,groups);assert.equal(t.Store._accountMap,accounts);assert.ok(t.Store.briefById(sample.id).judul.endsWith(' v2'));
 // Queue acceptance is immediate and durable while the network is offline.
 Object.defineProperty(w.navigator,'onLine',{configurable:true,value:false});t.Config.data.apiUrl='https://script.google.com/macros/s/OFFLINE_TEST/exec';
 await t.BriefModule.openForm();q('#briefForm [name=judul]').value='Instant offline brief';q('#briefForm [name=detail_brief]').value='Arahan produksi';q('.team-person').value=t.Store.accountOptions()[0].id;q('.team-jobs').value='Editor';
 const saveAt=w.performance.now();click('#saveBrief');await wait(()=>!q('#briefForm'));const briefMs=w.performance.now()-saveAt;
 const local=t.Store.briefs.find(b=>b.judul==='Instant offline brief');assert.ok(local?._sync_pending);assert.equal(t.API.pendingSimpleCrud(),1,'one main job; relation waits for its receipt');
 const queue=JSON.parse(w.localStorage.getItem('MWG_SIMPLE_CRUD_V1110'));assert.equal(queue.length,1);assert.equal(queue[0].payload.record.id,local.id);
 // Identical in-flight reads share one transport and still return their result to both callers.
 Object.defineProperty(w.navigator,'onLine',{configurable:true,value:true});
 const append=d.head.appendChild.bind(d.head);let readRequests=0;
 d.head.appendChild=element=>{if(element.tagName==='SCRIPT'&&element.src.includes('action=getBriefDetail')){readRequests++;const url=new w.URL(element.src),cb=url.searchParams.get('callback');w.setTimeout(()=>w[cb]({ok:true,data:{id:'READ-TEST'}}),0);return element}return append(element)};
 const paired=await Promise.all([t.API.call('getBriefDetail',{id:'READ-TEST'},{skipQueue:true}),t.API.call('getBriefDetail',{id:'READ-TEST'},{skipQueue:true})]);assert.equal(readRequests,1);assert.equal(paired[0].id,'READ-TEST');assert.equal(paired[1].id,'READ-TEST');d.head.appendChild=append;
 // Directory projection also works for an analyst without settings.view.
 t.Auth.set({token:'ANALYST_TEST',user:{id:'ACC-002',nama:'Analis',role:'ANALIS'}});t.Store.systemSettings={};t.Store.accounts=[{id:'R',nama:'Resign',role:'STAF',status_staf:'Resign'},{id:'A',nama:'Aktif',role:'STAF',status_staf:'Aktif'}];t.Store.rebuildIndexes('accounts');assert.deepEqual(Array.from(t.Store.accountOptions(),a=>a.id),['A']);
 assert.deepEqual(errors,[]);dom.window.close();console.log(JSON.stringify({passed:true,checks:['instant status without redundant account write','durable resignation and verified save','all selectors','task history preservation','brief history preservation','editor independent of slow reads','targeted indexes','durable offline CRUD','shared read transport','analyst directory status'],timings_ms:{status_click:Math.round(accountMs),warm_editor:Math.round(editorMs),offline_brief:Math.round(briefMs)},runtimeErrors:errors}));
})().catch(e=>{console.error(e);process.exit(1)});
