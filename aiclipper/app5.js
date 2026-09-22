async function ensureTranscriptOnly(){
  if(transcript.length) return transcript;
  if(!file) throw new Error('Pilih video terlebih dahulu.');
  $('manualScriptCutBtn').disabled=true;
  try{
    status('Menyiapkan transcript untuk script cut…',10);
    const audio=await decodeAudio16k(file);
    const pipe=await loadWhisper();
    status('Whisper mentranskripsi video…',45);
    const out=await pipe(audio,{language:'indonesian',task:'transcribe',return_timestamps:true,chunk_length_s:30,stride_length_s:5});
    transcript=(out.chunks||[]).map(x=>({
      start:Number(x.timestamp?.[0]||0),
      end:Number(x.timestamp?.[1]??x.timestamp?.[0]??0)+0.01,
      text:String(x.text||'').trim()
    })).filter(x=>x.text);
    if(!transcript.length && out.text){
      transcript=[{start:0,end:video.duration||30,text:out.text.trim()}];
    }
    $('manualScriptStatus').textContent=`Transcript siap: ${transcript.length} segmen`;
    status('Transcript siap.',100);
    return transcript;
  }finally{
    $('manualScriptCutBtn').disabled=false;
  }
}

$('manualTimeCutBtn').onclick=()=>{
  try{
    if(!file) throw new Error('Pilih video terlebih dahulu.');
    const start=readTypedTime('startMinute','startSecond');
    const end=readTypedTime('endMinute','endSecond');
    if(Number.isNaN(start)||Number.isNaN(end)){
      throw new Error('Nilai waktu tidak valid. Detik harus berada pada 0–59 dan semua field harus berupa angka bulat.');
    }
    if(start<0 || end>video.duration+0.05){
      throw new Error(`Waktu berada di luar durasi video (${fmtTime(video.duration)}).`);
    }
    if(end-start<0.5){
      throw new Error('Durasi clip terlalu pendek. Gunakan minimal 0,5 detik.');
    }
    const sel=buildSelection(start,end,'Manual Cut','Dipilih manual berdasarkan waktu awal dan akhir');
    applySelection(sel);
    $('manualTimeStatus').textContent=`${fmtTime(start)} → ${fmtTime(end)}`;
    status('Manual cut siap.',100);
  }catch(e){
    alert(e.message||e);
  }
};

$('manualScriptCutBtn').onclick=async()=>{
  try{
    if(!file) throw new Error('Pilih video terlebih dahulu.');
    const query=$('scriptQueryTop').value.trim();
    if(!query) throw new Error('Masukkan script atau kalimat terlebih dahulu.');
    $('manualScriptStatus').textContent='Menyiapkan transcript…';
    await ensureTranscriptOnly();
    const sel=findSelectionFromScript(query);
    applySelection(sel);
    $('manualScriptStatus').textContent=`Ditemukan: ${fmtTime(sel.start)} → ${fmtTime(sel.end)}`;
    status('Script cut siap.',100);
  }catch(e){
    $('manualScriptStatus').textContent='Gagal';
    alert(e.message||e);
  }
};

$('analyzeBtn').onclick=async()=>{
  if(!file)return;
  $('analyzeBtn').disabled=true;resetAnalysis();$('detailEmpty').textContent='Sedang menganalisis…';
  try{
    const audio=await decodeAudio16k(file);
    const pipe=await loadWhisper();
    status('Whisper mentranskripsi video…',42);log('Transkripsi dimulai. Waktu proses tergantung durasi video dan GPU/CPU.');
    const out=await pipe(audio,{language:'indonesian',task:'transcribe',return_timestamps:true,chunk_length_s:30,stride_length_s:5});
    status('Menyusun timestamp…',78);
    transcript=(out.chunks||[]).map(x=>({start:Number(x.timestamp?.[0]||0),end:Number(x.timestamp?.[1]??x.timestamp?.[0]??0)+0.01,text:String(x.text||'').trim()})).filter(x=>x.text);
    if(!transcript.length && out.text) transcript=[{start:0,end:video.duration||30,text:out.text.trim()}];\n    refreshTranscriptPanel();
    log(`Transcript: ${transcript.length} segmen.`);
    status('Menilai potensi viral…',88);
    candidates=makeCandidates(transcript);
    renderResults();
    status(`Selesai — ${candidates.length} kandidat ditemukan.`,100);
    log('Analisis selesai.');
  }catch(e){
    console.error(e);status('Gagal.',0);log('ERROR: '+(e?.message||e));alert(e?.message||String(e));
    $('detailEmpty').textContent='Analisis gagal. Lihat log di sebelah kiri.';
  }finally{$('analyzeBtn').disabled=false;}
};

$('previewBtn').onclick=async()=>{
  if(!selected||!file)return;
  if(previewTimer)clearInterval(previewTimer);
  video.currentTime=selected.start;
  await video.play();
  previewTimer=setInterval(()=>{if(video.currentTime>=selected.end||video.paused){video.pause();clearInterval(previewTimer);previewTimer=null;}},100);
};