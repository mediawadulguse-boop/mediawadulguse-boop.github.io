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
async function recordOneYouTubeSegment(displayStream,sel,index,total){
  const start=Number(sel.start||0),end=Number(sel.end||start);
  const warmStart=Math.max(0,start-1.25);

  disableYouTubeCaptions();
  ytPlayer.pauseVideo();
  ytPlayer.seekTo(warmStart,true);
  await wait(300);
  disableYouTubeCaptions();
  ytPlayer.playVideo();

  const playing=await waitYTPlaying(6000);
  if(!playing) throw new Error('YouTube player tidak berhasil masuk mode playing.');

  // Tunggu sampai mendekati titik awal sambil video tetap berjalan.
  const warmDeadline=Date.now()+8000;
  while(Date.now()<warmDeadline && Number(ytPlayer.getCurrentTime()||0)<Math.max(0,start-.06)){
    if(ytCaptureAbort) throw new Error('Capture dibatalkan.');
    disableYouTubeCaptions();
    await wait(25);
  }

  const chunks=[];
  const mime=ytCaptureMime();
  const opts=mime?{mimeType:mime,videoBitsPerSecond:8_000_000,audioBitsPerSecond:192_000}:{videoBitsPerSecond:8_000_000,audioBitsPerSecond:192_000};
  const rec=new MediaRecorder(displayStream,opts);
  rec.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};
  const done=new Promise((res,rej)=>{rec.onstop=res;rec.onerror=e=>rej(e.error||e)});

  // UI capture tidak boleh ikut terekam.
  $('ytCaptureBanner').style.display='none';
  $('ytCaptureClose').style.display='none';
  $('ytCaptureBar').parentElement.style.display='none';

  // Recorder dimulai saat player SUDAH playing agar tidak merekam tombol Play.
  rec.start(250);

  while(!ytCaptureAbort && Number(ytPlayer.getCurrentTime())<end){
    disableYouTubeCaptions();
    const cur=Number(ytPlayer.getCurrentTime()||start);
    const frac=Math.max(0,Math.min(1,(cur-start)/Math.max(.01,end-start)));
    $('ytCaptureBar').style.width=`${((index+frac)/total)*100}%`;
    await wait(60);
  }

  if(rec.state!=='inactive')rec.stop();
  await done;
  ytPlayer.pauseVideo();

  if(ytCaptureAbort) throw new Error('Capture dibatalkan.');
  const blob=new Blob(chunks,{type:mime||'video/webm'});
  const dur=Math.max(.05,end-start);
  const name=`YT_${String(index+1).padStart(2,'0')}_${fmtMinuteSecond(start).replace(':','-')}_${fmtMinuteSecond(end).replace(':','-')}.webm`;
  const f=new File([blob],name,{type:blob.type||'video/webm'});
  const shiftedChunks=(sel.chunks||[]).map(c=>({...c,start:Math.max(0,c.start-start),end:Math.max(.01,c.end-start)}));
  const editSel={...sel,start:0,end:dur,chunks:shiftedChunks,text:sel.text,title:sel.title};
  return {file:f,selection:editSel,sourceSelection:sel,url:URL.createObjectURL(blob)};
}
async function captureYouTubeSelections(selections,{loadFirst=false}={}){
  if(!ytVideoId)throw new Error('Video YouTube belum siap.');
  if(!ytPlayerReady)throw new Error('Player YouTube belum siap. Tunggu beberapa detik lalu coba lagi.');
  if(!navigator.mediaDevices?.getDisplayMedia)throw new Error('Browser tidak mendukung tab capture.');

  $('ytCaptureStage').style.display='block';
  $('ytCaptureBanner').style.display='block';
  $('ytCaptureBar').style.width='0%';
  ytCaptureAbort=false;

  const stream=await navigator.mediaDevices.getDisplayMedia({
    video:{frameRate:{ideal:30,max:60}},
    audio:true,
    preferCurrentTab:true,
    selfBrowserSurface:'include',
    surfaceSwitching:'exclude'
  });
  const captureTrack=stream.getVideoTracks()[0];
  if(captureTrack) captureTrack.addEventListener('ended',()=>{ytCaptureAbort=true},{once:true});
  try{
    if(!stream.getAudioTracks().length){
      throw new Error('Audio tab tidak terbagi. Ulangi dan aktifkan "Bagikan audio tab".');
    }
    const outputs=[];
    for(let i=0;i<selections.length;i++){
      if(ytCaptureAbort)break;
      status(`Capture YouTube ${i+1}/${selections.length}…`,Math.round(i/selections.length*100));
      const item=await recordOneYouTubeSegment(stream,selections[i],i,selections.length);
      outputs.push(item);
    }
    ytBatchClips.push(...outputs);
    renderBatchClips();
    $('ytCaptureBar').style.width='100%';
    status(`Capture selesai — ${outputs.length} clip.`,100);
    if(loadFirst && outputs[0]) await loadYouTubeCapturedClip(outputs[0]);
    return outputs;
  }finally{
    stream.getTracks().forEach(t=>t.stop());
    try{ytPlayer.pauseVideo()}catch(e){}
    $('ytCaptureStage').style.display='none';
    $('ytCaptureBanner').style.display='block';
    $('ytCaptureClose').style.display='block';
    $('ytCaptureBar').parentElement.style.display='block';
  }
}
$('ytCaptureClose').onclick=()=>{ytCaptureAbort=true;try{ytPlayer?.pauseVideo()}catch(e){}};
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