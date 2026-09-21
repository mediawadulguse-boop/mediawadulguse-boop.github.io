function makeCandidates(chunks){
  if(!Array.isArray(chunks) || !chunks.length) return [];
  const HOOK=['ternyata','faktanya','sebenarnya','masalah sebenarnya','yang tidak banyak orang tahu','justru','ini yang terjadi','buktinya','akhirnya'];
  const QUESTION=['kenapa','mengapa','bagaimana','siapa','apa','kok','benarkah','apakah'];
  const CONFLICT=['tapi','tetapi','namun','salah','bohong','bantah','bukan','gagal','masalah','konflik','protes','aneh','dicopot','dipecat','ditolak','korupsi'];
  const INFO=['data','fakta','angka','persen','miliar','juta','ribu','dokumen','hasil','laporan','bukti','anggaran','saham','rupiah'];
  const EMOTION=['kaget','marah','kecewa','takut','senang','sedih','parah','gila','luar biasa','mengejutkan','viral','heboh'];
  const tok=t=>String(t||'').toLowerCase().match(/[\p{L}\p{N}%]+/gu)||[];
  const cnt=(t,v)=>{const s=new Set(tok(t));return v.reduce((n,x)=>n+(s.has(x)?1:0),0)};
  const dims=(text,dur)=>{
    const l=text.toLowerCase(),qh=cnt(text,QUESTION),cf=cnt(text,CONFLICT),inf=cnt(text,INFO)+(text.match(/\b\d+(?:[.,]\d+)?%?/g)||[]).length,em=cnt(text,EMOTION),hh=HOOK.filter(x=>l.includes(x)).length;
    const hook=clamp(40+hh*13+qh*7+(text.includes('?')?6:0));
    const curiosity=clamp(38+qh*10+hh*10+cf*4);
    const conflict=clamp(30+cf*14);
    const information=clamp(38+inf*9+Math.min(18,tok(text).length/12));
    const emotion=clamp(30+em*15+(text.includes('!')?5:0));
    const standalone=clamp((55+Math.min(25,(text.match(/[.!?]+/g)||[]).length*5)+Math.max(0,20-Math.abs(dur-42)))/1.15);
    const score=clamp(hook*.25+curiosity*.20+conflict*.15+information*.15+emotion*.10+standalone*.15);
    return {hook,curiosity,conflict,information,emotion,standalone,score};
  };

  const list=[];
  for(let i=0;i<chunks.length;i++){
    const first=chunks[i];
    if(!Number.isFinite(first?.start)) continue;
    let parts=[],start=Number(first.start);
    for(let j=i;j<Math.min(chunks.length,i+10);j++){
      const ch=chunks[j];
      if(!ch || !Number.isFinite(ch.end)) continue;
      parts.push(String(ch.text||''));
      const end=Number(ch.end),dur=end-start;
      if(dur<20)continue;
      if(dur>75)break;
      const text=parts.join(' ').replace(/\s+/g,' ').trim();
      if(text.length<70)continue;
      const d=dims(text,dur);
      const sentence=(text.match(/^[^.!?]+[.!?]?/)||[text])[0].trim();
      const words=sentence.split(/\s+/);
      const title=(words.slice(0,12).join(' ')+(words.length>12?'…':'')).slice(0,100);
      const vals=[
        ['hook',d.hook,'hook kuat'],
        ['curiosity',d.curiosity,'rasa penasaran tinggi'],
        ['conflict',d.conflict,'ada konflik/kontras'],
        ['information',d.information,'nilai informasi tinggi'],
        ['emotion',d.emotion,'muatan emosi'],
        ['standalone',d.standalone,'cukup berdiri sendiri']
      ].sort((a,b)=>b[1]-a[1]);
      list.push({
        start,end,text,title,
        reason:vals.slice(0,3).map(x=>x[2]).join(', '),
        ...d,
        chunks:chunks.slice(i,j+1)
      });
      if(dur>=38)break;
    }
  }

  list.sort((a,b)=>b.score-a.score);
  const chosen=[];
  for(const c of list){
    if(chosen.some(p=>overlaps(c,p)>.55))continue;
    chosen.push(c);
    if(chosen.length>=12)break;
  }
  return chosen;
}

function renderResults(){
  $('results').innerHTML='';
  $('count').textContent=`${candidates.length} kandidat`;
  $('ytBatchBar').style.display=(sourceMode==='youtube' && candidates.length)?'block':'none';

  candidates.forEach((c,i)=>{
    const el=document.createElement('div');
    el.className='result';
    el.dataset.i=i;
    const batch=(sourceMode==='youtube')
      ? `<label class="row" style="gap:6px" onclick="event.stopPropagation()"><input class="ytcheck" type="checkbox" data-yt-check="${i}" ${ytBatchSelected.has(i)?'checked':''}><span class="tiny">Batch</span></label>`
      : `<span class="badge">#${i+1}</span>`;

    el.innerHTML=`<div class="resulthead"><div><div class="score ${c.score>=85?'hot':''}">${c.score}/100</div><div class="time">${fmtTime(c.start)} → ${fmtTime(c.end)} • ${Math.round(c.end-c.start)} detik</div></div>${batch}</div>
      <div class="hook">${escapeHtml(c.title)}</div><div class="reason">${escapeHtml(c.reason)}</div>
      <div class="meters"><div class="meter">Hook <b>${c.hook}</b></div><div class="meter">Curiosity <b>${c.curiosity}</b></div><div class="meter">Info <b>${c.information}</b></div></div>`;

    el.onclick=()=>selectCandidate(i);
    $('results').appendChild(el);
  });

  document.querySelectorAll('[data-yt-check]').forEach(cb=>{
    cb.addEventListener('change',e=>{
      const i=Number(e.target.dataset.ytCheck);
      if(e.target.checked){
        if(ytBatchSelected.size>=10){
          e.target.checked=false;
          alert('Maksimal 10 clip per batch.');
          return;
        }
        ytBatchSelected.add(i);
      }else{
        ytBatchSelected.delete(i);
      }
    });
  });

  if(candidates.length)selectCandidate(0);
}

function selectCandidate(i){
  const c=candidates[i];
  if(!c)return;
  document.querySelectorAll('.result').forEach((e,j)=>e.classList.toggle('active',j===i));
  applySelection(c,false);
}