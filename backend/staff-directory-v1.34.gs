/* v1.34.0 — replace the two existing functions with these versions.
   Add staffDirectoryStatusV134_ once. In saveSystemSettings_, apply the
   staff_roster invalidation shown in docs/optimization-v1.34.md. */


// Read only the minimal employment directory for assignment references.
// Cache within this execution; no settings or secrets are sent to staff.
let STAFF_DIRECTORY_EXEC_V134_=null;
function staffDirectoryStatusV134_(account){
  if(STAFF_DIRECTORY_EXEC_V134_===null){
    const row=getAllCached_('SYSTEM_SETTINGS',CONFIG.STATIC_CACHE_TTL_SECONDS).find(function(r){return String(r.key)==='staff_roster'});
    STAFF_DIRECTORY_EXEC_V134_=row?(typeof row.value==='object'&&row.value?row.value:safeJson_(row.value,{})):{};
  }
  const cfg=STAFF_DIRECTORY_EXEC_V134_||{},entry=(cfg.employment||{})[String(account.id||'')]||{},status=String(entry.status||account.status_staf||'Aktif').trim().toLowerCase();
  return {status_staf:status==='resign'?'Resign':'Aktif',tanggal_resign:status==='resign'?String(entry.resigned_at||account.tanggal_resign||''):'',status_staf_updated_at:String(cfg.updated_at||'')};
}

function sanitizeAccountV122_(a,user){const admin=hasPermission_(user,'account.view')||hasPermission_(user,'account.manage_permissions'),target={id:a.id,role:a.role};return Object.assign({id:String(a.id||''),username:admin?String(a.username||''):'',password:hasPermission_(user,'account.manage_permissions')?String(a.password||''):'',nama:String(a.nama||''),role:String(a.role||''),whatsapp:admin?String(a.whatsapp||a.no_wa||''):'',permissions:permissionsForUser_(target),permissions_override:permissionHasOverride_(target)},staffDirectoryStatusV134_(a));}

function getReferencePackV1210_(user,accountsInput){
  const started=Date.now(),accounts=Array.isArray(accountsInput)?accountsInput:getAccountsCached_();
  // Reference Pack kecil dan stabil: data assignment tersedia sebelum editor dibuka.
  // Password hanya dikirim ke SUPERADMIN karena halaman administrasi akun memang membutuhkannya.
  const canAdmin=hasPermission_(user,'account.view')||hasPermission_(user,'account.manage_permissions'),canAssign=canAdmin||hasPermission_(user,'brief.create')||hasPermission_(user,'brief.edit')||hasPermission_(user,'task.edit_all');
  const eligible=canAssign?accounts:accounts.filter(function(a){return String(a.id)===String(user.id)});
  const accountOptions=eligible.map(function(a){return Object.assign({id:String(a.id||''),username:canAdmin?String(a.username||''):'',password:hasPermission_(user,'account.manage_permissions')?String(a.password||''):'',nama:String(a.nama||''),role:String(a.role||''),whatsapp:canAdmin?String(a.whatsapp||a.no_wa||''):'',permissions:canAdmin?permissionsForUser_({id:a.id,role:a.role}):[],permissions_override:canAdmin?permissionHasOverride_({id:a.id,role:a.role}):false},staffDirectoryStatusV134_(a))}).filter(function(a){return a.id&&a.nama});
  const templates=hasPermission_(user,'template.view')?getAllCached_('TEMPLATE_BRIEF',CONFIG.STATIC_CACHE_TTL_SECONDS):[];
  return {accounts:accountOptions,templates:templates,revisions:{accounts:getModuleRevision_('accounts'),templates:getModuleRevision_('templates')},generated_at:new Date().toISOString(),complete:true,performance:{server_ms:Date.now()-started,reference_pack:true}};
}
