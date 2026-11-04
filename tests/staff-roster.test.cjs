'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','staff-roster.js'),'utf8');
const clone=v=>JSON.parse(JSON.stringify(v));
function fixture({settings={},permissions=['*'],confirm=true,storage=new Map()}={}){
  let stored=clone(settings),writes=0,sequence=0;
  const events=[];
  const accounts=[{id:'A',nama:'Staf A'},{id:'B',nama:'Staf B'}];
  const context={
    Store:{accounts,systemSettings:clone(settings),persistCache:()=>Promise.resolve()},
    Auth:{session:{token:'test-session',user:{id:'ADMIN'}},has:p=>permissions.includes('*')||permissions.includes(p)},
    Config:{data:{apiUrl:'test-endpoint'}},ReferenceManager:{ensure:async()=>true},
    navigator:{onLine:true},
    setTimeout:()=>1,clearTimeout:()=>{},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    Utils:{parseJSON:(s,f)=>{try{return JSON.parse(s)}catch{return f}},isoNow:()=>new Date().toISOString(),id:()=>`WRITE-${++sequence}`,q:()=>null},
    window:{addEventListener:()=>{},dispatchEvent:e=>events.push(e.type)},CustomEvent:class{constructor(type){this.type=type}},
    API:{call:async(action,payload)=>{
      if(action==='getSystemSettings')return clone(stored);
      if(action==='saveSystemSettings'){writes++;if(confirm)stored[payload.key]=clone(payload.settings);return payload.settings}
      throw new Error('Unexpected action '+action);
    }}
  };
  const roster=vm.runInNewContext(source+'\nStaffRoster;',context);
  return {roster,context,accounts,storage,get stored(){return stored},get writes(){return writes},events};
}
test('legacy accounts default to active and unconfigured, never invent a shift',()=>{
  const {roster,accounts}=fixture();
  assert.equal(roster.employmentStatus(accounts[0]),'Aktif');
  assert.equal(roster.statusAt(accounts[0],'2026-11-04').status,'');
});
test('weekly patterns use calendar weekdays without a UTC date shift',()=>{
  const {roster,accounts}=fixture({settings:{staff_roster:{weekly:{A:['Off','Siaga','','','','','']}}}});
  assert.equal(roster.statusAt(accounts[0],'2026-11-01').status,'Off');
  assert.equal(roster.statusAt(accounts[0],'2026-11-02').status,'Siaga');
});
test('On is retained in weekly schedules and persisted date overrides with working hours',async()=>{
  const f=fixture();await f.roster.saveWeekly({A:Array(7).fill('On')});
  assert.equal(f.roster.statusAt(f.accounts[0],'2026-11-04').status,'On');
  await f.roster.setOverrides({from:'2026-11-04',to:'2026-11-04',ids:['A'],status:'On',start:'08:00',end:'16:00'});
  assert.equal(f.roster.statusAt(f.accounts[0],'2026-11-04').start,'08:00');
  await f.roster.ensure({force:true});assert.equal(f.roster.statusAt(f.accounts[0],'2026-11-04').status,'On');
});
test('date exceptions override the weekly pattern and preserve overnight times',()=>{
  const {roster,accounts}=fixture({settings:{staff_roster:{weekly:{A:Array(7).fill('Off')},overrides:{'2026-11-04':{A:{status:'Siaga',start:'22:00',end:'06:00',note:'Live malam'}}}}}});
  const row=roster.statusAt(accounts[0],'2026-11-04');
  assert.equal(row.source,'override');assert.equal(row.status,'Siaga');assert.equal(row.end,'06:00');assert.equal(row.note,'Live malam');
  assert.equal(roster.statusAt(accounts[0],'2026-11-05').status,'Off');
});
test('resignation excludes current assignments but retains the historical roster',async()=>{
  const f=fixture({settings:{staff_roster:{weekly:{A:Array(7).fill('Siaga')}}}});
  await f.roster.setEmployment('A','Resign','2026-11-04');
  assert.equal(f.roster.isActive(f.accounts[0]),false);
  assert.equal(f.roster.statusAt(f.accounts[0],'2026-11-03').status,'Siaga');
  assert.equal(f.roster.statusAt(f.accounts[0],'2026-11-04').status,'Resign');
  await f.roster.setEmployment('A','Aktif');
  assert.equal(f.roster.statusAt(f.accounts[0],'2026-11-04').status,'Siaga');
});
test('range changes merge with fresh settings and do not erase other staff or settings',async()=>{
  const f=fixture({settings:{unrelated:{preserve:true},staff_roster:{overrides:{'2026-11-04':{B:{status:'Off'}}}}}});
  await f.roster.setOverrides({from:'2026-11-04',to:'2026-11-06',ids:['A'],status:'Siaga',start:'08:00',end:'16:00'});
  const cfg=f.stored.staff_roster;
  assert.equal(cfg.overrides['2026-11-04'].B.status,'Off');
  assert.equal(cfg.overrides['2026-11-06'].A.start,'08:00');
  assert.equal(f.stored.unrelated.preserve,true);assert.equal(f.writes,1);
});
test('reset to weekly removes the exception without deleting other staff',async()=>{
  const f=fixture({settings:{staff_roster:{weekly:{A:Array(7).fill('Off')},overrides:{'2026-11-04':{A:{status:'Siaga'},B:{status:'Off'}}}}}});
  await f.roster.setOverrides({from:'2026-11-04',to:'2026-11-04',ids:['A'],status:'default'});
  assert.equal(f.roster.statusAt(f.accounts[0],'2026-11-04').status,'Off');
  assert.equal(f.stored.staff_roster.overrides['2026-11-04'].B.status,'Off');
});
test('date ranges validate real dates, leap days, order, and maximum length',()=>{
  const {roster}=fixture();
  assert.equal(roster.dateKeys('2028-02-28','2028-03-01').length,3);
  for(const [a,b] of [['2026-02-29','2026-03-01'],['2026-11-05','2026-11-04'],['2026-01-01','2027-01-02']])assert.throws(()=>roster.dateKeys(a,b));
});
test('invalid times and missing staff never submit a mutation',async()=>{
  const f=fixture();
  for(const patch of [{ids:[]},{start:'08:00',end:''},{start:'25:00',end:'16:00'},{status:'Unknown'}]){
    await assert.rejects(f.roster.setOverrides({from:'2026-11-04',to:'2026-11-04',ids:['A'],status:'Siaga',...patch}));
  }
  assert.equal(f.writes,0);
});
test('a range crossing a resignation date is rejected',async()=>{
  const f=fixture({settings:{staff_roster:{employment:{A:{status:'Resign',resigned_at:'2026-11-05'}}}}});
  await assert.rejects(f.roster.setOverrides({from:'2026-11-04',to:'2026-11-06',ids:['A'],status:'Off'}),/resign/);
  assert.equal(f.writes,0);
});
test('read-only staff cannot change schedules or employment status',async()=>{
  const f=fixture({permissions:['calendar.view']});
  await assert.rejects(f.roster.saveWeekly({A:Array(7).fill('Siaga')}),/akses/);
  await assert.rejects(f.roster.setEmployment('A','Resign','2026-11-04'),/akses/);
  assert.equal(f.writes,0);
});
test('unconfirmed persistence cannot produce a local success or erase the old schedule',async()=>{
  const f=fixture({confirm:false,settings:{staff_roster:{weekly:{A:Array(7).fill('Off')}}}});
  await assert.rejects(f.roster.saveWeekly({A:Array(7).fill('Siaga')}),/belum terverifikasi/);
  assert.equal(f.roster.statusAt(f.accounts[0],'2026-11-04').status,'Off');
  assert.equal(f.events.includes('mwg:staff-roster'),false);
});
test('offline changes fail explicitly and do not report shared persistence',async()=>{
  const f=fixture();f.context.navigator.onLine=false;
  await assert.rejects(f.roster.saveWeekly({A:Array(7).fill('Off')}),/internet/);
  assert.equal(f.writes,0);
});
test('loading settings and then opening another device reads the confirmed shared state',async()=>{
  const f=fixture();await f.roster.saveWeekly({A:Array(7).fill('Siaga')});
  const other=fixture({settings:f.stored});await other.roster.ensure();
  assert.equal(other.roster.ready(),true);assert.equal(other.roster.statusAt(other.accounts[0],'2026-11-04').status,'Siaga');
});
test('weekly edits preserve another operator\'s changes on untouched weekdays',async()=>{
  const f=fixture({settings:{staff_roster:{weekly:{A:['Off','Siaga','','','','','']}}}});
  await f.roster.saveWeekly({A:['','','Siaga','','','','']},{A:['','','','','','','']});
  assert.equal(f.stored.staff_roster.weekly.A[0],'Off');assert.equal(f.stored.staff_roster.weekly.A[1],'Siaga');assert.equal(f.stored.staff_roster.weekly.A[2],'Siaga');
});
test('conflicting edits to the same weekday are rejected without overwriting',async()=>{
  const f=fixture({settings:{staff_roster:{weekly:{A:['Off','','','','','','']}}}});
  await assert.rejects(f.roster.saveWeekly({A:['Siaga','','','','','','']},{A:['','','','','','','']}),/perangkat lain/);
  assert.equal(f.writes,0);
});
test('a roster above the sheet cell limit is rejected before sending',async()=>{
  const f=fixture({settings:{staff_roster:{overrides:{'2026-11-03':{A:{status:'Off',note:'x'.repeat(45000)}}}}}});
  await assert.rejects(f.roster.saveWeekly({A:Array(7).fill('Off')}),/terlalu besar/);assert.equal(f.writes,0);
});
test('staff without settings access cannot request the shared settings payload',async()=>{
  const f=fixture({permissions:['calendar.view']});
  assert.equal(f.roster.canView(),false);await assert.rejects(f.roster.ensure(),/pengelola/);assert.equal(f.roster.ready(),false);
});
test('resignation is visible immediately only after a durable status job is stored',async()=>{
  const f=fixture();f.roster.queueEmployment('A','Resign','2026-11-04');
  assert.equal(f.roster.isActive(f.accounts[0]),false);assert.equal(f.roster.employmentPending('A'),true);assert.equal(f.writes,0);
  assert.equal(JSON.parse(f.storage.get('MWG_EMPLOYMENT_V134'))[0].account_id,'A');
  await f.roster.flushEmployment();assert.equal(f.writes,1);assert.equal(f.roster.employmentPending('A'),false);assert.equal(f.stored.staff_roster.employment.A.status,'Resign');
});
test('status outbox survives reload and resumes with the same account intent',async()=>{
  const f=fixture();f.roster.queueEmployment('A','Resign','2026-11-04');
  const other=fixture({storage:f.storage});assert.equal(other.roster.isActive(other.accounts[0]),false);
  await other.roster.flushEmployment();assert.equal(other.roster.employmentPending('A'),false);assert.equal(other.writes,1);
});
test('storage failure never publishes an unpersisted resignation',()=>{
  const f=fixture();f.context.localStorage.setItem=()=>{throw new Error('quota')};
  assert.throws(()=>f.roster.queueEmployment('A','Resign','2026-11-04'),/tidak dapat disimpan/);assert.equal(f.roster.isActive(f.accounts[0]),true);assert.equal(f.roster.employmentPending('A'),false);
});
test('unconfirmed server result stays pending for a safe retry',async()=>{
  const f=fixture({confirm:false});f.roster.queueEmployment('A','Resign','2026-11-04');await f.roster.flushEmployment();
  assert.equal(f.roster.employmentPending('A'),true);assert.equal(f.stored.staff_roster,undefined);
});
test('queued employment is private to the signed-in user and endpoint',()=>{
  const f=fixture();f.roster.queueEmployment('A','Resign','2026-11-04');f.context.Auth.session.user.id='OTHER';
  assert.equal(f.roster.employmentPending('A'),false);assert.equal(f.roster.isActive(f.accounts[0]),true);
});
test('new server-projected status overrides an older settings snapshot',()=>{
  const f=fixture({settings:{staff_roster:{updated_at:'2026-11-01T00:00:00Z',employment:{A:{status:'Aktif'}}}}});
  assert.equal(f.roster.employmentStatus({...f.accounts[0],status_staf:'Resign',status_staf_updated_at:'2026-11-04T00:00:00Z'}),'Resign');
});
