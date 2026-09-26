let batchRows=[];
let batchCancelled=false;
let batchExporting=false;

function batchNormKey(v){
  return String(v||'')
    .toLowerCase()
    .replace(/[()\[\]{}]/g,' ')
    .replace(/[_/\\-]+/g,' ')
    .replace(/[^a-z0-9\u00c0-\uFFFF]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function batchGetField(row,names){
  const entries=Object.entries(row||{});
  for(const wanted of names){
    const w=batchNormKey(wanted);
    const exact=entries.find(([k])=>batchNormKey(k)===w);
    if(exact && String(exact[1]??'').trim()!=='') return exact[1];
  }
  for(const wanted of names){
    const w=batchNormKey(wanted);
    const partial=entries.find(([k])=>{
      const n=batchNormKey(k);
      return (n.includes(w)||w.includes(n)) && String(row[k]??'').trim()!=='';
    });
    if(partial) return partial[1];
  }
  return '';
}

function batchParseClock(value){
  if(value===null||value===undefined||value==='') return NaN;
  if(typeof value==='number' && Number.isFinite(value)){
    if(value>=0 && value<1) return Math.round(value*86400);
    return Math.round(value);
  }

  const s=String(value).trim();
  if(!s) return NaN;

  if(/^\d+(?:\.\d+)?$/.test(s)) return Number(s);

  const m=s.match(/(\d{1,3}):(\d{1,2})(?::(\d{1,2}(?:[.,]\d+)?))?/);
  if(!m) return NaN;

  if(m[3]!==undefined){
    const h=Number(m[1]),min=Number(m[2]),sec=Number(String(m[3]).replace(',','.'));
    if(min>59||sec>=60) return NaN;
    return h*3600+min*60+sec;
  }

  const min=Number(m[1]),sec=Number(m[2]);
  if(sec>59) return NaN;
  return min*60+sec;
}

function batchParseRangeText(value){
  const s=String(value||'').replace(/[–—]/g,'-');
  const times=[...s.matchAll(/\b\d{1,3}:\d{2}(?::\d{2}(?:[.,]\d+)?)?\b/g)].map(x=>x[0]);
  if(times.length<2) return null;
  const start=batchParseClock(times[0]);
  const end=batchParseClock(times[1]);
  if(!Number.isFinite(start)||!Number.isFinite(end)) return null;
  return {start,end};
}

function batchRowToClip(row,index){
  const rangeValue=batchGetField(row,[
    'Durasi (Awal - Akhir = Total)',
    'Durasi Awal Akhir Total',
    'Rentang Waktu',
    'Time Range',
    'Timestamp',
    'Durasi'
  ]);

  let start=NaN,end=NaN;

  const parsedRange=batchParseRangeText(rangeValue);
  if(parsedRange){
    start=parsedRange.start;
    end=parsedRange.end;
  }else{
    start=batchParseClock(batchGetField(row,['Waktu Awal','Awal','Start','Start Time','Mulai']));
    end=batchParseClock(batchGetField(row,['Waktu Akhir','Akhir','End','End Time','Selesai']));
  }

  const no=batchGetField(row,['No','Nomor','Number']) || (index+1);
  const hook=String(batchGetField(row,[
    'Text Hook Brutal',
    'Hook',
    'Judul',
    'Title',
    'Headline',
    'Nama Clip'
  ])||'').trim();
  const narrative=String(batchGetField(row,['Narasi Awal','Narasi','Script','Naskah'])||'').trim();
  const reference=String(batchGetField(row,['Acuan Naskah (Narasi Awal - Narasi Akhir)','Acuan Naskah','Acuan','Catatan'])||'').trim();

  const issues=[];
  if(!Number.isFinite(start)) issues.push('waktu awal tidak terbaca');
  if(!Number.isFinite(end)) issues.push('waktu akhir tidak terbaca');
  if(Number.isFinite(start)&&Number.isFinite(end)&&end<=start) issues.push('waktu akhir ≤ awal');

  return {
    id:index+1,
    no:String(no),
    start:Number(start),
    end:Number(end),
    hook:hook || `Clip ${index+1}`,
    narrative,
    reference,
    checked:issues.length===0,
    issues,
    state:'ready'
  };
}

function parseCSVRows(text){
  const rows=[];
  let row=[],cell='',quoted=false;

  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"' && text[i+1]==='"'){
        cell+='"';i++;
      }else if(ch==='"'){
        quoted=false;
      }else{
        cell+=ch;
      }
    }else{
      if(ch==='"'){
        quoted=true;
      }else if(ch===','){
        row.push(cell);cell='';
      }else if(ch==='\n'){
        row.push(cell);rows.push(row);row=[];cell='';
      }else if(ch!=='\r'){
        cell+=ch;
      }
    }
  }
  if(cell.length||row.length){row.push(cell);rows.push(row);}
  if(!rows.length) return [];

  const headers=rows.shift().map((x,i)=>String(x||'').trim()||`Kolom ${i+1}`);
  return rows
    .filter(r=>r.some(x=>String(x||'').trim()!==''))
    .map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));
}

async function readBatchSpreadsheet(fileObj){
  const name=String(fileObj?.name||'').toLowerCase();

  if(name.endsWith('.csv')){
    const text=await fileObj.text();
    return parseCSVRows(text);
  }

  if(!(name.endsWith('.xlsx')||name.endsWith('.xls'))){
    throw new Error('Format tidak didukung. Gunakan CSV, XLSX, atau XLS.');
  }

  const XLSX=await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
  const buf=await fileObj.arrayBuffer();
  const wb=XLSX.read(buf,{type:'array',cellDates:false});
  const sheet=wb.Sheets[wb.SheetNames[0]];
  if(!sheet) throw new Error('Sheet Excel tidak ditemukan.');
  return XLSX.utils.sheet_to_json(sheet,{defval:'',raw:false});
}

function splitBatchHeadline(text){
  const words=String(text||'').trim().split(/\s+/).filter(Boolean);
  if(words.length<=6) return [words.join(' '),''];

  let best=1,bestDiff=Infinity;
  for(let i=1;i<words.length;i++){
    const a=words.slice(0,i).join(' ');
    const b=words.slice(i).join(' ');
    const diff=Math.abs(a.length-b.length);
    if(diff<bestDiff){bestDiff=diff;best=i;}
  }
  return [words.slice(0,best).join(' '),words.slice(best).join(' ')];
}

function batchClipValidity(item){
  const issues=[...item.issues];
  if(file && Number.isFinite(video.duration) && video.duration>0){
    if(item.start<0) issues.push('awal < 0');
    if(item.end>video.duration+.25) issues.push(`akhir melewati durasi video ${fmtTime(video.duration)}`);
  }
  return [...new Set(issues)];
}

function batchSelectedRows(){
  return batchRows.filter(x=>x.checked && batchClipValidity(x).length===0);
}

function refreshBatchAvailability(){
  if(!$('batchExportBtn')) return;
  const selectedRows=batchSelectedRows();
  const hasVideo=!!file && Number.isFinite(video.duration) && video.duration>0;
  $('batchExportBtn').disabled=batchExporting || !hasVideo || !selectedRows.length;
  $('batchCount').textContent=`${selectedRows.length}/${batchRows.length} clip`;

  if(!batchRows.length){
    $('batchProgressText').textContent='Siap';
  }else if(!hasVideo){
    $('batchProgressText').textContent='Import siap • upload video lokal untuk export';
  }else{
    $('batchProgressText').textContent=`${selectedRows.length} clip siap export`;
  }
}

function renderBatchList(){
  const root=$('batchList');
  root.innerHTML='';

  batchRows.forEach((item,i)=>{
    const issues=batchClipValidity(item);
    const valid=!issues.length;
    if(!valid) item.checked=false;

    const el=document.createElement('div');
    el.className='batchclip';
    el.dataset.batchIndex=i;

    const checked=item.checked?'checked':'';
    const stateText=item.state==='done'
      ? '✓ selesai'
      : item.state==='working'
        ? 'memproses…'
        : item.state==='error'
          ? 'gagal'
          : valid?'siap':issues.join(' • ');

    el.innerHTML=`
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div style="display:flex;gap:10px;align-items:flex-start;min-width:0">
          <input class="ytcheck batch-check" data-batch-check="${i}" type="checkbox" ${checked} ${valid?'':'disabled'}>
          <div style="min-width:0">
            <div style="font-weight:800">#${escapeHtml(item.no)} • ${escapeHtml(item.hook)}</div>
            <div class="tiny">${fmtTime(item.start)} → ${fmtTime(item.end)} • ${Math.max(0,Math.round(item.end-item.start))} detik</div>
            <div class="tiny" style="${valid?'':'color:var(--danger)'}">${escapeHtml(stateText)}</div>
          </div>
        </div>
        <button class="btn batch-preview" data-batch-preview="${i}" type="button" ${valid&&file?'':'disabled'}>Preview</button>
      </div>
    `;
    root.appendChild(el);
  });

  root.querySelectorAll('[data-batch-check]').forEach(cb=>{
    cb.addEventListener('change',e=>{
      const i=Number(e.target.dataset.batchCheck);
      if(batchRows[i]) batchRows[i].checked=!!e.target.checked;
      refreshBatchAvailability();
    });
  });

  root.querySelectorAll('[data-batch-preview]').forEach(btn=>{
    btn.addEventListener('click',async e=>{
      const item=batchRows[Number(e.currentTarget.dataset.batchPreview)];
      if(!item||!file) return;
      const chunks=transcript.filter(c=>c.end>=item.start&&c.start<=item.end);
      const sel=buildSelection(item.start,item.end,item.hook,'Batch preview',chunks,video.duration);
      applySelection(sel);
      try{
        video.currentTime=item.start;
        await video.play();
        const stop=()=>{if(video.currentTime>=item.end||video.paused){video.pause();clearInterval(timer)}};
        const timer=setInterval(stop,80);
      }catch(err){}
    });
  });

  refreshBatchAvailability();
}

async function writeBatchBlob(directoryHandle,name,blob){
  const handle=await directoryHandle.getFileHandle(name,{create:true});
  const writable=await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function batchFilename(item,ext){
  const no=String(item.no||item.id).padStart(2,'0');
  return sanitizeFileName(`${no}_${item.hook||'Clip'}`)+'.'+ext;
}

function getBatchRenderConfig(){
  const profile=$('batchRenderProfile')?.value||'turbo';
  const hc=Math.max(2,Number(navigator.hardwareConcurrency||4));

  let fps=24,videoBits=4_500_000,audioBits=160_000,autoWorkers=2,scale='720';
  if(profile==='balanced'){
    fps=30;videoBits=5_500_000;audioBits=160_000;autoWorkers=hc>=8?2:1;scale='720';
  }else if(profile==='quality'){
    fps=30;videoBits=8_000_000;audioBits=192_000;autoWorkers=1;scale='1080';
  }else{
    autoWorkers=hc>=12?3:(hc>=6?2:1);
  }

  const chosen=$('batchWorkers')?.value||'auto';
  let workers=chosen==='auto'?autoWorkers:Number(chosen||1);
  workers=Math.max(1,Math.min(3,workers));
  if(profile==='quality') workers=1;

  return {profile,fps,videoBits,audioBits,workers,scale,hc};
}

function batchOutputDimensions(ratio,profile){
  const quality=profile==='quality';
  if(ratio==='9:16') return quality?[1080,1920]:[720,1280];
  if(ratio==='4:5') return quality?[1080,1350]:[720,900];
  if(ratio==='1:1') return quality?[1080,1080]:[720,720];
  if(ratio==='16:9') return quality?[1920,1080]:[1280,720];
  return quality?[1080,1920]:[720,1280];
}

function updateBatchWorkerInfo(){
  if(!$('batchWorkerInfo')) return;
  const c=getBatchRenderConfig();
  const label=c.profile==='quality'?'Quality':(c.profile==='balanced'?'Balanced':'Turbo');
  $('batchWorkerInfo').textContent=`${label} • ${c.workers} render paralel • ${c.fps}fps • CPU ${c.hc} thread`;
}

function configureBatchAudioGraph(ctx,videoEl,outroEl,profileName){
  const dest=ctx.createMediaStreamDestination();
  const compressor=ctx.createDynamicsCompressor();
  const limiter=ctx.createDynamicsCompressor();
  const output=ctx.createGain();
  const mainGain=ctx.createGain();
  const outroGain=ctx.createGain();

  let inputGain=1,threshold=-6,ratio=10,knee=6,attack=.003,release=.22,outputGain=.94;
  if(profileName==='loud'){
    inputGain=1.65;threshold=-9;ratio=12;knee=7;attack=.0025;release=.24;outputGain=.92;
  }else if(profileName==='extra'){
    inputGain=2.05;threshold=-11;ratio=16;knee=8;attack=.002;release=.28;outputGain=.88;
  }

  mainGain.gain.value=inputGain;
  outroGain.gain.value=inputGain;
  compressor.threshold.value=threshold;
  compressor.knee.value=knee;
  compressor.ratio.value=ratio;
  compressor.attack.value=attack;
  compressor.release.value=release;
  limiter.threshold.value=-1.5;
  limiter.knee.value=0;
  limiter.ratio.value=20;
  limiter.attack.value=.001;
  limiter.release.value=.08;
  output.gain.value=outputGain;

  const mainSource=ctx.createMediaElementSource(videoEl);
  mainSource.connect(mainGain);
  mainGain.connect(compressor);

  let outroSource=null;
  if(outroEl){
    outroSource=ctx.createMediaElementSource(outroEl);
    outroSource.connect(outroGain);
    outroGain.connect(compressor);
  }

  compressor.connect(limiter);
  limiter.connect(output);
  output.connect(dest);

  return {dest,mainSource,outroSource};
}

function makeBatchStaticLayer(item,settings,w,h){
  const c=document.createElement('canvas');
  c.width=w;c.height=h;
  const ctx=c.getContext('2d');

  if(settings.template==='editorial'){
    if(bgImage) drawCoverRect(ctx,bgImage,0,0,w,h);
    else drawDefaultBackground(ctx,w,h);

    if(settings.headlineMode==='hook'){
      const [a,b]=splitBatchHeadline(item.hook);
      ctx.textAlign='center';
      ctx.textBaseline='middle';
      ctx.strokeStyle='#000';
      ctx.lineWidth=Math.max(4,w*.008);

      if(a){
        ctx.font=`900 ${Math.round(w*.105)}px Arial Black, Arial`;
        ctx.fillStyle='#fff';
        ctx.strokeText(a,w/2,h*.10);
        ctx.fillText(a,w/2,h*.10);
      }

      if(b){
        ctx.font=`900 ${Math.round(w*.112)}px Arial Black, Arial`;
        ctx.fillStyle='#20ff57';
        ctx.strokeText(b,w/2,h*.19);
        ctx.fillText(b,w/2,h*.19);
      }
    }
  }else{
    ctx.fillStyle='#000';
    ctx.fillRect(0,0,w,h);
  }

  return c;
}

function batchSubtitleAt(item,t){
  if($('batchSubtitle')?.value!=='on') return '';
  const hit=transcript.find(c=>t>=c.start&&t<=c.end&&c.end>=item.start&&c.start<=item.end);
  return hit?.text||'';
}

function drawBatchFrame(ctx,staticLayer,videoEl,item,settings,w,h){
  ctx.clearRect(0,0,w,h);
  ctx.drawImage(staticLayer,0,0,w,h);

  if(settings.template==='editorial'){
    const y=h*(settings.videoY/100);
    const vh=h*(settings.videoH/100);
    ctx.fillStyle='#000';
    ctx.fillRect(0,y,w,vh);
    if(videoEl.readyState>=2) drawCoverRect(ctx,videoEl,0,y,w,vh);
    ctx.strokeStyle='rgba(255,255,255,.10)';
    ctx.lineWidth=1;
    ctx.strokeRect(0,y,w,vh);

    const s=batchSubtitleAt(item,videoEl.currentTime);
    if(s){
      ctx.font=`800 ${Math.max(24,Math.round(w/28))}px Arial`;
      ctx.textAlign='center';ctx.textBaseline='middle';
      const lines=wrapText(ctx,s,w*.78,2);
      const lh=Math.round(w/24);
      const boxH=lines.length*lh+20;
      const cy=y+vh*.58;
      ctx.fillStyle='rgba(0,0,0,.62)';
      ctx.fillRect(w*.10,cy-boxH/2,w*.80,boxH);
      ctx.strokeStyle='#000';ctx.lineWidth=4;ctx.fillStyle='#fff';
      lines.forEach((ln,i)=>{
        const yy=cy-(lines.length-1)*lh/2+i*lh;
        ctx.strokeText(ln,w/2,yy);
        ctx.fillText(ln,w/2,yy);
      });
    }
  }else{
    if(videoEl.readyState>=2) drawCover(ctx,videoEl,w,h);
  }
}

function createHiddenBatchMedia(src){
  const el=document.createElement('video');
  el.src=src;
  el.preload='auto';
  el.playsInline=true;
  el.crossOrigin='anonymous';
  el.style.position='fixed';
  el.style.left='-10000px';
  el.style.top='0';
  el.style.width='2px';
  el.style.height='2px';
  el.style.opacity='.001';
  el.style.pointerEvents='none';
  document.body.appendChild(el);
  return el;
}

async function waitBatchMetadata(el,timeout=12000){
  if(el.readyState>=1 && Number.isFinite(el.duration)) return;
  await new Promise((resolve,reject)=>{
    let done=false;
    const ok=()=>{if(done)return;done=true;cleanup();resolve()};
    const fail=()=>{if(done)return;done=true;cleanup();reject(new Error('Video worker gagal dimuat.'))};
    const cleanup=()=>{el.removeEventListener('loadedmetadata',ok);el.removeEventListener('error',fail);clearTimeout(timer)};
    el.addEventListener('loadedmetadata',ok,{once:true});
    el.addEventListener('error',fail,{once:true});
    const timer=setTimeout(fail,timeout);
  });
}

async function seekBatchMedia(el,time,timeout=8000){
  if(Math.abs((el.currentTime||0)-time)<.04 && el.readyState>=2) return;
  await new Promise((resolve,reject)=>{
    let done=false;
    const ok=()=>{if(done)return;done=true;cleanup();resolve()};
    const fail=()=>{if(done)return;done=true;cleanup();reject(new Error('Seek video worker timeout.'))};
    const cleanup=()=>{el.removeEventListener('seeked',ok);clearTimeout(timer)};
    el.addEventListener('seeked',ok,{once:true});
    const timer=setTimeout(fail,timeout);
    try{el.currentTime=time}catch(e){cleanup();reject(e)}
  });
}

async function renderBatchClipBlobFast(item,settings){
  if(!file||!objectUrl) throw new Error('Video lokal belum siap.');

  const cfg=settings.render;
  const [w,h]=batchOutputDimensions(settings.ratio,cfg.profile);
  const main=createHiddenBatchMedia(objectUrl);
  const outro=settings.outroUrl?createHiddenBatchMedia(settings.outroUrl):null;
  let audioCtx=null,canvas=null,canvasStream=null,rec=null,timer=null;

  try{
    await waitBatchMetadata(main);
    if(outro) await waitBatchMetadata(outro);

    canvas=document.createElement('canvas');
    canvas.width=w;canvas.height=h;
    canvas.style.position='fixed';
    canvas.style.left='-10000px';
    canvas.style.top='0';
    document.body.appendChild(canvas);

    const ctx=canvas.getContext('2d',{alpha:false,desynchronized:true});
    const staticLayer=makeBatchStaticLayer(item,settings,w,h);

    audioCtx=new (window.AudioContext||window.webkitAudioContext)();
    const audio=configureBatchAudioGraph(audioCtx,main,outro,settings.audioProfile);
    if(audioCtx.state==='suspended') await audioCtx.resume();

    canvasStream=canvas.captureStream(cfg.fps);
    audio.dest.stream.getAudioTracks().forEach(t=>canvasStream.addTrack(t));

    const fmt=supportedMime();
    const options=fmt.mime?{
      mimeType:fmt.mime,
      videoBitsPerSecond:cfg.videoBits,
      audioBitsPerSecond:cfg.audioBits
    }:{
      videoBitsPerSecond:cfg.videoBits,
      audioBitsPerSecond:cfg.audioBits
    };

    const chunks=[];
    rec=new MediaRecorder(canvasStream,options);
    rec.ondataavailable=e=>{if(e.data?.size) chunks.push(e.data)};
    const stopped=new Promise((resolve,reject)=>{
      rec.onstop=resolve;
      rec.onerror=e=>reject(e.error||e);
    });

    await seekBatchMedia(main,item.start);
    drawBatchFrame(ctx,staticLayer,main,item,settings,w,h);
    rec.start(750);
    await main.play();

    await new Promise((resolve,reject)=>{
      timer=setInterval(()=>{
        if(batchCancelled){
          clearInterval(timer);timer=null;
          main.pause();
          resolve();
          return;
        }

        drawBatchFrame(ctx,staticLayer,main,item,settings,w,h);

        if(main.ended||main.currentTime>=item.end){
          clearInterval(timer);timer=null;
          main.pause();
          resolve();
        }
      },Math.max(16,Math.round(1000/cfg.fps)));
    });

    if(batchCancelled) throw new Error('Batch dibatalkan.');

    if(outro){
      await seekBatchMedia(outro,0);
      await outro.play();

      await new Promise(resolve=>{
        timer=setInterval(()=>{
          if(batchCancelled||outro.ended){
            clearInterval(timer);timer=null;
            outro.pause();
            resolve();
            return;
          }
          ctx.clearRect(0,0,w,h);
          ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);
          if(outro.readyState>=2) drawCover(ctx,outro,w,h);
        },Math.max(16,Math.round(1000/cfg.fps)));
      });
    }

    if(batchCancelled) throw new Error('Batch dibatalkan.');

    if(rec.state!=='inactive') rec.stop();
    await stopped;

    return {
      blob:new Blob(chunks,{type:fmt.mime||'video/webm'}),
      ext:fmt.ext
    };
  }finally{
    if(timer) clearInterval(timer);
    try{main.pause()}catch(e){}
    try{outro?.pause()}catch(e){}
    try{if(rec&&rec.state!=='inactive')rec.stop()}catch(e){}
    try{canvasStream?.getTracks().forEach(t=>t.stop())}catch(e){}
    try{await audioCtx?.close()}catch(e){}
    try{main.remove()}catch(e){}
    try{outro?.remove()}catch(e){}
    try{canvas?.remove()}catch(e){}
  }
}

function getBatchSettingsSnapshot(){
  return {
    template:$('batchTemplate').value,
    ratio:$('batchRatio').value,
    headlineMode:$('batchHeadlineMode').value,
    subtitle:$('batchSubtitle').value,
    videoY:Number($('videoY').value||30),
    videoH:Number($('videoH').value||28),
    audioProfile:$('audioProfile').value,
    outroUrl:outroObjectUrl||null,
    render:getBatchRenderConfig()
  };
}

$('batchImportBtn').onclick=()=>$('batchImportInput').click();

$('batchImportInput').onchange=async e=>{
  const f=e.target.files?.[0];
  if(!f) return;

  $('batchImportBtn').disabled=true;
  $('batchImportStatus').textContent='Membaca file…';

  try{
    const rows=await readBatchSpreadsheet(f);
    if(!rows.length) throw new Error('File tidak memiliki baris data.');

    batchRows=rows.map(batchRowToClip);
    const valid=batchRows.filter(x=>x.issues.length===0).length;

    $('batchImportStatus').textContent=`${f.name} • ${valid}/${batchRows.length} valid`;
    renderBatchList();
    log(`Batch import: ${batchRows.length} baris • ${valid} valid.`);
  }catch(err){
    console.error(err);
    batchRows=[];
    $('batchImportStatus').textContent='Import gagal';
    renderBatchList();
    alert('Import batch gagal: '+(err?.message||err));
  }finally{
    $('batchImportBtn').disabled=false;
    e.target.value='';
  }
};

$('batchResetBtn').onclick=()=>{
  if(batchExporting) return;
  batchRows=[];
  $('batchImportStatus').textContent='Belum ada file';
  $('batchProgressBar').style.width='0%';
  renderBatchList();
};

$('batchBgBtn').onclick=()=>$('bgInput').click();
$('batchOutroBtn').onclick=()=>$('outroInput').click();

$('bgInput').addEventListener('change',e=>{
  const f=e.target.files?.[0];
  if(f) $('batchBgStatus').textContent='✓ '+f.name;
});

$('outroInput').addEventListener('change',e=>{
  const f=e.target.files?.[0];
  if(f) $('batchOutroStatus').textContent='✓ '+f.name;
});

$('batchTemplate').addEventListener('change',refreshBatchAvailability);
$('batchRatio').addEventListener('change',refreshBatchAvailability);
$('batchHeadlineMode').addEventListener('change',refreshBatchAvailability);
$('batchSubtitle').addEventListener('change',refreshBatchAvailability);
$('batchRenderProfile').addEventListener('change',()=>{
  updateBatchWorkerInfo();
  refreshBatchAvailability();
});
$('batchWorkers').addEventListener('change',()=>{
  updateBatchWorkerInfo();
  refreshBatchAvailability();
});

$('batchStopBtn').onclick=()=>{
  batchCancelled=true;
  $('batchProgressText').textContent='Menghentikan setelah clip saat ini…';
};

$('batchExportBtn').onclick=async()=>{
  if(batchExporting) return;

  const queue=batchSelectedRows();
  if(!file||!objectUrl) return alert('Upload video lokal terlebih dahulu.');
  if(!queue.length) return alert('Tidak ada clip valid yang dipilih.');

  let directoryHandle=null;
  if(window.showDirectoryPicker){
    try{
      directoryHandle=await window.showDirectoryPicker({mode:'readwrite'});
    }catch(e){
      if(e?.name==='AbortError') return;
      console.warn('Directory picker fallback:',e);
    }
  }

  const settings=getBatchSettingsSnapshot();
  let workers=settings.render.workers;

  // Banyak download paralel tanpa Directory Picker sering diblokir browser.
  if(!directoryHandle && workers>1){
    workers=1;
    settings.render={...settings.render,workers:1};
    log('Turbo Parallel diturunkan ke 1 worker karena browser tidak memberikan akses folder langsung.');
  }

  batchExporting=true;
  batchCancelled=false;
  $('batchExportBtn').disabled=true;
  $('batchStopBtn').disabled=false;

  queue.forEach(x=>{x.state='ready';delete x.lastError});
  renderBatchList();

  let nextIndex=0,success=0,failed=0,completed=0;
  const startedAt=performance.now();

  const updateProgress=()=>{
    const pct=queue.length?completed/queue.length*100:0;
    $('batchProgressBar').style.width=Math.max(0,Math.min(100,pct))+'%';

    const elapsed=(performance.now()-startedAt)/1000;
    const avg=completed?elapsed/completed:0;
    const left=Math.max(0,queue.length-completed);
    const eta=completed?Math.round(avg*left/Math.max(1,workers)):0;

    $('batchProgressText').textContent=
      `${completed}/${queue.length} selesai • ${workers} parallel`+
      (completed&&left?` • ETA ~${fmtMinuteSecond(eta)}`:'');
  };

  const worker=async(workerId)=>{
    while(!batchCancelled){
      const idx=nextIndex++;
      if(idx>=queue.length) return;

      const item=queue[idx];
      item.state='working';
      item.worker=workerId;
      renderBatchList();
      updateProgress();

      try{
        const out=await renderBatchClipBlobFast(item,settings);
        if(batchCancelled) return;

        const name=batchFilename(item,out.ext);

        if(directoryHandle){
          await writeBatchBlob(directoryHandle,name,out.blob);
        }else{
          const url=URL.createObjectURL(out.blob);
          const a=document.createElement('a');
          a.href=url;a.download=name;
          document.body.appendChild(a);a.click();a.remove();
          setTimeout(()=>URL.revokeObjectURL(url),5000);
          await new Promise(r=>setTimeout(r,300));
        }

        item.state='done';
        success++;
      }catch(err){
        if(batchCancelled) return;
        console.error('Batch worker error',workerId,item,err);
        item.state='error';
        item.lastError=String(err?.message||err);
        failed++;
      }finally{
        if(!batchCancelled){
          completed++;
          renderBatchList();
          updateProgress();
        }
      }
    }
  };

  try{
    updateBatchWorkerInfo();
    log(`Batch Turbo: ${workers} worker • ${settings.render.fps}fps • ${settings.render.scale}p profile.`);

    await Promise.all(
      Array.from({length:workers},(_,i)=>worker(i+1))
    );
  }finally{
    batchExporting=false;
    $('batchStopBtn').disabled=true;
    $('batchProgressBar').style.width=batchCancelled
      ? (queue.length?completed/queue.length*100:0)+'%'
      : '100%';

    const seconds=Math.round((performance.now()-startedAt)/1000);
    if(batchCancelled){
      $('batchProgressText').textContent=`Dihentikan • ${success} selesai • ${failed} gagal • ${fmtMinuteSecond(seconds)}`;
    }else{
      $('batchProgressText').textContent=`Selesai • ${success} berhasil • ${failed} gagal • ${fmtMinuteSecond(seconds)}`;
    }

    refreshBatchAvailability();
  }
};

setTimeout(()=>{
  updateBatchWorkerInfo();
  if(file) refreshBatchAvailability();
},500);


function applyDefaultBatchVisualSettings(){
  if($('batchHeadlineMode')) $('batchHeadlineMode').value='none';
  if($('batchSubtitle')) $('batchSubtitle').value='off';
  if($('videoY')){
    $('videoY').value='35';
    if($('videoYVal')) $('videoYVal').textContent='35%';
  }
  updateBatchWorkerInfo();
  refreshBatchAvailability();
}
applyDefaultBatchVisualSettings();
