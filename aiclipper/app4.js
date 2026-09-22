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

async function waitForYouTubeIframe(timeout=15000){
  const started=Date.now();

  // Pastikan player benar-benar dibuat.
  if(!ytPlayer || !ytPlayerReady){
    await ensureYouTubePlayer(ytVideoId);
  }

  while(Date.now()-started<timeout){
    let iframe=$('ytPlayerHost')?.querySelector('iframe');

    // YT.Player kadang mengganti host secara async; coba ambil iframe dari getIframe().
    if(!iframe){
      try{iframe=ytPlayer?.getIframe?.()||null;}catch(e){}
    }

    if(iframe?.contentWindow){
      return iframe;
    }

    // Jika player object hilang/remount, buat ulang sekali.
    if(!ytPlayer){
      try{await ensureYouTubePlayer(ytVideoId);}catch(e){}
    }

    await wait(120);
  }

  throw new Error('Player YouTube belum siap setelah menunggu 15 detik. Coba ulangi Cut.');
}

async function rawCaptureRequest(sel,index,total){
  const iframe=await waitForYouTubeIframe(15000);

  return new Promise((resolve,reject)=>{
    const requestId=`raw_${Date.now()}_${index}_${Math.random().toString(36).slice(2)}`;
    const timeoutMs=Math.max(30000,Math.ceil((Number(sel.end)-Number(sel.start)+25)*1000));

    const cleanup=()=>{
      clearTimeout(timer);
      window.removeEventListener('message',onMessage);
    };
    const onMessage=e=>{
      if(e.source!==iframe.contentWindow || !e.data || e.data.source!=='AI_CLIPPER_RAW_RESULT' || e.data.requestId!==requestId) return;
      cleanup();
      if(!e.data.ok){
        reject(new Error(e.data.error||'Raw capture gagal.'));
        return;
      }
      if(!(e.data.blob instanceof Blob) || !e.data.blob.size){
        reject(new Error('Raw capture menghasilkan file kosong.'));
        return;
      }
      resolve(e.data);
    };
    const timer=setTimeout(()=>{
      cleanup();
      reject(new Error('Raw capture timeout.'));
    },timeoutMs);

    window.addEventListener('message',onMessage);
    iframe.contentWindow.postMessage({
      source:'AI_CLIPPER_RAW_CAPTURE',
      type:'CAPTURE_SEGMENT',
      requestId,
      start:Number(sel.start||0),
      end:Number(sel.end||0),
      index,
      total
    },'*');
  });
}

async function recordOneYouTubeSegment(sel,index,total){
  status(`Raw Capture YouTube ${index+1}/${total}…`,Math.round(index/total*100));

  let r=null,lastErr=null;
  for(let attempt=1;attempt<=3;attempt++){
    try{
      r=await rawCaptureRequest(sel,index,total);
      break;
    }catch(e){
      lastErr=e;
      log(`Raw Capture retry ${attempt}/3: ${e?.message||e}`);
      if(attempt<3){
        try{await ensureYouTubePlayer(ytVideoId);}catch(err){}
        await wait(700);
      }
    }
  }
  if(!r) throw lastErr || new Error('Raw Capture gagal.');
  const blob=r.blob;
  const start=Number(sel.start||0),end=Number(sel.end||start);
  const dur=Math.max(.05,end-start);
  const ext=(String(r.mime||blob.type).includes('mp4'))?'mp4':'webm';
  const name=`YT_${String(index+1).padStart(2,'0')}_${fmtMinuteSecond(start).replace(':','-')}_${fmtMinuteSecond(end).replace(':','-')}.${ext}`;
  const f=new File([blob],name,{type:r.mime||blob.type||'video/webm'});
  const shiftedChunks=(sel.chunks||[]).map(c=>({...c,start:Math.max(0,c.start-start),end:Math.max(.01,c.end-start)}));
  const editSel={...sel,start:0,end:dur,chunks:shiftedChunks,text:sel.text,title:sel.title};
  return {file:f,selection:editSel,sourceSelection:sel,url:URL.createObjectURL(blob)};
}

async function pingRawCapture(){
  const iframe=$('ytPlayerHost').querySelector('iframe');
  if(!iframe?.contentWindow) throw new Error('YouTube iframe belum siap.');
  return new Promise((resolve,reject)=>{
    const requestId=`ping_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const onMessage=e=>{
      if(e.source!==iframe.contentWindow || !e.data || e.data.source!=='AI_CLIPPER_RAW_RESULT' || e.data.requestId!==requestId) return;
      cleanup();
      if(e.data.ok) resolve(e.data);
      else reject(new Error(e.data.error||'RAW capture belum siap.'));
    };
    const timer=setTimeout(()=>{cleanup();reject(new Error('Connector RAW Capture tidak terdeteksi di iframe YouTube.'));},4000);
    const cleanup=()=>{clearTimeout(timer);window.removeEventListener('message',onMessage);};
    window.addEventListener('message',onMessage);
    iframe.contentWindow.postMessage({
      source:'AI_CLIPPER_RAW_CAPTURE',
      type:'PING_RAW_CAPTURE',
      requestId
    },'*');
  });
}

async function captureYouTubeSelections(selections,{loadFirst=false}={}){
  if(!ytVideoId)throw new Error('Video YouTube belum siap.');

  status('Menyiapkan YouTube Player…',5);
  try{
    await ensureYouTubePlayer(ytVideoId);
    await waitForYouTubeIframe(15000);
  }catch(e){
    throw new Error('Gagal menyiapkan YouTube Player: '+(e?.message||e));
  }

  const ping=await bridgeRequest('YT_BRIDGE_PING',{},5000);
  if(!versionAtLeast(ping?.version,'1.5.3')){
    throw new Error('Raw Stream Capture membutuhkan AI Clipper Connector v1.5.3 atau lebih baru.');
  }
  const raw=await pingRawCapture();
  if(!raw?.ready){
    throw new Error('RAW video capture belum siap. Tunggu player YouTube selesai memuat lalu coba lagi.');
  }

  $('ytCaptureStage').style.display='block';
  $('ytCaptureBanner').style.display='block';
  $('ytCaptureBanner').innerHTML='<b>RAW STREAM CAPTURE</b><br>Yang direkam hanya stream video asli — UI YouTube tidak ikut.';
  $('ytCaptureBar').style.width='0%';
  ytCaptureAbort=false;

  try{
    const outputs=[];
    for(let i=0;i<selections.length;i++){
      if(ytCaptureAbort)break;
      const item=await recordOneYouTubeSegment(selections[i],i,selections.length);
      outputs.push(item);
      $('ytCaptureBar').style.width=`${Math.round(((i+1)/selections.length)*100)}%`;
    }

    ytBatchClips.push(...outputs);
    renderBatchClips();
    status(`Raw Capture selesai — ${outputs.length} clip.`,100);

    if(loadFirst && outputs[0]) await loadYouTubeCapturedClip(outputs[0]);
    return outputs;
  }finally{
    try{ytPlayer.pauseVideo()}catch(e){}
    $('ytCaptureStage').style.display='none';
    $('ytCaptureBanner').style.display='block';
    $('ytCaptureClose').style.display='block';
    $('ytCaptureBar').parentElement.style.display='block';
  }
}
$('ytCaptureClose').onclick=()=>{
  ytCaptureAbort=true;
  try{
    $('ytPlayerHost').querySelector('iframe')?.contentWindow?.postMessage({
      source:'AI_CLIPPER_RAW_CAPTURE',
      type:'CANCEL_CAPTURE'
    },'*');
  }catch(e){}
  try{ytPlayer?.pauseVideo()}catch(e){}
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