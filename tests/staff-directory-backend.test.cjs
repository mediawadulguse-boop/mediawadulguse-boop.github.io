'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.resolve(__dirname,'../backend/staff-directory-v1.34.gs'),'utf8');
function fixture(){
 let reads=0;const account={id:'A',nama:'Staf Lama',username:'old-user',password:'private-password',whatsapp:'628000',role:'STAF'};
 const c={Date,CONFIG:{STATIC_CACHE_TTL_SECONDS:30},getAllCached_:sheet=>{if(sheet==='SYSTEM_SETTINGS'){reads++;return[{key:'staff_roster',value:JSON.stringify({updated_at:'2026-11-04T00:00:00Z',employment:{A:{status:'Resign',resigned_at:'2026-11-04'}}})}]}return[]},safeJson_:(x,d)=>{try{return JSON.parse(x)}catch{return d}},hasPermission_:(user,p)=>(user.permissions||[]).includes('*')||(user.permissions||[]).includes(p),permissionsForUser_:()=>[],permissionHasOverride_:()=>false,getAccountsCached_:()=>[account,{id:'B',nama:'Aktif',role:'STAF'}],getModuleRevision_:()=>1};
 vm.createContext(c);vm.runInContext(code,c);return {c,account,get reads(){return reads}};
}
test('analyst references include employment status without private account fields',()=>{
 const {c}=fixture(),out=c.getReferencePackV1210_({id:'AN',permissions:['brief.create']});assert.equal(out.accounts[0].status_staf,'Resign');assert.equal(out.accounts[0].tanggal_resign,'2026-11-04');assert.equal(out.accounts[0].password,'');assert.equal(out.accounts[0].whatsapp,'');assert.equal(out.accounts[1].status_staf,'Aktif');
});
test('staff sees only their own directory record including resignation',()=>{
 const {c}=fixture(),out=c.getReferencePackV1210_({id:'A',permissions:[]});assert.equal(out.accounts.length,1);assert.equal(out.accounts[0].id,'A');assert.equal(out.accounts[0].status_staf,'Resign');
});
test('employment settings are fetched once for a directory response',()=>{
 const f=fixture();f.c.getReferencePackV1210_({id:'ADMIN',permissions:['*']});f.c.sanitizeAccountV122_(f.account,{permissions:['*']});assert.equal(f.reads,1);
});
test('existing administrator credential permissions remain unchanged',()=>{
 const {c,account}=fixture();assert.equal(c.sanitizeAccountV122_(account,{permissions:['account.view']}).password,'');assert.equal(c.sanitizeAccountV122_(account,{permissions:['*']}).password,'private-password');
});
