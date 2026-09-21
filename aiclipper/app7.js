async function playCustomPreview(){
  if(!selected){ alert('Pilih kandidat atau buat manual cut terlebih dahulu.'); return; }
  $('previewFrame').style.display='block';
  const canvas=$('templatePreview'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;

  if(customPreviewTimer){ cancelAnimationFrame(customPreviewTimer); customPreviewTimer=null; }
  try{ await ensureSharedAudioGraph(); }catch(e){ console.warn('Audio preview fallback:', e); }

  try{ video.pause(); outroVideo.pause(); }catch(e){}

  const template=$('clipTemplate').value;
  const start=selected.start,end=selected.end;
  let phase='intro';
  const introSecs=Number($('introPoster').value||0);
  const posterOutroSecs=Number($('outroPoster').value||0);
  let phaseStart=performance.now();

  video.currentTime=start;
  await new Promise(r=>video.onseeked=r);

  const drawFrame=()=>{
    if(template==='editorial'){
      if(phase==='intro' || phase==='posterOutro'){
        drawEditorial(ctx,w,h,true,false);
      }else if(phase==='main'){
        drawEditorial(ctx,w,h,false,false);
      }else if(phase==='fileOutro'){
        ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);
        if(outroVideo.readyState>=2) drawCover(ctx,outroVideo,w,h);
      }
    }else{
      ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);
      if(phase==='main' && video.readyState>=2) drawCover(ctx,video,w,h);
      else if(phase==='fileOutro' && outroVideo.readyState>=2) drawCover(ctx,outroVideo,w,h);
    }
  };

  const switchToMain=async()=>{
    phase='main'; phaseStart=performance.now();
    video.currentTime=start;
    await video.play().catch(()=>{});
  };

  if(introSecs<=0) await switchToMain();

  const loop=async()=>{
    drawFrame();

    if(phase==='intro'){
      if((performance.now()-phaseStart)/1000>=introSecs){
        await switchToMain();
      }
    }else if(phase==='main'){
      if(video.currentTime>=end || video.ended){
        video.pause();
        if(posterOutroSecs>0){
          phase='posterOutro'; phaseStart=performance.now();
        }else if(outroFile){
          phase='fileOutro'; phaseStart=performance.now();
          outroVideo.currentTime=0;
          await outroVideo.play().catch(()=>{});
        }else{
          phase='done';
        }
      }
    }else if(phase==='posterOutro'){
      if((performance.now()-phaseStart)/1000>=posterOutroSecs){
        if(outroFile){
          phase='fileOutro'; phaseStart=performance.now();
          outroVideo.currentTime=0;
          await outroVideo.play().catch(()=>{});
        }else phase='done';
      }
    }else if(phase==='fileOutro'){
      if(outroVideo.ended){
        outroVideo.pause();
        phase='done';
      }
    }else if(phase==='done'){
      return;
    }

    customPreviewTimer=requestAnimationFrame(loop);
  };
  loop();
}
$('previewCustomBtn').onclick=()=>playCustomPreview();

async function renderPosterPhase(ctx,w,h,seconds){
  if(seconds<=0)return;
  const start=performance.now();
  return new Promise(resolve=>{
    const frame=()=>{
      if($('clipTemplate').value==='editorial')drawEditorial(ctx,w,h,true,false);
      else{ctx.fillStyle='#000';ctx.fillRect(0,0,w,h); if(video.readyState>=2)drawCover(ctx,video,w,h)}
      if(performance.now()-start>=seconds*1000)return resolve();
      requestAnimationFrame(frame);
    };frame();
  });
}

$('exportBtn').onclick=async()=>{
  if(!selected||!file)return;
  if(!video.captureStream || !HTMLCanvasElement.prototype.captureStream || !window.MediaRecorder){
    return alert('Browser ini belum mendukung export lokal. Gunakan Chrome/Edge terbaru.');
  }
  $('exportBtn').disabled=true;
  try{
    $('exportTitle').value=sanitizeFileName($('exportTitle').value);
    const template=$('clipTemplate').value,sub=$('subtitle').value==='on';
    applyAudioProfile();
    log(`Audio export: ${$('audioProfile').selectedOptions[0]?.textContent || $('audioProfile').value}`);
    let ratio=$('ratio').value;
    if(template==='editorial')ratio='9:16';
    const [w,h]=template==='editorial'?[1080,1920]:dimensions(ratio,video.videoWidth,video.videoHeight);
    const canvas=$('renderCanvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');
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
    const blobs=[];rec.ondataavailable=e=>{if(e.data.size)blobs.push(e.data)};
    const done=new Promise((res,rej)=>{rec.onstop=res;rec.onerror=e=>rej(e.error||e)});
    rec.start(1000);

    const intro=Number($('introPoster').value||0),posterOutro=Number($('outroPoster').value||0);

    if(intro>0){status('Membuat intro poster…',3);await renderPosterPhase(ctx,w,h,intro)}

    video.currentTime=selected.start;
    await new Promise(r=>video.onseeked=r);
    await video.play();
    status('Merekam clip utama…',10);
    const start=selected.start,end=selected.end;

    await new Promise(resolve=>{
      const draw=()=>{
        if(video.ended||video.currentTime>=end){
          video.pause();return resolve();
        }
        ctx.clearRect(0,0,w,h);
        if(template==='editorial'){
          drawEditorial(ctx,w,h,false,false);
        }else{
          ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);drawCover(ctx,video,w,h);
          if(sub){
            const s=subtitleAt(video.currentTime);
            if(s){
              ctx.font=`700 ${Math.max(22,Math.round(w/26))}px Arial`;
              ctx.textAlign='center';ctx.textBaseline='middle';
              const lines=wrapText(ctx,s,w*.82,3),lh=Math.round(w/22),boxH=lines.length*lh+30,cy=h-Math.max(85,h*.10);
              ctx.fillStyle='rgba(0,0,0,.62)';ctx.fillRect(w*.07,cy-boxH/2,w*.86,boxH);
              ctx.fillStyle='#fff';ctx.strokeStyle='#000';ctx.lineWidth=4;
              lines.forEach((ln,i)=>{const yy=cy-(lines.length-1)*lh/2+i*lh;ctx.strokeText(ln,w/2,yy);ctx.fillText(ln,w/2,yy)});
            }
          }
        }
        const p=(video.currentTime-start)/(end-start)*70+10;status('Merekam clip utama…',Math.min(80,p));
        requestAnimationFrame(draw);
      };draw();
    });

    if(posterOutro>0){status('Membuat poster outro…',84);await renderPosterPhase(ctx,w,h,posterOutro)}

    if(outroFile){
      status('Menambahkan file outro…',90);
      outroVideo.currentTime=0;
      await new Promise(r=>outroVideo.onseeked=r);
      await outroVideo.play();
      await new Promise(resolve=>{
        const draw=()=>{
          if(outroVideo.ended||outroVideo.paused){
            outroVideo.pause(); return resolve();
          }
          ctx.clearRect(0,0,w,h);
          ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);
          drawCover(ctx,outroVideo,w,h);
          requestAnimationFrame(draw);
        };draw();
      });
    }

    if(rec.state!=='inactive')rec.stop();
    await done;

    const blob=new Blob(blobs,{type:fmt.mime||'video/webm'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    const safeTitle=sanitizeFileName($('exportTitle').value);
    $('exportTitle').value=safeTitle;
    a.href=url;a.download=`${safeTitle}.${fmt.ext}`;
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),5000);
    status('Export selesai.',100);
  }catch(e){
    console.error(e);alert('Export gagal: '+(e?.message||e));status('Export gagal.',0);
  }finally{
    try{video.pause();outroVideo.pause();}catch(e){}
    $('exportBtn').disabled=false;
  }
};

$('exportTitle').addEventListener('input',()=>{ exportTitleUserEdited=true; });
$('exportTitle').addEventListener('blur',()=>{ $('exportTitle').value=sanitizeFileName($('exportTitle').value); });

if(location.protocol==='file:'){
  document.body.innerHTML=`<div style="max-width:720px;margin:80px auto;padding:24px;font:16px Arial;background:#111722;color:#fff;border-radius:18px">
    <h1>AI Clipper v1.5.0</h1>
    <p>Versi Simple Direct berjalan melalui halaman web agar koneksi ke Connector stabil.</p>
    <p><b>Klik icon AI Clipper Connector → Buka AI Clipper.</b></p>
  </div>`;
}else{
  setSourceMode('local');
  setTimeout(checkYouTubeBridge,400);
}
const gpu=!!navigator.gpu;
$('compat').textContent=gpu?'✓ WebGPU tersedia':'CPU/WASM mode';
if(!window.MediaRecorder) $('compat').textContent+=' • Export tidak didukung';