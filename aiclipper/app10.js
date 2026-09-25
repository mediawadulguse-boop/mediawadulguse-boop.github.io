let ytDetectTimer=null;
let ytDetectedInfo=null;
let ytDetectSeq=0;

function resetYouTubeDownloaderUI(){
  ytDetectedInfo=null;
  if($('ytDownloadPanel')) $('ytDownloadPanel').style.display='none';
  if($('ytDownloadBtn')){
    $('ytDownloadBtn').disabled=true;
    $('ytDownloadBtn').textContent='Download Utuh HD';
  }
  if($('ytDownloadQuality')) $('ytDownloadQuality').textContent='-';
  if($('ytDownloadStatus')) $('ytDownloadStatus').textContent='Menunggu deteksi video…';
  if($('ytDownloadMode')) $('ytDownloadMode').textContent='Link terdeteksi → cek kualitas → siap download.';
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
  if(!transcript.length) $('ytTranscriptInfo').textContent='Transcript belum diperiksa';
  $('ytThumb').src=ytMetadata.thumbnail || `https://i.ytimg.com/vi/${ytVideoId}/hqdefault.jpg`;

  if(ytMetadata.duration>0){
    $('manualTimeCutBtn').disabled=false;
    setTypedTime('startHour','startMinute','startSecond',0);
    setTypedTime('endHour','endMinute','endSecond',Math.floor(ytMetadata.duration));
    refreshManualTimeStatus();
  }

  $('ytDownloadPanel').style.display='block';
  $('ytDownloadBtn').disabled=false;

  if(r.directReady){
    $('ytDownloadQuality').textContent=r.directQuality||'HD';
    $('ytDownloadStatus').textContent='✓ Video terdeteksi • siap download langsung.';
    $('ytDownloadMode').textContent=`Mode Direct • ${r.directQuality||'HD'} • video + audio utuh`;
    $('ytDownloadBtn').textContent=`Download Utuh ${r.directQuality||'HD'}`;
  }else{
    $('ytDownloadQuality').textContent='HD Capture';
    $('ytDownloadStatus').textContent='✓ Video terdeteksi • HD tersedia via Capture Bersih.';
    $('ytDownloadMode').textContent='Fallback HD real-time • dipakai jika direct HD dibatasi YouTube.';
    $('ytDownloadBtn').textContent='Download Utuh HD';
  }
}

async function detectYouTubeVideo({silent=false}={}){
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

  ytVideoId=id;
  $('ytDownloadPanel').style.display='block';
  $('ytDownloadBtn').disabled=true;
  $('ytDownloadQuality').textContent='…';
  $('ytDownloadStatus').textContent='Mendeteksi video dan kualitas…';
  $('ytDownloadMode').textContent='Memeriksa metadata + jalur download HD.';

  try{
    const r=await bridgeRequest('YT_DETECT_VIDEO',{videoId:id},45000);
    if(seq!==ytDetectSeq) return null;
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
  }
}

async function downloadFullVideoViaCapture(){
  const duration=Number(ytMetadata?.duration||ytDetectedInfo?.metadata?.duration||0);
  if(!duration) throw new Error('Durasi video belum terdeteksi.');

  if(duration>2700){
    const ok=confirm(
      `Video berdurasi ${fmtTime(duration)}. Mode Capture Bersih berjalan real-time dan memakai memori cukup besar. Lanjutkan?`
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

$('ytDownloadBtn').onclick=async()=>{
  $('ytDownloadBtn').disabled=true;
  const oldText=$('ytDownloadBtn').textContent;

  try{
    let info=ytDetectedInfo;
    const id=extractYouTubeId($('ytUrl').value);
    if(!id) throw new Error('Link YouTube tidak valid.');

    if(!info || info.videoId!==id){
      info=await detectYouTubeVideo();
      if(!info) throw new Error('Video belum berhasil dideteksi.');
    }

    if(info.directReady){
      $('ytDownloadStatus').textContent='Memulai download HD langsung…';
      const r=await bridgeRequest('YT_DOWNLOAD_DIRECT',{videoId:id},30000);
      $('ytDownloadStatus').textContent=`✓ Download dimulai • ${r.quality||info.directQuality||'HD'}`;
      $('ytDownloadMode').textContent='Chrome sedang mengunduh file video utuh.';
      log(`Download langsung dimulai: ${r.quality||info.directQuality||'HD'}`);
    }else{
      $('ytDownloadStatus').textContent='Menyiapkan Capture Bersih HD…';
      await downloadFullVideoViaCapture();
      $('ytDownloadStatus').textContent='✓ Video utuh selesai dibuat dan diunduh.';
      $('ytDownloadMode').textContent='Mode Capture Bersih selesai.';
    }
  }catch(e){
    console.error(e);
    $('ytDownloadStatus').textContent='Download gagal.';
    $('ytDownloadMode').textContent=String(e?.message||e);
    alert('Download gagal: '+(e?.message||e));
  }finally{
    $('ytDownloadBtn').disabled=false;
    if($('ytDownloadBtn').textContent==='Download Utuh HD' || $('ytDownloadBtn').textContent.startsWith('Download Utuh')){}
    else $('ytDownloadBtn').textContent=oldText;
  }
};

$('ytUrl').addEventListener('input',()=>{
  clearTimeout(ytDetectTimer);
  resetYouTubeDownloaderUI();
  ytDetectTimer=setTimeout(()=>detectYouTubeVideo({silent:true}),650);
});

$('ytUrl').addEventListener('paste',()=>{
  clearTimeout(ytDetectTimer);
  ytDetectTimer=setTimeout(()=>detectYouTubeVideo({silent:true}),100);
});

$('sourceYoutubeBtn').addEventListener('click',()=>{
  if(extractYouTubeId($('ytUrl').value)) setTimeout(()=>detectYouTubeVideo({silent:true}),150);
});

// Deteksi otomatis jika halaman dibuka ulang dengan URL YouTube yang masih tersimpan browser.
setTimeout(()=>{
  if(sourceMode==='youtube' && extractYouTubeId($('ytUrl').value)){
    detectYouTubeVideo({silent:true});
  }
},900);
