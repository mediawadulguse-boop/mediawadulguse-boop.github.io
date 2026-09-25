let ytDetectTimer=null;
let ytDetectedInfo=null;
let ytDetectSeq=0;
let ytDetectPromise=null;
let ytDetectPromiseId='';
let ytActiveSourceId='';
const ytWebDetectCache=new Map();

function resetYouTubeDownloaderUI(){
  ytDetectedInfo=null;
  if($('ytDownloadPanel')) $('ytDownloadPanel').style.display='none';
  if($('ytDownloadMethod')) $('ytDownloadMethod').value='direct';
  if($('ytDirectQualitySelect')){
    $('ytDirectQualitySelect').innerHTML='<option value="">Mendeteksi kualitas…</option>';
    $('ytDirectQualitySelect').disabled=true;
  }
  if($('ytDownloadBtn')){
    $('ytDownloadBtn').disabled=true;
    $('ytDownloadBtn').textContent='Download Tanpa Capture';
  }
  if($('ytDownloadQuality')) $('ytDownloadQuality').textContent='-';
  if($('ytDownloadStatus')) $('ytDownloadStatus').textContent='Menunggu deteksi video…';
  if($('ytDownloadMode')) $('ytDownloadMode').textContent='Link terdeteksi → cek format direct → pilih kualitas → download.';
}

function resetYouTubeWorkStateForNewSource(id){
  if(!id || id===ytActiveSourceId) return;
  ytActiveSourceId=id;
  ytMetadata=null;
  ytDetectedInfo=null;

  transcript=[];
  candidates=[];
  selected=null;
  ytBatchSelected.clear();

  ytBatchClips.forEach(x=>{try{URL.revokeObjectURL(x.url)}catch(e){}});
  ytBatchClips=[];
  renderBatchClips();

  $('results').innerHTML='';
  $('count').textContent='0 kandidat';
  $('ytBatchBar').style.display='none';
  $('transcriptTools').style.display='none';
  $('transcriptOutput').value='';
  $('transcriptMeta').textContent='0 segmen';

  $('ytAnalyzeBtn').disabled=true;
  $('manualScriptCutBtn').disabled=true;
  $('manualTimeCutBtn').disabled=true;
  $('manualScriptStatus').textContent='Transcript belum tersedia';

  $('detail').style.display='none';
  $('detailEmpty').style.display='block';
  $('detailEmpty').textContent='Video terdeteksi. Transcript opsional untuk AI/Script; Manual Waktu bisa digunakan setelah durasi terbaca.';

  // Bersihkan editor clip lama agar state source YouTube baru tidak bercampur.
  file=null;
  try{video.pause()}catch(e){}
  video.removeAttribute('src');
  video.load();
  video.style.display='none';
  $('fileMeta').style.display='none';
}

function primeYouTubePreview(id){
  if(!id) return;
  resetYouTubeWorkStateForNewSource(id);
  ytVideoId=id;

  $('ytMeta').style.display='block';
  $('ytTitle').textContent='Mendeteksi video…';
  $('ytChannel').textContent='YouTube';
  $('ytDuration').textContent='--:--:--';
  $('ytTranscriptInfo').textContent='Transcript belum diperiksa';
  $('ytThumb').src=`https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

  $('ytDownloadPanel').style.display='block';
  $('ytDownloadBtn').disabled=true;
  $('ytDownloadQuality').textContent='…';
  $('ytDownloadStatus').textContent='Mendeteksi video dan kualitas…';
  $('ytDownloadMode').textContent='Memeriksa format video+audio direct.';
  $('ytDirectQualitySelect').innerHTML='<option value="">Mendeteksi kualitas…</option>';
  $('ytDirectQualitySelect').disabled=true;
}

function formatBytesShort(n){
  const v=Number(n||0);
  if(!v) return '';
  const mb=v/1024/1024;
  if(mb>=1024) return (mb/1024).toFixed(1)+' GB';
  return mb.toFixed(mb>=100?0:1)+' MB';
}

function populateDirectQualityOptions(r){
  const sel=$('ytDirectQualitySelect');
  if(!sel) return;
  const formats=Array.isArray(r?.directFormats)?r.directFormats:[];
  sel.innerHTML='';

  if(!formats.length){
    sel.innerHTML='<option value="">Tidak ada format direct</option>';
    sel.disabled=true;
    return;
  }

  for(const f of formats){
    const opt=document.createElement('option');
    opt.value=String(f.formatId||f.itag||'');
    const size=f.size?(' • '+formatBytesShort(f.size)):'';
    const type=String(f.ext||'').toUpperCase();
    opt.textContent=`${f.qualityLabel||((f.height||0)+'p')}${type?' • '+type:''}${size}`;
    sel.appendChild(opt);
  }
  sel.disabled=false;
}

function selectedDirectFormat(){
  const id=String($('ytDirectQualitySelect')?.value||'');
  return (ytDetectedInfo?.directFormats||[]).find(x=>String(x.formatId||x.itag||'')===id) || null;
}

function refreshDownloadMethodUI(){
  const method=$('ytDownloadMethod')?.value||'direct';
  const direct=selectedDirectFormat();
  const hasVideo=!!ytDetectedInfo?.metadata?.duration;

  if(method==='capture'){
    $('ytDirectQualitySelect').disabled=true;
    $('ytDownloadBtn').disabled=!hasVideo;
    $('ytDownloadBtn').textContent='Download via Capture Bersih';
    $('ytDownloadQuality').textContent='HD Capture';
    $('ytDownloadMode').textContent='Fallback eksplisit • merekam tab bersih real-time.';
    return;
  }

  populateDirectQualityOptions(ytDetectedInfo||{});
  const chosen=selectedDirectFormat();
  $('ytDownloadBtn').disabled=!chosen;
  $('ytDownloadBtn').textContent=chosen
    ? `Download Tanpa Capture ${chosen.qualityLabel||''}`.trim()
    : 'Download Tanpa Capture';

  if(chosen){
    $('ytDownloadQuality').textContent=`${chosen.qualityLabel||'Direct'} Tanpa Capture`;
    $('ytDownloadMode').textContent='Direct video+audio • tanpa playback • tanpa screen capture.';
  }else{
    $('ytDownloadQuality').textContent='Direct tidak tersedia';
    $('ytDownloadMode').textContent='Pilih Capture Bersih hanya jika Anda memang ingin memakai fallback.';
  }
}

function showDetectedYouTubeVideo(r){
  const meta=r?.metadata||{};
  ytVideoId=String(r?.videoId||ytVideoId||'');
  ytMetadata={
    ...(ytMetadata||{}),
    title:meta.title||'Video YouTube',
    channel:meta.channel||'-',
    duration:Number(meta.duration||0),
    thumbnail:meta.thumbnail||''
  };

  $('ytMeta').style.display='block';
  $('ytTitle').textContent=ytMetadata.title;
  $('ytChannel').textContent=ytMetadata.channel;
  $('ytDuration').textContent=fmtTime(ytMetadata.duration);
  if(!transcript.length) $('ytTranscriptInfo').textContent='Transcript opsional • belum tersedia';
  $('ytThumb').src=ytMetadata.thumbnail || `https://i.ytimg.com/vi/${ytVideoId}/hqdefault.jpg`;

  if(ytMetadata.duration>0){
    $('manualTimeCutBtn').disabled=false;
    setTypedTime('startHour','startMinute','startSecond',0);
    setTypedTime('endHour','endMinute','endSecond',Math.floor(ytMetadata.duration));
    refreshManualTimeStatus();
  }

  $('ytDownloadPanel').style.display='block';
  populateDirectQualityOptions(r);

  if(r.directReady && Array.isArray(r.directFormats) && r.directFormats.length){
    $('ytDownloadStatus').textContent=`✓ Video terdeteksi • ${r.directFormats.length} kualitas tanpa capture tersedia.`;
  }else{
    $('ytDownloadStatus').textContent='✓ Video terdeteksi • format direct video+audio tidak tersedia.';
  }

  refreshDownloadMethodUI();
}

function cacheDetectedInfo(id,r){
  ytWebDetectCache.set(id,{value:r,expiresAt:Date.now()+5*60*1000});
  while(ytWebDetectCache.size>12){
    const first=ytWebDetectCache.keys().next().value;
    ytWebDetectCache.delete(first);
  }
}

function getCachedDetectedInfo(id){
  const x=ytWebDetectCache.get(id);
  if(!x) return null;
  if(x.expiresAt<=Date.now()){
    ytWebDetectCache.delete(id);
    return null;
  }
  return x.value;
}

async function detectYouTubeVideo({silent=false,force=false}={}){
  const input=$('ytUrl');
  const id=extractYouTubeId(input?.value||'');
  const seq=++ytDetectSeq;

  if(!id){
    resetYouTubeDownloaderUI();
    if((input?.value||'').trim() && !silent){
      $('ytDownloadPanel').style.display='block';
      $('ytDownloadStatus').textContent='Link YouTube belum valid.';
    }
    return null;
  }

  primeYouTubePreview(id);

  const cached=!force?getCachedDetectedInfo(id):null;
  if(cached){
    if(seq===ytDetectSeq){
      ytDetectedInfo=cached;
      showDetectedYouTubeVideo(cached);
    }
    return cached;
  }

  // Dedupe: event paste + input tidak boleh membuka 2 tab deteksi untuk ID sama.
  if(ytDetectPromise && ytDetectPromiseId===id && !force){
    try{
      const r=await ytDetectPromise;
      if(seq===ytDetectSeq){
        ytDetectedInfo=r;
        showDetectedYouTubeVideo(r);
      }
      return r;
    }catch(e){
      if(!silent) log('DETECT VIDEO ERROR: '+(e?.message||e));
      return null;
    }
  }

  const request=(async()=>{
    const r=await bridgeRequest('YT_DETECT_VIDEO',{videoId:id},45000);
    cacheDetectedInfo(id,r);
    return r;
  })();

  ytDetectPromise=request;
  ytDetectPromiseId=id;

  try{
    const r=await request;
    if(seq!==ytDetectSeq) return r;
    ytDetectedInfo=r;
    showDetectedYouTubeVideo(r);
    log(`Video terdeteksi: ${r.metadata?.title||id} • ${r.directReady?r.directQuality||'HD Direct':'HD Capture'}`);
    return r;
  }catch(e){
    if(seq!==ytDetectSeq) return null;
    $('ytDownloadBtn').disabled=true;
    $('ytDownloadQuality').textContent='Gagal';
    $('ytDownloadStatus').textContent='Deteksi video gagal.';
    $('ytDownloadMode').textContent=String(e?.message||e);
    if(!silent) log('DETECT VIDEO ERROR: '+(e?.message||e));
    return null;
  }finally{
    if(ytDetectPromise===request){
      ytDetectPromise=null;
      ytDetectPromiseId='';
    }
  }
}

async function captureFullVideoToDisk(){
  const duration=Number(ytMetadata?.duration||ytDetectedInfo?.metadata?.duration||0);
  if(!duration) throw new Error('Durasi video belum terdeteksi.');
  if(!window.showSaveFilePicker) return false;

  const suggested=sanitizeFileName(ytMetadata?.title||'YouTube Video')+'.webm';
  let handle;
  try{
    handle=await window.showSaveFilePicker({
      suggestedName:suggested,
      types:[{
        description:'WebM Video',
        accept:{'video/webm':['.webm']}
      }]
    });
  }catch(e){
    if(e?.name==='AbortError') return true;
    throw e;
  }

  const ping=await bridgeRequest('YT_BRIDGE_PING',{},5000);
  if(!versionAtLeast(ping?.version,'1.6.0')){
    throw new Error('Capture Bersih membutuhkan Connector v1.6.0 atau lebih baru.');
  }

  status('Menyiapkan tab capture HD…',2);
  const prep=await bridgeRequest('YT_PREPARE_CLEAN_CAPTURE',{
    videoId:ytVideoId,
    start:0
  },30000);
  if(!prep?.sessionId) throw new Error('Connector tidak berhasil membuat tab capture.');

  activeCleanCaptureSession=prep.sessionId;
  ytCaptureAbort=false;
  let stream=null,writable=null,rec=null;
  let writeChain=Promise.resolve();

  try{
    stream=await getDisplayCaptureStream(prep.captureTitle||'AI CLIPPER CAPTURE');
    activeCleanCaptureStream=stream;
    writable=await handle.createWritable();

    $('ytCaptureBanner').innerHTML='<b>DOWNLOAD UTUH HD</b><br>Streaming langsung ke disk • RAM tetap ringan.';
    $('ytCaptureClose').style.display='block';

    await bridgeRequest('YT_CLEAN_CAPTURE_SEEK',{sessionId:prep.sessionId,start:0},12000);

    const mime=cleanCaptureMime();
    const opts=mime
      ? {mimeType:mime,videoBitsPerSecond:8_000_000,audioBitsPerSecond:192_000}
      : {videoBitsPerSecond:8_000_000,audioBitsPerSecond:192_000};

    rec=new MediaRecorder(stream,opts);
    rec.ondataavailable=e=>{
      if(!e.data?.size) return;
      const blob=e.data;
      writeChain=writeChain.then(()=>writable.write(blob));
    };
    const stopped=new Promise((res,rej)=>{rec.onstop=res;rec.onerror=e=>rej(e.error||e)});

    const play=await bridgeRequest('YT_CLEAN_CAPTURE_PLAY',{sessionId:prep.sessionId},8000);
    if(!play?.ok) throw new Error(play?.error||'Player capture tidak bisa diputar.');

    let started=false;
    const deadline=Date.now()+Math.max(60000,(duration+90)*1000);

    while(Date.now()<deadline && !ytCaptureAbort){
      const st=await bridgeRequest('YT_CLEAN_CAPTURE_STATUS',{sessionId:prep.sessionId},4000);
      const t=Number(st?.currentTime||0);

      if(!started && t>=0){
        rec.start(1000);
        started=true;
      }

      if(started){
        const p=Math.max(0,Math.min(100,(t/duration)*100));
        status(`Download utuh HD • ${fmtTime(t)} / ${fmtTime(duration)}`,p);
        $('ytCaptureBar').style.width=p+'%';
      }

      if(t>=duration-.1 || st?.ended) break;
      await wait(220);
    }

    try{await bridgeRequest('YT_CLEAN_CAPTURE_PAUSE',{sessionId:prep.sessionId},3000)}catch(e){}

    if(!started) throw new Error('Recorder tidak sempat mulai.');
    if(rec.state!=='inactive') rec.stop();
    await stopped;
    await writeChain;
    await writable.close();
    writable=null;

    if(ytCaptureAbort) throw new Error('Download dibatalkan.');

    status('Download utuh selesai.',100);
    $('ytDownloadStatus').textContent='✓ Video utuh selesai disimpan ke disk.';
    $('ytDownloadMode').textContent='Streaming Capture Bersih • RAM ringan.';
    return true;
  }catch(e){
    try{
      if(rec && rec.state!=='inactive') rec.stop();
    }catch(_){}
    try{await writeChain}catch(_){}
    try{await writable?.abort?.()}catch(_){}
    throw e;
  }finally{
    if(stream)stream.getTracks().forEach(t=>t.stop());
    activeCleanCaptureStream=null;
    if(activeCleanCaptureSession){
      try{await bridgeRequest('YT_CLOSE_CLEAN_CAPTURE',{sessionId:activeCleanCaptureSession},5000)}catch(e){}
    }
    activeCleanCaptureSession=null;
    $('ytCaptureStage').style.display='none';
  }
}

async function downloadFullVideoViaCapture(){
  const duration=Number(ytMetadata?.duration||ytDetectedInfo?.metadata?.duration||0);
  if(!duration) throw new Error('Durasi video belum terdeteksi.');

  // Jalur optimal: MediaRecorder chunks langsung ditulis ke disk.
  if(window.showSaveFilePicker){
    const handled=await captureFullVideoToDisk();
    if(handled) return;
  }

  if(duration>1800){
    const ok=confirm(
      `Video berdurasi ${fmtTime(duration)}. Browser ini tidak mendukung streaming langsung ke disk, sehingga mode fallback dapat memakai RAM besar. Lanjutkan?`
    );
    if(!ok) return;
  }

  const sel={
    start:0,
    end:duration,
    title:ytMetadata?.title||'YouTube Full Video',
    reason:'Download utuh HD via Capture Bersih',
    text:'',
    chunks:[],
    hook:0,curiosity:0,conflict:0,information:0,emotion:0,standalone:0,score:0,
    youtubeSource:true
  };

  const outputs=await captureYouTubeSelections([sel],{loadFirst:false});
  const item=outputs?.[0];
  if(!item) throw new Error('Capture video utuh tidak menghasilkan file.');

  const a=document.createElement('a');
  a.href=item.url;
  a.download=sanitizeFileName(ytMetadata?.title||'YouTube Video')+'.webm';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

$('ytDownloadMethod').addEventListener('change',refreshDownloadMethodUI);
$('ytDirectQualitySelect').addEventListener('change',refreshDownloadMethodUI);

$('ytDownloadBtn').onclick=async()=>{
  $('ytDownloadBtn').disabled=true;
  const method=$('ytDownloadMethod').value||'direct';

  try{
    let info=ytDetectedInfo;
    const id=extractYouTubeId($('ytUrl').value);
    if(!id) throw new Error('Link YouTube tidak valid.');

    if(!info || info.videoId!==id){
      info=await detectYouTubeVideo({force:true});
      if(!info) throw new Error('Video belum berhasil dideteksi.');
    }

    if(method==='capture'){
      $('ytDownloadStatus').textContent='Menyiapkan Capture Bersih HD…';
      await downloadFullVideoViaCapture();
      if(!$('ytDownloadStatus').textContent.includes('selesai')){
        $('ytDownloadStatus').textContent='✓ Video utuh selesai dibuat dan diunduh.';
        $('ytDownloadMode').textContent='Mode Capture Bersih selesai.';
      }
      return;
    }

    const chosen=selectedDirectFormat();
    if(!chosen){
      throw new Error('Format Tanpa Capture tidak tersedia untuk video ini. Pilih kualitas direct lain atau gunakan Capture Bersih secara manual.');
    }

    $('ytDownloadStatus').textContent=`Memulai download ${chosen.qualityLabel||'Direct'} tanpa capture…`;
    try{
      const r=await bridgeRequest('YT_DOWNLOAD_DIRECT',{
        videoId:id,
        formatId:String(chosen.formatId||chosen.itag||'')
      },30000);
      $('ytDownloadStatus').textContent=`✓ Download dimulai • ${r.quality||chosen.qualityLabel||'Direct'} • tanpa capture`;
      $('ytDownloadMode').textContent='Chrome sedang mengunduh file video+audio utuh langsung.';
      log(`Download tanpa capture dimulai: ${r.quality||chosen.qualityLabel||'Direct'}`);
    }catch(e){
      ytWebDetectCache.delete(id);
      $('ytDownloadStatus').textContent='Download direct gagal.';
      $('ytDownloadMode').textContent='Tidak dialihkan otomatis ke capture. Coba Deteksi ulang/kualitas lain, atau pilih Capture Bersih secara manual.';
      throw e;
    }
  }catch(e){
    console.error(e);
    alert('Download gagal: '+(e?.message||e));
  }finally{
    refreshDownloadMethodUI();
  }
};

$('ytUrl').addEventListener('input',()=>{
  clearTimeout(ytDetectTimer);
  const id=extractYouTubeId($('ytUrl').value);
  if(id) primeYouTubePreview(id);
  else resetYouTubeDownloaderUI();
  ytDetectTimer=setTimeout(()=>detectYouTubeVideo({silent:true}),500);
});

$('ytUrl').addEventListener('paste',()=>{
  clearTimeout(ytDetectTimer);
  ytDetectTimer=setTimeout(()=>detectYouTubeVideo({silent:true}),120);
});

$('sourceYoutubeBtn').addEventListener('click',()=>{
  const id=extractYouTubeId($('ytUrl').value);
  if(id) setTimeout(()=>detectYouTubeVideo({silent:true}),120);
});

setTimeout(()=>{
  if(sourceMode==='youtube' && extractYouTubeId($('ytUrl').value)){
    detectYouTubeVideo({silent:true});
  }
},700);
