function extractYouTubeId(value){
  const raw=String(value||'').trim();
  if(/^[\w-]{11}$/.test(raw)) return raw;
  try{
    const u=new URL(raw);
    if(u.hostname.includes('youtu.be')) return u.pathname.split('/').filter(Boolean)[0]?.slice(0,11)||'';
    if(u.searchParams.get('v')) return u.searchParams.get('v').slice(0,11);
    const parts=u.pathname.split('/').filter(Boolean);
    const ix=parts.findIndex(x=>['shorts','embed','live'].includes(x));
    if(ix>=0 && parts[ix+1]) return parts[ix+1].slice(0,11);
  }catch(e){}
  return '';
}
function setSourceMode(mode){
  sourceMode=mode;
  const local=mode==='local';
  $('sourceLocalBtn').classList.toggle('active',local);
  $('sourceYoutubeBtn').classList.toggle('active',!local);
  $('localSourcePanel').style.display=local?'block':'none';
  $('youtubeSourcePanel').style.display=local?'none':'block';
  if(!local){
    setClipperMethod('ai');
    $('methodManual').disabled=true;
    $('model').closest('.controls').style.display='none';
    $('aiActionRow').style.display='none';
    $('manualActionRow').style.display='none';
    $('detailEmpty').textContent='Masukkan link YouTube lalu ambil transcript.';
    checkYouTubeBridge();
  }else{
    $('methodManual').disabled=false;
    $('model').closest('.controls').style.display='grid';
    setClipperMethod(clipperMethod==='manual'?'manual':'ai');
    $('ytBatchBar').style.display='none';
    $('ytCutBtn').style.display='none';
    if(!file) $('detailEmpty').textContent='Pilih video lalu jalankan Analisis AI.';
  }
}
$('sourceLocalBtn').onclick=()=>setSourceMode('local');
$('sourceYoutubeBtn').onclick=()=>setSourceMode('youtube');

const AI_CLIPPER_CONNECTOR_ID='afhbaefhjjiaobjgoboijldglfmdnogg';

function bridgeRequest(type,payload={},timeoutMs=45000){
  return new Promise((resolve,reject)=>{
    if(!window.chrome?.runtime?.sendMessage){
      reject(new Error('AI Clipper Connector belum terpasang atau tidak aktif.'));
      return;
    }
    let done=false;
    const timer=setTimeout(()=>{
      if(done)return;done=true;
      reject(new Error('Connector timeout. Coba reload extension lalu buka ulang AI Clipper.'));
    },timeoutMs);

    try{
      chrome.runtime.sendMessage(
        AI_CLIPPER_CONNECTOR_ID,
        {type,...payload},
        response=>{
          if(done)return;done=true;clearTimeout(timer);
          const err=chrome.runtime.lastError;
          if(err){
            reject(new Error(err.message || 'Connector tidak merespons.'));
            return;
          }
          if(!response){
            reject(new Error('Connector tidak mengirim respons.'));
            return;
          }
          if(response.ok===false){
            reject(new Error(response.error||'Connector gagal.'));
            return;
          }
          resolve(response);
        }
      );
    }catch(err){
      clearTimeout(timer);done=true;
      reject(err);
    }
  });
}

async function checkYouTubeBridge(){
  $('ytBridgeStatus').textContent='Connector: memeriksa…';
  try{
    const r=await bridgeRequest('YT_BRIDGE_PING',{},5000);
    ytBridgeReady=!!r.ok;
    $('ytBridgeStatus').textContent=ytBridgeReady
      ? `Connector: aktif ✓ v${r.version||'1.5.0'}`
      : 'Connector: tidak aktif';
  }catch(e){
    ytBridgeReady=false;
    $('ytBridgeStatus').textContent='Connector: belum terhubung';
    log('CONNECTOR: '+e.message);
  }
}
$('ytBridgeCheckBtn').onclick=checkYouTubeBridge;

function showYTMeta(meta,segments,lang=''){
  ytMetadata=meta||{};
  $('ytMeta').style.display='block';
  $('ytTitle').textContent=meta?.title||'Video YouTube';
  $('ytChannel').textContent=meta?.channel||'-';
  $('ytDuration').textContent=fmtTime(Number(meta?.duration||0));
  $('ytTranscriptInfo').textContent=`${segments.length} segmen${lang?' • '+lang:''}`;
  $('ytThumb').src=`https://i.ytimg.com/vi/${ytVideoId}/hqdefault.jpg`;
}
$('ytFetchBtn').onclick=async()=>{
  const id=extractYouTubeId($('ytUrl').value);
  if(!id) return alert('Link YouTube tidak valid.');
  ytVideoId=id;
  ytBatchSelected.clear();ytBatchClips=[];
  renderBatchClips();
  status('Mengambil transcript YouTube…',10);log(`YouTube ID: ${id}`);
  $('ytFetchBtn').disabled=true;
  try{
    const r=await bridgeRequest('YT_FETCH_TRANSCRIPT',{videoId:id},60000);
    if(!r.segments?.length) throw new Error('Transcript kosong.');
    transcript=r.segments.map(x=>({start:Number(x.start||0),end:Number(x.end||0),text:String(x.text||'').trim()})).filter(x=>x.text);
    refreshTranscriptPanel();
    showYTMeta(r.metadata,transcript,r.language||'');
    $('ytAnalyzeBtn').disabled=false;
    status(`Transcript siap — ${transcript.length} segmen.`,100);
    log(`Transcript YouTube siap: ${transcript.length} segmen.`);
    ensureYouTubePlayer(id).catch(err=>log('Player: '+err.message));
  }catch(e){
    status('Transcript YouTube gagal.',0);log('YT ERROR: '+e.message);
    alert(e.message+'\n\nJika video tidak memiliki caption, gunakan fallback transcript manual.');
  }finally{$('ytFetchBtn').disabled=false;}
};
$('ytAnalyzeBtn').onclick=()=>{
  if(!transcript.length) return alert('Ambil transcript terlebih dahulu.');
  $('ytAnalyzeBtn').disabled=true;
  try{
    status('Menganalisis potensi viral…',55);
    if(typeof makeCandidates!=='function') throw new Error('Engine kandidat viral belum termuat.');
    candidates=makeCandidates(transcript);
    ytBatchSelected.clear();
    if(typeof renderResults!=='function') throw new Error('Renderer kandidat viral belum termuat.');
    renderResults();
    status(`Selesai — ${candidates.length} kandidat viral.`,100);
    log(`Analisis YouTube: ${candidates.length} kandidat.`);
    if(!candidates.length) log('Tidak ada kandidat yang lolos filter durasi/teks.');
  }catch(e){
    console.error(e);
    status('Analisis viral gagal.',0);
    log('VIRAL ENGINE ERROR: '+(e?.message||e));
    alert('Analisis viral gagal: '+(e?.message||e));
  }finally{
    $('ytAnalyzeBtn').disabled=false;
  }
};

function parseManualTranscript(raw){
  const text=String(raw||'').replace(/\r/g,'').trim();
  if(!text) return [];
  const lines=text.split('\n').map(x=>x.trim()).filter(Boolean);
  const out=[];
  const tsToSec=s=>{
    const p=s.replace(',', '.').split(':').map(Number);
    if(p.length===3)return p[0]*3600+p[1]*60+p[2];
    if(p.length===2)return p[0]*60+p[1];
    return Number(p[0])||0;
  };
  for(let i=0;i<lines.length;i++){
    let line=lines[i];
    let m=line.match(/^(\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?)\s*-->\s*(\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?)/);
    if(m){
      const start=tsToSec(m[1]),end=tsToSec(m[2]);
      let t='';let j=i+1;
      while(j<lines.length && !/^\d{1,2}:\d{2}/.test(lines[j]) && !/^\d+$/.test(lines[j])){t+=(t?' ':'')+lines[j];j++;}
      if(t)out.push({start,end,text:t});i=j-1;continue;
    }
    m=line.match(/^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s+(.+)$/);
    if(m){const start=tsToSec(m[1]);out.push({start,end:start+6,text:m[2]});}
  }
  if(!out.length){
    const sentences=text.split(/(?<=[.!?])\s+/).filter(Boolean);
    let t=0;for(const s of sentences){const dur=Math.max(4,Math.min(10,s.split(/\s+/).length/2.4));out.push({start:t,end:t+dur,text:s});t+=dur;}
  }
  for(let i=0;i<out.length-1;i++) if(out[i].end>out[i+1].start || out[i].end<=out[i].start) out[i].end=out[i+1].start;
  return out;
}
$('ytManualTranscriptBtn').onclick=()=>{
  const segs=parseManualTranscript($('ytManualTranscript').value);
  if(!segs.length)return alert('Transcript tidak dapat dibaca.');
  transcript=segs;
  refreshTranscriptPanel();
  ytVideoId=extractYouTubeId($('ytUrl').value)||ytVideoId;
  showYTMeta({title:'Transcript Manual',channel:'-',duration:segs.at(-1)?.end||0},segs,'manual');
  $('ytAnalyzeBtn').disabled=false;
  status(`Transcript manual siap — ${segs.length} segmen.`,100);
  if(ytVideoId) ensureYouTubePlayer(ytVideoId).catch(()=>{});
};