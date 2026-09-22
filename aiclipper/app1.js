const $ = id => document.getElementById(id);
let file=null, objectUrl=null, transcript=[], candidates=[], selected=null, previewTimer=null, transcriber=null, transcriberKey='';
let bgImage=null, bgObjectUrl=null;
let outroFile=null, outroObjectUrl=null;
let customPreviewTimer=null;
let sharedAudioCtx=null, sharedAudioDest=null, sharedMainSource=null, sharedOutroSource=null;
let sharedMainGain=null, sharedOutroGain=null, sharedCompressor=null, sharedLimiter=null, sharedOutputGain=null;
let clipperMethod='ai', manualMode='script', exportTitleUserEdited=false;
let sourceMode='local';
let ytVideoId='', ytMetadata=null, ytBridgeReady=false, ytPlayer=null, ytPlayerReady=false;
let ytBatchSelected=new Set(), ytBatchClips=[], ytCaptureAbort=false;
let ytBridgePending=new Map(), ytBridgeSeq=0;
const video=$('video');
const outroVideo=$('outroVideo');

function log(msg){ $('log').textContent += ($('log').textContent?'\n':'') + msg; $('log').scrollTop=$('log').scrollHeight; }
function status(msg,p=null){ $('statusText').textContent=msg; if(p!==null){$('pct').textContent=Math.round(p)+'%';$('bar').style.width=Math.max(0,Math.min(100,p))+'%';} }
function fmtTime(s){ s=Math.max(0,Math.round(s||0)); const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),ss=s%60; return [h,m,ss].map(x=>String(x).padStart(2,'0')).join(':'); }
function fmtMinuteSecond(s){
  s=Math.max(0,Math.round(Number(s)||0));
  const m=Math.floor(s/60),ss=s%60;
  return `${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
}
function sanitizeFileName(name){
  let s=String(name||'').trim();
  s=s.replace(/[<>:"/\\|?*\x00-\x1F]/g,' ');
  s=s.replace(/\s+/g,' ').replace(/[. ]+$/g,'').trim();
  const reserved=/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  if(reserved.test(s)) s='AIClip '+s;
  if(!s) s='AIClip';
  return s.slice(0,90);
}
function syncExportTitleFromSelection(force=false){
  if(!$('exportTitle') || !selected) return;
  if(force || !exportTitleUserEdited){
    $('exportTitle').value=sanitizeFileName(selected.title || 'AIClip');
  }
}
function fmtSize(n){ const u=['B','KB','MB','GB']; let i=0,v=n; while(v>=1024&&i<u.length-1){v/=1024;i++} return v.toFixed(i?1:0)+' '+u[i]; }
function clamp(v){return Math.max(0,Math.min(100,Math.round(v)))}
function overlaps(a,b){const x=Math.max(0,Math.min(a.end,b.end)-Math.max(a.start,b.start)); return x/Math.max(1,Math.min(a.end-a.start,b.end-b.start));}

function applyAudioProfile(){
  if(!sharedAudioCtx || !sharedMainGain || !sharedOutroGain || !sharedCompressor || !sharedLimiter || !sharedOutputGain) return;
  const profile=$('audioProfile')?.value || 'loud';

  let inputGain=1.0;
  let threshold=-6;
  let ratio=10;
  let knee=6;
  let attack=0.003;
  let release=0.22;
  let outputGain=0.94;

  if(profile==='loud'){
    inputGain=1.65;
    threshold=-9;
    ratio=12;
    knee=7;
    attack=0.0025;
    release=0.24;
    outputGain=0.92;
  }else if(profile==='extra'){
    inputGain=2.05;
    threshold=-11;
    ratio=16;
    knee=8;
    attack=0.002;
    release=0.28;
    outputGain=0.88;
  }

  const now=sharedAudioCtx.currentTime;
  sharedMainGain.gain.setTargetAtTime(inputGain,now,0.01);
  sharedOutroGain.gain.setTargetAtTime(inputGain,now,0.01);
  sharedCompressor.threshold.setValueAtTime(threshold,now);
  sharedCompressor.knee.setValueAtTime(knee,now);
  sharedCompressor.ratio.setValueAtTime(ratio,now);
  sharedCompressor.attack.setValueAtTime(attack,now);
  sharedCompressor.release.setValueAtTime(release,now);

  sharedLimiter.threshold.setValueAtTime(-1.5,now);
  sharedLimiter.knee.setValueAtTime(0,now);
  sharedLimiter.ratio.setValueAtTime(20,now);
  sharedLimiter.attack.setValueAtTime(0.001,now);
  sharedLimiter.release.setValueAtTime(0.08,now);

  sharedOutputGain.gain.setTargetAtTime(outputGain,now,0.01);
}

async function ensureSharedAudioGraph(){
  if(!sharedAudioCtx){
    sharedAudioCtx=new (window.AudioContext||window.webkitAudioContext)();
    sharedAudioDest=sharedAudioCtx.createMediaStreamDestination();

    sharedMainSource=sharedAudioCtx.createMediaElementSource(video);
    sharedOutroSource=sharedAudioCtx.createMediaElementSource(outroVideo);

    sharedMainGain=sharedAudioCtx.createGain();
    sharedOutroGain=sharedAudioCtx.createGain();
    sharedCompressor=sharedAudioCtx.createDynamicsCompressor();
    sharedLimiter=sharedAudioCtx.createDynamicsCompressor();
    sharedOutputGain=sharedAudioCtx.createGain();

    sharedMainSource.connect(sharedMainGain);
    sharedOutroSource.connect(sharedOutroGain);
    sharedMainGain.connect(sharedCompressor);
    sharedOutroGain.connect(sharedCompressor);
    sharedCompressor.connect(sharedLimiter);
    sharedLimiter.connect(sharedOutputGain);

    sharedOutputGain.connect(sharedAudioCtx.destination);
    sharedOutputGain.connect(sharedAudioDest);

    applyAudioProfile();
  }
  if(sharedAudioCtx.state==='suspended') await sharedAudioCtx.resume();
  applyAudioProfile();
  return sharedAudioDest.stream;
}

function readTypedTime(minuteId, secondId){
  const minute=Number($(minuteId).value);
  const second=Number($(secondId).value);
  if(!Number.isFinite(minute) || !Number.isFinite(second)) return NaN;
  if(minute<0 || second<0 || second>59) return NaN;
  if(!Number.isInteger(minute) || !Number.isInteger(second)) return NaN;
  return minute*60+second;
}
function setTypedTime(minuteId, secondId, totalSeconds){
  const total=Math.max(0,Math.floor(Number(totalSeconds)||0));
  $(minuteId).value=String(Math.floor(total/60));
  $(secondId).value=String(total%60);
}
function refreshManualTimeStatus(){
  const start=readTypedTime('startMinute','startSecond');
  const end=readTypedTime('endMinute','endSecond');
  if(Number.isNaN(start)||Number.isNaN(end)){
    $('manualTimeStatus').textContent='Periksa nilai menit/detik';
    return;
  }
  $('manualTimeStatus').textContent=`${fmtMinuteSecond(start)} → ${fmtMinuteSecond(end)}`;
}
function tokenize(t){return (String(t||'').toLowerCase().match(/[\p{L}\p{N}%]+/gu)||[])}
function countOverlap(text, words){
  if(!words.length) return 0;
  const s=new Set(tokenize(text));
  return words.reduce((n,w)=>n+(s.has(w)?1:0),0);
}
function scoreTextDims(text,dur){
  const HOOK=['ternyata','faktanya','sebenarnya','masalah sebenarnya','yang tidak banyak orang tahu','justru','ini yang terjadi','buktinya','akhirnya'];
  const QUESTION=['kenapa','mengapa','bagaimana','siapa','apa','kok','benarkah','apakah'];
  const CONFLICT=['tapi','tetapi','namun','salah','bohong','bantah','bukan','gagal','masalah','konflik','protes','aneh','dicopot','dipecat','ditolak','korupsi'];
  const INFO=['data','fakta','angka','persen','miliar','juta','ribu','dokumen','hasil','laporan','bukti','anggaran','saham','rupiah'];
  const EMOTION=['kaget','marah','kecewa','takut','senang','sedih','parah','gila','luar biasa','mengejutkan','viral','heboh'];
  const cnt=(t,v)=>{const s=new Set(tokenize(t));return v.reduce((n,x)=>n+(s.has(x)?1:0),0)};
  const l=text.toLowerCase(),qh=cnt(text,QUESTION),cf=cnt(text,CONFLICT),inf=cnt(text,INFO)+(text.match(/\b\d+(?:[.,]\d+)?%?/g)||[]).length,em=cnt(text,EMOTION),hh=HOOK.filter(x=>l.includes(x)).length;
  const hook=clamp(40+hh*13+qh*7+(text.includes('?')?6:0));
  const curiosity=clamp(38+qh*10+hh*10+cf*4);
  const conflict=clamp(30+cf*14);
  const information=clamp(38+inf*9+Math.min(18,tokenize(text).length/12));
  const emotion=clamp(30+em*15+(text.includes('!')?5:0));
  const standalone=clamp((55+Math.min(25,(text.match(/[.!?]+/g)||[]).length*5)+Math.max(0,20-Math.abs(dur-42)))/1.15);
  const score=clamp(hook*.25+curiosity*.20+conflict*.15+information*.15+emotion*.10+standalone*.15);
  return {hook,curiosity,conflict,information,emotion,standalone,score};
}
function buildSelection(start,end,title,reason,chunkSource){
  start=Math.max(0,start||0); end=Math.min(video.duration||end,end||0);
  if(end<=start) throw new Error('Waktu akhir harus lebih besar dari waktu awal.');
  const chunks = (chunkSource||transcript).filter(c=>c.end>=start && c.start<=end);
  const text = chunks.length ? chunks.map(c=>c.text).join(' ').replace(/\s+/g,' ').trim() : 'Manual cut';
  const dims = scoreTextDims(text||'Manual cut', end-start);
  return {start,end,title:title||'Custom Cut',reason:reason||'Dipilih manual',text, ...dims, chunks};
}
function applySelection(sel, clearActive=true){
  selected=sel;
  $('detailEmpty').style.display='none';$('detail').style.display='block';
  $('exportBox').style.display=file?'block':'none';
  $('previewBtn').disabled=!file;
  $('previewBtn').style.display=file?'inline-block':'none';
  $('ytCutBtn').style.display=(sourceMode==='youtube' && !file)?'inline-block':'none';
  $('detailScore').textContent=`${selected.score}/100`;
  $('detailTime').textContent=`${fmtTime(selected.start)} → ${fmtTime(selected.end)} • ${Math.round(selected.end-selected.start)} detik`;
  $('detailTitle').textContent=selected.title;$('detailReason').textContent=selected.reason;
  $('kHook').textContent=selected.hook;$('kCuriosity').textContent=selected.curiosity;$('kConflict').textContent=selected.conflict;$('kInfo').textContent=selected.information;
  $('detailTranscript').textContent=selected.text || '(Tidak ada transcript pada rentang ini)';
  if(clearActive) document.querySelectorAll('.result').forEach((e)=>e.classList.remove('active'));
  setTypedTime('startMinute','startSecond',selected.start);
  setTypedTime('endMinute','endSecond',selected.end);
  refreshManualTimeStatus();
  syncExportTitleFromSelection();
  drawTemplatePreview();
}
function normalizeMatchText(text){
  return tokenize(text).map(x=>x.toLowerCase()).join(' ');
}
const SCRIPT_STOPWORDS=new Set([
  'yang','dan','di','ke','dari','ini','itu','ada','adalah','atau','untuk','dengan','pada','saya','kita',
  'dia','mereka','nya','sebagai','jadi','juga','tidak','bukan','kalau','karena','tapi','tetapi','seperti',
  'sudah','akan','bisa','lebih','oleh','dalam','sebuah','orang','pak','ya'
]);
function matchContentTokens(text){
  const arr=Array.isArray(text)?text:tokenize(text);
  const clean=arr.map(x=>String(x).toLowerCase()).filter(x=>x.length>2 && !SCRIPT_STOPWORDS.has(x));
  return clean.length>=3?clean:arr.map(x=>String(x).toLowerCase()).filter(Boolean);
}
function multisetF1(a,b){
  if(!a.length||!b.length)return 0;
  const ca=new Map(),cb=new Map();
  for(const x of a)ca.set(x,(ca.get(x)||0)+1);
  for(const x of b)cb.set(x,(cb.get(x)||0)+1);
  let common=0;
  for(const [k,v] of ca)common+=Math.min(v,cb.get(k)||0);
  if(!common)return 0;
  const precision=common/b.length,recall=common/a.length;
  return 2*precision*recall/(precision+recall);
}
function lcsCoverage(a,b){
  if(!a.length||!b.length)return 0;
  const aa=a.slice(0,600),bb=b.slice(0,800);
  let prev=new Uint16Array(bb.length+1),cur=new Uint16Array(bb.length+1);
  for(let i=1;i<=aa.length;i++){
    cur.fill(0);
    for(let j=1;j<=bb.length;j++){
      cur[j]=aa[i-1]===bb[j-1]?prev[j-1]+1:Math.max(prev[j],cur[j-1]);
    }
    const t=prev;prev=cur;cur=t;
  }
  return prev[bb.length]/Math.max(1,aa.length);
}
function findSelectionFromScript(query){
  if(!transcript.length) throw new Error('Transcript belum ada. Jalankan transkripsi terlebih dahulu.');
  const raw=String(query||'').trim();
  const qNorm=normalizeMatchText(raw);
  const qAll=tokenize(raw).map(x=>x.toLowerCase());
  if(qAll.length<3) throw new Error('Script terlalu pendek. Masukkan minimal beberapa kata yang khas.');

  const normChunks=transcript.map(c=>normalizeMatchText(c.text));
  let full='',spans=[];
  for(let i=0;i<normChunks.length;i++){
    const n=normChunks[i];
    if(!n)continue;
    if(full)full+=' ';
    const s=full.length;
    full+=n;
    spans.push({i,start:s,end:full.length});
  }

  const exactPos=full.indexOf(qNorm);
  if(qNorm.length>=12 && exactPos>=0){
    const exactEnd=exactPos+qNorm.length;
    const sSpan=spans.find(x=>x.end>exactPos) || spans[0];
    const eSpan=[...spans].reverse().find(x=>x.start<exactEnd) || spans[spans.length-1];
    const startIdx=sSpan.i,endIdx=Math.max(sSpan.i,eSpan.i);
    const chunkSet=transcript.slice(startIdx,endIdx+1);
    const start=chunkSet[0].start,end=chunkSet.at(-1).end;
    const joined=chunkSet.map(x=>x.text).join(' ').replace(/\s+/g,' ').trim();
    const dims=scoreTextDims(joined,end-start);
    return {
      start,end,title:'Script Cut',
      reason:'Cocok langsung dengan transcript • akurasi 100%',
      text:joined,...dims,chunks:chunkSet,matchConfidence:100
    };
  }

  const qContent=matchContentTokens(qAll);
  const expectedDur=Math.max(8,Math.min(240,qAll.length/2.35));
  const minDur=Math.max(5,expectedDur*.52);
  const maxDur=Math.min(300,Math.max(35,expectedDur*1.75));
  const prelim=[];

  for(let i=0;i<transcript.length;i++){
    const start=Number(transcript[i]?.start||0);
    let wordsAll=[],wordsContent=[];
    for(let j=i;j<transcript.length;j++){
      const ch=transcript[j];
      const end=Number(ch?.end||start);
      const dur=end-start;
      if(dur>maxDur)break;
      const t=tokenize(ch?.text||'').map(x=>x.toLowerCase());
      wordsAll.push(...t);
      wordsContent.push(...matchContentTokens(t));
      if(dur<minDur)continue;

      const bag=multisetF1(qContent,wordsContent);
      if(bag<0.12)continue;
      const lenPenalty=Math.abs(wordsAll.length-qAll.length)/Math.max(1,qAll.length);
      const rough=bag-Math.min(.25,lenPenalty*.08);
      prelim.push({i,j,start,end,wordsAll:[...wordsAll],wordsContent:[...wordsContent],bag,lenPenalty,rough});
      prelim.sort((a,b)=>b.rough-a.rough);
      if(prelim.length>28)prelim.length=28;
    }
  }

  if(!prelim.length) throw new Error('Script tidak ditemukan dengan kecocokan yang cukup di transcript.');

  const firstAnchor=qContent.slice(0,Math.min(10,qContent.length));
  const lastAnchor=qContent.slice(Math.max(0,qContent.length-10));
  let best=null;

  for(const c of prelim){
    const ordered=lcsCoverage(qAll,c.wordsAll);
    const startZone=c.wordsContent.slice(0,Math.max(20,firstAnchor.length*4));
    const endZone=c.wordsContent.slice(-Math.max(20,lastAnchor.length*4));
    const aStart=multisetF1(firstAnchor,startZone);
    const aEnd=multisetF1(lastAnchor,endZone);
    const score=c.bag*.25+ordered*.25+aStart*.25+aEnd*.25-Math.min(.12,c.lenPenalty*.04);
    if(!best||score>best.score)best={...c,ordered,aStart,aEnd,score};
  }

  if(!best || best.score<0.60 || best.aStart<0.45 || best.aEnd<0.45 || best.ordered<0.45){
    const pct=Math.round((best?.score||0)*100);
    throw new Error(`Kecocokan script terlalu rendah (${pct}%). Gunakan kalimat yang lebih sama dengan transcript atau pilih waktu manual.`);
  }

  let startIdx=best.i,endIdx=best.j;

  // Refine titik awal menggunakan anchor awal.
  let bestStartScore=-1;
  for(let k=best.i;k<=Math.min(best.j,best.i+14);k++){
    const local=[];
    for(let z=k;z<=Math.min(best.j,k+5);z++)local.push(...matchContentTokens(tokenize(transcript[z]?.text||'')));
    const sc=multisetF1(firstAnchor,local);
    if(sc>bestStartScore){bestStartScore=sc;startIdx=k;}
  }

  // Refine titik akhir menggunakan anchor akhir.
  let bestEndScore=-1;
  for(let k=Math.max(startIdx,best.j-14);k<=best.j;k++){
    const local=[];
    for(let z=Math.max(startIdx,k-5);z<=k;z++)local.push(...matchContentTokens(tokenize(transcript[z]?.text||'')));
    const sc=multisetF1(lastAnchor,local);
    if(sc>bestEndScore){bestEndScore=sc;endIdx=k;}
  }

  if(endIdx<startIdx)endIdx=best.j;
  const chunkSet=transcript.slice(startIdx,endIdx+1);
  const start=chunkSet[0].start,end=chunkSet.at(-1).end;
  const joined=chunkSet.map(x=>x.text).join(' ').replace(/\s+/g,' ').trim();
  const dims=scoreTextDims(joined,end-start);
  const confidence=Math.max(1,Math.min(99,Math.round(best.score*100)));

  return {
    start,end,title:'Script Cut',
    reason:`STRICT MATCH • confidence ${confidence}% • awal ${Math.round(best.aStart*100)}% • akhir ${Math.round(best.aEnd*100)}%`,
    text:joined,...dims,chunks:chunkSet,matchConfidence:confidence
  };
}