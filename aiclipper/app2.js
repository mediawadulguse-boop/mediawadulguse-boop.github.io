async function setFile(f){
  if(!f||!f.type.startsWith('video/')) return alert('Pilih file video.');
  resetAnalysis();
  exportTitleUserEdited=false;
  if($('exportTitle')) $('exportTitle').value='AIClip';
  file=f;
  if(objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl=URL.createObjectURL(f);
  video.src=objectUrl;
  await new Promise(res=>{video.onloadedmetadata=res});
  $('fileMeta').style.display='block';
  $('fileMeta').innerHTML=`<b>${escapeHtml(f.name)}</b> &nbsp; • &nbsp; ${fmtSize(f.size)} &nbsp; • &nbsp; ${fmtTime(video.duration)}`;
  $('analyzeBtn').disabled=false;
  $('manualScriptCutBtn').disabled=false;
  $('manualTimeCutBtn').disabled=false;
  $('manualScriptStatus').textContent='Siap';
  setTypedTime('startMinute','startSecond',0);
  setTypedTime('endMinute','endSecond',Math.floor(video.duration||0));
  refreshManualTimeStatus();

  $('detailEmpty').textContent='Video siap. Klik Analisis AI.';
  if(f.size>1.5*1024**3) log('Catatan: video >1.5 GB dapat menggunakan RAM besar di browser.');
}

function resetAnalysis(){
  transcript=[];candidates=[];selected=null;
  try{video.pause();outroVideo.pause();}catch(e){}
  if(customPreviewTimer){cancelAnimationFrame(customPreviewTimer);customPreviewTimer=null;}
  $('results').innerHTML='';$('count').textContent='0 kandidat';$('detail').style.display='none';$('detailEmpty').style.display='block';\n  if($('transcriptTools')) $('transcriptTools').style.display='none';
  $('log').textContent='';status('Siap.',0);
}
function hardReset(){
  resetAnalysis(); file=null;
  ytBatchSelected.clear();
  ytBatchClips.forEach(x=>{try{URL.revokeObjectURL(x.url)}catch(e){}});
  ytBatchClips=[];renderBatchClips();
  if($('exportTitle')) $('exportTitle').value='AIClip';
  exportTitleUserEdited=false;
  try{video.pause();outroVideo.pause();}catch(e){}
  $('fileMeta').style.display='none'; $('analyzeBtn').disabled=true;
  $('manualScriptCutBtn').disabled=true; $('manualTimeCutBtn').disabled=true;
  $('manualScriptStatus').textContent='Video belum dipilih';
  setTypedTime('startMinute','startSecond',0);
  setTypedTime('endMinute','endSecond',0);
  refreshManualTimeStatus();
  video.removeAttribute('src');video.load();
  if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=null;
}

$('pickBtn').onclick=()=>$('fileInput').click();
$('fileInput').onchange=e=>setFile(e.target.files[0]);
$('model').addEventListener('change',async()=>{
  if(transcriber){ try{await transcriber.dispose?.();}catch(e){} }
  transcriber=null; transcriberKey='';
});
$('device').addEventListener('change',async()=>{
  if(transcriber){ try{await transcriber.dispose?.();}catch(e){} }
  transcriber=null; transcriberKey='';
});
$('audioProfile').addEventListener('change',applyAudioProfile);
$('resetBtn').onclick=hardReset;
$('manualResetBtn').onclick=()=>{
  $('scriptQueryTop').value='';
  setTypedTime('startMinute','startSecond',0);
  setTypedTime('endMinute','endSecond',file?Math.floor(video.duration||0):0);
  $('manualScriptStatus').textContent=file?'Siap':'Video belum dipilih';
  refreshManualTimeStatus();
};

function setClipperMethod(method){
  clipperMethod=method;
  const isAI=method==='ai';
  $('methodAI').classList.toggle('active',isAI);
  $('methodManual').classList.toggle('active',!isAI);
  $('manualPanel').style.display=isAI?'none':'block';
  $('aiActionRow').style.display=isAI?'flex':'none';
  $('manualActionRow').style.display=isAI?'none':'flex';
}
function setManualMode(mode){
  manualMode=mode;
  const isScript=mode==='script';
  $('manualTabScript').classList.toggle('active',isScript);
  $('manualTabTime').classList.toggle('active',!isScript);
  $('manualScriptPanel').style.display=isScript?'block':'none';
  $('manualTimePanel').style.display=isScript?'none':'block';
}
$('methodAI').onclick=()=>setClipperMethod('ai');
$('methodManual').onclick=()=>setClipperMethod('manual');
$('manualTabScript').onclick=()=>setManualMode('script');
$('manualTabTime').onclick=()=>setManualMode('time');
['startMinute','startSecond','endMinute','endSecond'].forEach(id=>{
  $(id).addEventListener('input',()=>{
    const el=$(id);
    if(el.value==='') el.value='0';
    if(id.includes('Second')){
      let v=Math.floor(Number(el.value)||0);
      v=Math.max(0,Math.min(59,v));
      el.value=String(v);
    }else{
      let v=Math.floor(Number(el.value)||0);
      v=Math.max(0,v);
      el.value=String(v);
    }
    refreshManualTimeStatus();
  });
});

const drop=$('drop');
['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('drag')}));
['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('drag')}));
drop.addEventListener('drop',e=>setFile(e.dataTransfer.files[0]));

function escapeHtml(s){ return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }

function averageChannels(buf){
  const out=new Float32Array(buf.length);
  for(let ch=0;ch<buf.numberOfChannels;ch++){
    const d=buf.getChannelData(ch);
    for(let i=0;i<d.length;i++) out[i]+=d[i]/buf.numberOfChannels;
  }
  return out;
}
async function decodeAudio16k(f){
  status('Membaca audio dari video…',8); log('Membaca file lokal…');
  const ab=await f.arrayBuffer();
  const ac=new (window.AudioContext||window.webkitAudioContext)();
  let decoded;
  try{ decoded=await ac.decodeAudioData(ab.slice(0)); }
  catch(e){ await ac.close(); throw new Error('Browser tidak dapat membaca audio dari video ini. Coba MP4 H.264/AAC atau WebM.'); }
  status('Menyiapkan audio 16 kHz…',16);
  let mono=averageChannels(decoded);
  if(decoded.sampleRate!==16000){
    const offline=new OfflineAudioContext(1,Math.ceil(decoded.duration*16000),16000);
    const b=offline.createBuffer(1,mono.length,decoded.sampleRate);
    b.copyToChannel(mono,0);
    const src=offline.createBufferSource();src.buffer=b;src.connect(offline.destination);src.start();
    const rendered=await offline.startRendering();
    mono=new Float32Array(rendered.getChannelData(0));
  }
  await ac.close();
  return mono;
}

async function loadWhisper(){
  const modelName=$('model').value;
  const selectedDevice=$('device').value;
  const preferred=(selectedDevice==='auto' && navigator.gpu)?'webgpu':'wasm';
  const key=`${modelName}|${preferred}`;

  if(transcriber && transcriberKey===key) return transcriber;

  if(transcriber && transcriberKey!==key){
    try{ await transcriber.dispose?.(); }catch(e){}
    transcriber=null;
    transcriberKey='';
  }

  status('Memuat engine Whisper…',22);
  log('Mengunduh / membuka cache Transformers.js…');
  const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0');
  env.allowLocalModels=false;

  async function build(device){
    log(`Mode AI: ${device.toUpperCase()}`);
    status(`Memuat model Whisper (${device.toUpperCase()})…`,28);
    return await pipeline('automatic-speech-recognition',modelName,{device});
  }

  try{
    transcriber=await build(preferred);
    transcriberKey=key;
    return transcriber;
  }catch(err){
    if(preferred==='webgpu'){
      log('WebGPU gagal. Otomatis fallback ke CPU/WASM.');
      status('WebGPU gagal, mencoba CPU/WASM…',28);
      transcriber=await build('wasm');
      transcriberKey=`${modelName}|wasm`;
      $('device').value='wasm';
      return transcriber;
    }
    throw err;
  }
}