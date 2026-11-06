'use strict';
const fs=require('node:fs'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const root=process.env.MWG_TEST_ROOT||path.resolve(__dirname,'../..');
const wait=async(predicate,label='condition')=>{for(let i=0;i<500;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10))}throw new Error('Timed out: '+label)};
async function loadApp(route='briefs'){
 let source=fs.readFileSync(path.join(root,'index.html'),'utf8');
 for(const file of ['staff-roster.js','brief-import.js','hot-pdf-import.js','app.js'])source=source.replace(new RegExp('<script src="\\./'+file.replace('.','\\.')+'\\?v=[^"]+"></script>'),()=>'<script>'+fs.readFileSync(path.join(root,file),'utf8')+'</script>');
 source=source.replace("document.addEventListener('DOMContentLoaded',()=>{\n  // v1.20.1", "Config.data.apiUrl='';Config.loadRemote=async()=>({ok:false});window.__test={StaffRoster,Store,Auth,App,Utils,BriefModule,TaskModule,AdminModule,ReferenceManager,API,LocalDB,Config,CalendarModule,BriefImport,HotIssue,HotPdfImport};\ndocument.addEventListener('DOMContentLoaded',()=>{\n  // v1.20.1");
 const errors=[],bridge=new VirtualConsole();bridge.on('jsdomError',e=>{if(e.type==='unhandled-exception')errors.push(e.message)});
 const dom=new JSDOM(source,{url:'http://localhost/index.html#'+route,runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:bridge,beforeParse(w){w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.fetch=async()=>{throw new Error('Network disabled by integration tests')};w.confirm=()=>true;w.scrollTo=()=>{};}});
 const w=dom.window,d=w.document,q=s=>d.querySelector(s),qa=s=>[...d.querySelectorAll(s)],click=s=>{if(!q(s))throw new Error('Missing '+s);q(s).click()};
 await wait(()=>q('#loginForm'),'login');click('#loginForm button[type=submit]');await wait(()=>w.__test?.Auth.session&&q('.app-shell'),'application shell');
 await w.__test.ReferenceManager.ensure();await w.__test.StaffRoster.ensure();
 await wait(()=>w.__test.Store.isModuleReady('briefs')&&w.__test.Store.isModuleReady('tasks'),'core indexes');
 return {dom,w,d,q,qa,click,t:w.__test,wait,errors};
}
module.exports={loadApp,wait,root};
