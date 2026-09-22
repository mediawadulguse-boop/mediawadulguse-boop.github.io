function loadYouTubeAPI(){
  return new Promise((resolve,reject)=>{
    if(window.YT?.Player) return resolve();
    const existing=document.querySelector('script[data-ai-yt-api]');
    if(existing){
      const started=Date.now();
      const t=setInterval(()=>{if(window.YT?.Player){clearInterval(t);resolve()}else if(Date.now()-started>15000){clearInterval(t);reject(new Error('YouTube Player API timeout.'))}},100);
      return;
    }
    const s=document.createElement('script');s.src='https://www.youtube.com/iframe_api';s.dataset.aiYtApi='1';
    s.onerror=()=>reject(new Error('Gagal memuat YouTube Player API.'));
    document.head.appendChild(s);
    const prev=window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady=()=>{try{prev?.()}catch(e){} resolve();};
    setTimeout(()=>{if(window.YT?.Player)resolve()},3000);
  });
}
async function ensureYouTubePlayer(id){
  if(ytPlayer && ytVideoId===id && ytPlayerReady)return ytPlayer;
  await loadYouTubeAPI();
  ytVideoId=id;ytPlayerReady=false;
  if(ytPlayer){try{ytPlayer.destroy()}catch(e){} ytPlayer=null;}
  $('ytPlayerHost').innerHTML='';
  await new Promise((resolve,reject)=>{
    let done=false;
    ytPlayer=new YT.Player('ytPlayerHost',{
      videoId:id,
      width:'100%',height:'100%',
      playerVars:{controls:0,rel:0,playsinline:1,fs:0,disablekb:1,iv_load_policy:3,modestbranding:1,cc_load_policy:0},
      events:{
        onReady:()=>{ytPlayerReady=true;try{disableYouTubeCaptions()}catch(e){}done=true;resolve();},
        onError:e=>{if(!done){done=true;reject(new Error('YouTube Player error '+e.data));}}
      }
    });
    setTimeout(()=>{if(!done){done=true;reject(new Error('YouTube Player timeout.'));}},15000);
  });
  return ytPlayer;
}
function wait(ms){return new Promise(r=>setTimeout(r,ms))}
function disableYouTubeCaptions(){
  try{ytPlayer?.setOption?.('captions','track',{});}catch(e){}
  try{ytPlayer?.unloadModule?.('captions');}catch(e){}
  try{ytPlayer?.unloadModule?.('cc');}catch(e){}
}
async function waitYTPlaying(timeout=6000){
  const started=Date.now();
  while(Date.now()-started<timeout){
    try{
      if(ytPlayer?.getPlayerState?.()===1) return true;
    }catch(e){}
    await wait(50);
  }
  return false;
}
async function waitYTTime(target,timeout=7000){
  const started=Date.now();
  while(Date.now()-started<timeout){
    const t=Number(ytPlayer?.getCurrentTime?.()||0);
    if(Math.abs(t-target)<1.5 || t>=target)return;
    await wait(100);
  }
}
function ytCaptureMime(){
  const types=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
  return types.find(x=>MediaRecorder.isTypeSupported(x))||'';
}
function versionAtLeast(current,minimum){
  const a=String(current||'0').split('.').map(Number);
  const b=String(minimum||'0').split('.').map(Number);
  for(let i=0;i<Math.max(a.length,b.length);i++){
    const x=a[i]||0,y=b[i]||0;
    if(x>y)return true;
    if(x<y)return false;
  }
  return true;
}

function getDisplayCaptureStream(captureTitle){
  return new Promise((resolve,reject)=>{
    $('ytCaptureStage').style.display='block';
    $('ytCaptureBanner').style.display='block';
    $('ytCaptureBanner').innerHTML=`
      <b>CAPTURE TAB BERSIH SIAP</b><br>
      Klik tombol di bawah, lalu pilih tab <b>${escapeHtml(captureTitle||'AI CLIPPER CAPTURE')}</b>.<br>
      Aktifkan <b>Bagikan audio tab / Share tab audio</b>.<br>
      <button id="ytStartCleanCapture" class="btn good" type="button" style="margin-top:12px">Mulai Capture Bersih</button>
    `;
    $('ytCaptureClose').style.display='block';
    $('ytCaptureBar').parentElement.style.display='block';
    $('ytCaptureBar').style.width='0%';

    const btn=$('ytStartCleanCapture');
    btn.onclick=async()=>{
      btn.disabled=true;
      try{
        const stream=await navigator.mediaDevices.getDisplayMedia({
          video:{displaySurface:'browser',frameRate:{ideal:30,max:60}},
          audio:true,
          selfBrowserSurface:'exclude',
          surfaceSwitching:'exclude',
          monitorTypeSurfaces:'exclude'
        });

        const vt=stream.getVideoTracks()[0];
        const settings=vt?.getSettings?.()||{};
        if(settings.displaySurface && settings.displaySurface!=='browser'){
          stream.getTracks().forEach(t=>t.stop());
          throw new Error('Pilih TAB YouTube Capture, bukan Window atau Entire Screen.');
        }
        if(!stream.getAudioTracks().length){
          stream.getTracks().forEach(t=>t.stop());
          throw new Error('Audio tab belum dibagikan. Ulangi dan aktifkan "Share tab audio / Bagikan audio tab".');
        }
        resolve(stream);
      }catch(e){
        btn.disabled=false;
        reject(e);
      }
    };
  });
}

function cleanCaptureMime(){
  const types=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
  return types.find(x=>MediaRecorder.isTypeSupported(x))||'';
}

async function recordCleanTabSegment(displayStream,sessionId,sel,index,total){
  const start=Number(sel.start||0),end=Number(sel.end||start);
  const dur=Math.max(.05,end-start);

  status(`Capture Bersih ${index+1}/${total}…`,Math.round(index/total*100));
  await bridgeRequest('YT_CLEAN_CAPTURE_SEEK',{sessionId,start},12000);

  const chunks=[];
  const mime=cleanCaptureMime();
  const opts=mime
    ? {mimeType:mime,videoBitsPerSecond:8_000_000,audioBitsPerSecond:192_000}
    : {videoBitsPerSecond:8_000_000,audioBitsPerSecond:192_000};
  const rec=new MediaRecorder(displayStream,opts);
  rec.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};
  const stopped=new Promise((res,rej)=>{rec.onstop=res;rec.onerror=e=>rej(e.error||e)});

  let started=false;
  const play=await bridgeRequest('YT_CLEAN_CAPTURE_PLAY',{sessionId},8000);
  if(!play?.ok) throw new Error(play?.error||'Player capture tidak bisa diputar.');

  const deadline=Date.now()+Math.max(45000,(dur+75)*1000);
  while(Date.now()<deadline && !ytCaptureAbort){
    const st=await bridgeRequest('YT_CLEAN_CAPTURE_STATUS',{sessionId},4000);
    const t=Number(st?.currentTime||0);

    if(!started && t>=Math.max(0,start-.04)){
      rec.start(250);
      started=true;
    }

    if(started){
      const frac=Math.max(0,Math.min(1,(t-start)/Math.max(.01,dur)));
      $('ytCaptureBar').style.width=`${((index+frac)/total)*100}%`;
    }

    if(t>=end || st?.ended){
      break;
    }

    await wait(80);
  }

  try{await bridgeRequest('YT_CLEAN_CAPTURE_PAUSE',{sessionId},3000)}catch(e){}

  if(!started){
    throw new Error('Recorder tidak sempat mulai. Ulangi capture.');
  }
  if(rec.state!=='inactive')rec.stop();
  await stopped;

  if(ytCaptureAbort) throw new Error('Capture dibatalkan.');

  const blob=new Blob(chunks,{type:mime||'video/webm'});
  if(!blob.size) throw new Error('Capture menghasilkan file kosong.');

  const name=`YT_${String(index+1).padStart(2,'0')}_${fmtMinuteSecond(start).replace(':','-')}_${fmtMinuteSecond(end).replace(':','-')}.webm`;
  const f=new File([blob],name,{type:blob.type||'video/webm'});
  const shiftedChunks=(sel.chunks||[]).map(c=>({...c,start:Math.max(0,c.start-start),end:Math.max(.01,c.end-start)}));
  const editSel={...sel,start:0,end:dur,chunks:shiftedChunks,text:sel.text,title:sel.title};
  return {file:f,selection:editSel,sourceSelection:sel,url:URL.createObjectURL(blob)};
}

let activeCleanCaptureSession=null;
let activeCleanCaptureStream=null;

async function captureYouTubeSelections(selections,{loadFirst=false}={}){
  if(!ytVideoId)throw new Error('Video YouTube belum siap.');
  if(!navigator.mediaDevices?.getDisplayMedia)throw new Error('Browser tidak mendukung tab capture.');

  const ping=await bridgeRequest('YT_BRIDGE_PING',{},5000);
  if(!versionAtLeast(ping?.version,'1.6.0')){
    throw new Error('Metode Capture Bersih membutuhkan AI Clipper Connector v1.6.0 atau lebih baru.');
  }

  status('Menyiapkan tab capture bersih…',3);
  const prep=await bridgeRequest('YT_PREPARE_CLEAN_CAPTURE',{
    videoId:ytVideoId,
    start:Number(selections[0]?.start||0)
  },30000);

  if(!prep?.sessionId) throw new Error('Connector tidak berhasil membuat tab capture.');

  activeCleanCaptureSession=prep.sessionId;
  ytCaptureAbort=false;

  let stream=null;
  try{
    stream=await getDisplayCaptureStream(prep.captureTitle||'AI CLIPPER CAPTURE');
    activeCleanCaptureStream=stream;

    $('ytCaptureBanner').innerHTML='<b>CAPTURE BERSIH BERJALAN</b><br>UI YouTube sudah disembunyikan. Jangan tutup tab capture.';
    $('ytCaptureClose').style.display='block';

    const outputs=[];
    for(let i=0;i<selections.length;i++){
      if(ytCaptureAbort)break;
      const item=await recordCleanTabSegment(stream,prep.sessionId,selections[i],i,selections.length);
      outputs.push(item);
    }

    ytBatchClips.push(...outputs);
    renderBatchClips();
    $('ytCaptureBar').style.width='100%';
    status(`Capture Bersih selesai — ${outputs.length} clip.`,100);

    if(loadFirst && outputs[0]) await loadYouTubeCapturedClip(outputs[0]);
    return outputs;
  }finally{
    if(stream)stream.getTracks().forEach(t=>t.stop());
    activeCleanCaptureStream=null;
    if(activeCleanCaptureSession){
      try{await bridgeRequest('YT_CLOSE_CLEAN_CAPTURE',{sessionId:activeCleanCaptureSession},5000)}catch(e){}
    }
    activeCleanCaptureSession=null;
    $('ytCaptureStage').style.display='none';
    $('ytCaptureBanner').style.display='block';
    $('ytCaptureClose').style.display='block';
    $('ytCaptureBar').parentElement.style.display='block';
  }
}

$('ytCaptureClose').onclick=()=>{
  ytCaptureAbort=true;
  if(activeCleanCaptureStream){
    try{activeCleanCaptureStream.getTracks().forEach(t=>t.stop())}catch(e){}
  }
  if(activeCleanCaptureSession){
    bridgeRequest('YT_CLOSE_CLEAN_CAPTURE',{sessionId:activeCleanCaptureSession},3000).catch(()=>{});
  }
  $('ytCaptureStage').style.display='none';
};
$('ytCutBtn').onclick=async()=>{
  if(!selected)return;
  try{await captureYouTubeSelections([selected],{loadFirst:true})}
  catch(e){console.error(e);status('Capture gagal.',0);alert(e.message||e);$('ytCaptureStage').style.display='none';}
};
$('ytBatchCaptureBtn').onclick=async()=>{
  const indices=[...ytBatchSelected].sort((a,b)=>a-b);
  if(!indices.length)return alert('Centang minimal satu kandidat.');
  try{await captureYouTubeSelections(indices.map(i=>candidates[i]),{loadFirst:false})}
  catch(e){console.error(e);status('Batch capture gagal.',0);alert(e.message||e);$('ytCaptureStage').style.display='none';}
};
function renderBatchClips(){
  const root=$('ytBatchClips');root.innerHTML='';
  if(!ytBatchClips.length)return;
  const h=document.createElement('h3');h.textContent=`Hasil Batch (${ytBatchClips.length})`;root.appendChild(h);
  ytBatchClips.forEach((item,i)=>{
    const el=document.createElement('div');el.className='batchclip';
    el.innerHTML=`<div class="row" style="justify-content:space-between"><div><b>${escapeHtml(item.sourceSelection.title||item.file.name)}</b><div class="tiny">${fmtTime(item.sourceSelection.start)} → ${fmtTime(item.sourceSelection.end)} • ${fmtSize(item.file.size)}</div></div><div class="row"><button class="btn" data-edit-batch="${i}">Edit</button><button class="btn" data-download-batch="${i}">Download</button></div></div>`;
    root.appendChild(el);
  });
  root.querySelectorAll('[data-edit-batch]').forEach(b=>b.onclick=()=>loadYouTubeCapturedClip(ytBatchClips[Number(b.dataset.editBatch)]));
  root.querySelectorAll('[data-download-batch]').forEach(b=>b.onclick=()=>{
    const item=ytBatchClips[Number(b.dataset.downloadBatch)];
    const a=document.createElement('a');a.href=item.url;a.download=item.file.name;document.body.appendChild(a);a.click();a.remove();
  });
}
async function loadYouTubeCapturedClip(item){
  await setFile(item.file);
  video.style.display='block';
  transcript=item.selection.chunks?.length?item.selection.chunks:[{start:0,end:item.selection.end,text:item.selection.text||''}];
  candidates=[];
  sourceMode='youtube';
  item.selection.capturedClip=true;
  applySelection(item.selection);
  $('detailReason').textContent='Clip YouTube siap diedit • '+(item.sourceSelection.reason||'');
  $('ytCutBtn').style.display='none';
  $('previewBtn').disabled=false;
  $('subtitle').value='off';
  drawTemplatePreview();
  $('exportBox').style.display='block';
  status('Clip YouTube masuk editor.',100);
  log(`Editor YouTube: ${item.file.name}`);
}