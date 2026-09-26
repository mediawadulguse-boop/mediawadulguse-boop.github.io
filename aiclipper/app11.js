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

async function renderBatchClipBlob(item){
  if(!file) throw new Error('Video lokal belum dipilih.');

  const oldSelected=selected;
  const oldTemplate=$('clipTemplate').value;
  const oldRatio=$('ratio').value;
  const oldSubtitle=$('subtitle').value;
  const oldH1=$('headline1').value;
  const oldH2=$('headline2').value;

  const chunks=transcript.filter(c=>c.end>=item.start&&c.start<=item.end);
  selected=buildSelection(item.start,item.end,item.hook,'Batch import',chunks,video.duration);

  const template=$('batchTemplate').value;
  $('clipTemplate').value=template;
  $('ratio').value=$('batchRatio').value;
  $('subtitle').value=$('batchSubtitle').value;

  if($('batchHeadlineMode').value==='hook' && template==='editorial'){
    const [a,b]=splitBatchHeadline(item.hook);
    $('headline1').value=a;
    $('headline2').value=b;
  }

  try{
    applyAudioProfile();

    let ratio=$('ratio').value;
    if(template==='editorial') ratio='9:16';
    const [w,h]=template==='editorial'?[1080,1920]:dimensions(ratio,video.videoWidth,video.videoHeight);
    const canvas=$('renderCanvas');
    canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d');

    const canvasStream=canvas.captureStream(30);
    const sharedStream=await ensureSharedAudioGraph();
    sharedStream.getAudioTracks().forEach(t=>canvasStream.addTrack(t));

    const fmt=supportedMime();
    const recorderOptions=fmt.mime?{
      mimeType:fmt.mime,
      videoBitsPerSecond:7_000_000,
      audioBitsPerSecond:192_000
    }:{audioBitsPerSecond:192_000};

    const rec=new MediaRecorder(canvasStream,recorderOptions);
    const blobs=[];
    let clipCancelled=false;
    rec.ondataavailable=e=>{if(e.data?.size)blobs.push(e.data)};
    const done=new Promise((res,rej)=>{rec.onstop=res;rec.onerror=e=>rej(e.error||e)});
    rec.start(1000);

    video.currentTime=item.start;
    await new Promise((res,rej)=>{
      let doneSeek=false;
      const ok=()=>{if(doneSeek)return;doneSeek=true;cleanup();res()};
      const fail=()=>{if(doneSeek)return;doneSeek=true;cleanup();rej(new Error('Seek video gagal.'))};
      const cleanup=()=>{video.removeEventListener('seeked',ok);clearTimeout(timer)};
      video.addEventListener('seeked',ok,{once:true});
      const timer=setTimeout(fail,8000);
    });

    await video.play();

    await new Promise((resolve,reject)=>{
      let raf=0;
      const draw=()=>{
        if(batchCancelled){
          clipCancelled=true;
          video.pause();
          cancelAnimationFrame(raf);
          return resolve();
        }

        if(video.ended||video.currentTime>=item.end){
          video.pause();
          cancelAnimationFrame(raf);
          return resolve();
        }

        ctx.clearRect(0,0,w,h);
        if(template==='editorial'){
          drawEditorial(ctx,w,h,false,false);
        }else{
          ctx.fillStyle='#000';
          ctx.fillRect(0,0,w,h);
          drawCover(ctx,video,w,h);
        }
        raf=requestAnimationFrame(draw);
      };
      draw();
    });

    if(outroFile){
      outroVideo.currentTime=0;
      await new Promise(res=>{
        if(outroVideo.readyState>=1)return res();
        outroVideo.onloadedmetadata=res;
      });
      await outroVideo.play();

      await new Promise(resolve=>{
        let raf=0;
        const draw=()=>{
          if(batchCancelled){
            outroVideo.pause();
            cancelAnimationFrame(raf);
            return resolve();
          }
          if(outroVideo.ended||outroVideo.paused){
            outroVideo.pause();
            cancelAnimationFrame(raf);
            return resolve();
          }
          ctx.clearRect(0,0,w,h);
          ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);
          drawCover(ctx,outroVideo,w,h);
          raf=requestAnimationFrame(draw);
        };
        draw();
      });
    }

    if(rec.state!=='inactive') rec.stop();
    await done;

    if(clipCancelled || batchCancelled) throw new Error('Batch dibatalkan.');

    return {
      blob:new Blob(blobs,{type:fmt.mime||'video/webm'}),
      ext:fmt.ext
    };
  }finally{
    try{video.pause();outroVideo.pause()}catch(e){}
    selected=oldSelected;
    $('clipTemplate').value=oldTemplate;
    $('ratio').value=oldRatio;
    $('subtitle').value=oldSubtitle;
    $('headline1').value=oldH1;
    $('headline2').value=oldH2;
  }
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

$('batchStopBtn').onclick=()=>{
  batchCancelled=true;
  $('batchProgressText').textContent='Menghentikan setelah clip saat ini…';
};

$('batchExportBtn').onclick=async()=>{
  if(batchExporting) return;

  const queue=batchSelectedRows();
  if(!file) return alert('Upload video lokal terlebih dahulu.');
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

  batchExporting=true;
  batchCancelled=false;
  $('batchExportBtn').disabled=true;
  $('batchStopBtn').disabled=false;

  let success=0,failed=0;

  try{
    for(let i=0;i<queue.length;i++){
      if(batchCancelled) break;

      const item=queue[i];
      item.state='working';
      renderBatchList();

      const pct=(i/queue.length)*100;
      $('batchProgressBar').style.width=pct+'%';
      $('batchProgressText').textContent=`Clip ${i+1}/${queue.length} • ${item.hook}`;

      try{
        const out=await renderBatchClipBlob(item);
        const name=batchFilename(item,out.ext);

        if(directoryHandle){
          await writeBatchBlob(directoryHandle,name,out.blob);
        }else{
          const url=URL.createObjectURL(out.blob);
          const a=document.createElement('a');
          a.href=url;a.download=name;
          document.body.appendChild(a);a.click();a.remove();
          setTimeout(()=>URL.revokeObjectURL(url),5000);
          await new Promise(r=>setTimeout(r,250));
        }

        item.state='done';
        success++;
      }catch(err){
        console.error('Batch clip error',item,err);
        item.state='error';
        item.lastError=String(err?.message||err);
        failed++;
        if(batchCancelled) break;
      }

      renderBatchList();
    }
  }finally{
    batchExporting=false;
    $('batchStopBtn').disabled=true;
    $('batchProgressBar').style.width='100%';

    if(batchCancelled){
      $('batchProgressText').textContent=`Dihentikan • ${success} selesai • ${failed} gagal`;
    }else{
      $('batchProgressText').textContent=`Selesai • ${success} berhasil • ${failed} gagal`;
    }

    refreshBatchAvailability();
  }
};

setTimeout(()=>{
  if(file) refreshBatchAvailability();
},500);
