function transcriptPlainText(){
  return (transcript||[])
    .map(x=>String(x?.text||'').trim())
    .filter(Boolean)
    .join('\n');
}

function srtTime(sec){
  const ms=Math.max(0,Math.round((Number(sec)||0)*1000));
  const h=Math.floor(ms/3600000);
  const m=Math.floor((ms%3600000)/60000);
  const s=Math.floor((ms%60000)/1000);
  const milli=ms%1000;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(milli).padStart(3,'0')}`;
}

function transcriptTimestampText(){
  return (transcript||[])
    .map(x=>`[${fmtTime(x.start)}] ${String(x?.text||'').trim()}`)
    .filter(x=>x.trim())
    .join('\n');
}

function transcriptSrt(){
  return (transcript||[])
    .map((x,i)=>{
      const start=Number(x?.start||0);
      const end=Math.max(start+0.05,Number(x?.end||start+2));
      const text=String(x?.text||'').trim();
      return `${i+1}\n${srtTime(start)} --> ${srtTime(end)}\n${text}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

function transcriptBaseName(){
  const yt=String(ytMetadata?.title||'').trim();
  const local=String(file?.name||'').replace(/\.[^.]+$/,'').trim();
  return sanitizeFileName(yt || local || 'Transcript');
}

function downloadTextFile(name,content,type='text/plain;charset=utf-8'){
  const blob=new Blob([content],{type});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=name;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),3000);
}

async function copyTextWithFallback(text){
  if(navigator.clipboard?.writeText){
    try{
      await navigator.clipboard.writeText(text);
      return;
    }catch(e){}
  }
  const ta=document.createElement('textarea');
  ta.value=text;
  ta.style.position='fixed';
  ta.style.opacity='0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

function refreshTranscriptPanel(){
  const panel=$('transcriptTools');
  if(!panel)return;
  const count=Array.isArray(transcript)?transcript.length:0;
  if(!count){
    panel.style.display='none';
    $('transcriptOutput').value='';
    $('transcriptMeta').textContent='0 segmen';
    return;
  }
  panel.style.display='block';
  $('transcriptOutput').value=transcriptTimestampText();
  const duration=transcript.length?Math.max(...transcript.map(x=>Number(x?.end||0))):0;
  $('transcriptMeta').textContent=`${count} segmen • ${fmtTime(duration)}`;
  $('transcriptActionStatus').textContent='Transcript siap untuk disalin atau diunduh.';
}

$('copyTranscriptBtn').onclick=async()=>{
  if(!transcript?.length)return alert('Transcript belum tersedia.');
  try{
    await copyTextWithFallback(transcriptPlainText());
    $('transcriptActionStatus').textContent='✓ Transcript berhasil dicopy.';
  }catch(e){
    $('transcriptActionStatus').textContent='Copy gagal.';
    alert('Copy transcript gagal: '+(e?.message||e));
  }
};

$('downloadTranscriptTxtBtn').onclick=()=>{
  if(!transcript?.length)return alert('Transcript belum tersedia.');
  downloadTextFile(`${transcriptBaseName()}.txt`,transcriptTimestampText());
  $('transcriptActionStatus').textContent='✓ TXT berhasil diunduh.';
};

$('downloadTranscriptSrtBtn').onclick=()=>{
  if(!transcript?.length)return alert('Transcript belum tersedia.');
  downloadTextFile(`${transcriptBaseName()}.srt`,transcriptSrt(),'application/x-subrip;charset=utf-8');
  $('transcriptActionStatus').textContent='✓ SRT berhasil diunduh.';
};