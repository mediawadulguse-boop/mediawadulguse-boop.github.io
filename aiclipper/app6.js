function supportedMime(){
  const types=[
    ['video/mp4;codecs=avc1.42E01E,mp4a.40.2','mp4'],
    ['video/webm;codecs=vp9,opus','webm'],
    ['video/webm;codecs=vp8,opus','webm'],
    ['video/webm','webm']
  ];
  for(const [mime,ext] of types) if(window.MediaRecorder&&MediaRecorder.isTypeSupported(mime)) return {mime,ext};
  return {mime:'',ext:'webm'};
}
const sf=supportedMime();$('exportFmt').textContent=`Output browser: ${sf.ext.toUpperCase()}`;

$('bgBtn').onclick=()=>$('bgInput').click();
$('bgInput').onchange=async e=>{
  const f=e.target.files?.[0];
  if(!f)return;
  if(bgObjectUrl)URL.revokeObjectURL(bgObjectUrl);
  bgObjectUrl=URL.createObjectURL(f);
  bgImage=new Image();
  bgImage.src=bgObjectUrl;
  await new Promise((res,rej)=>{bgImage.onload=res;bgImage.onerror=rej});
  $('bgStatus').textContent='✓ '+f.name;
  drawTemplatePreview();
};
$('videoY').oninput=()=>{$('videoYVal').textContent=$('videoY').value+'%';drawTemplatePreview()};
$('videoH').oninput=()=>{$('videoHVal').textContent=$('videoH').value+'%';drawTemplatePreview()};
['headline1','headline2','clipTemplate','subtitle'].forEach(id=>{
  $(id).addEventListener('input',drawTemplatePreview);
  $(id).addEventListener('change',drawTemplatePreview);
});
$('templatePreviewBtn').onclick=()=>{
  $('previewFrame').style.display='block';
  drawTemplatePreview();
};

$('outroBtn').onclick=()=>$('outroInput').click();
$('outroInput').onchange=async e=>{
  const f=e.target.files?.[0];
  if(!f)return;
  outroFile=f;
  if(outroObjectUrl) URL.revokeObjectURL(outroObjectUrl);
  outroObjectUrl=URL.createObjectURL(f);
  outroVideo.src=outroObjectUrl;
  await new Promise((res,rej)=>{outroVideo.onloadedmetadata=res;outroVideo.onerror=rej});
  $('outroStatus').textContent=`Outro: ${f.name}`;
};

function dimensions(ratio,vw,vh){
  if(ratio==='9:16')return [720,1280];
  if(ratio==='4:5')return [864,1080];
  if(ratio==='1:1')return [1080,1080];
  if(ratio==='16:9')return [1280,720];
  const max=1280,scale=Math.min(1,max/Math.max(vw,vh));return [Math.round(vw*scale),Math.round(vh*scale)];
}
function drawCoverRect(ctx,src,x,y,w,h){
  const sw0=src.videoWidth||src.naturalWidth||src.width;
  const sh0=src.videoHeight||src.naturalHeight||src.height;
  if(!sw0||!sh0)return;
  const sa=sw0/sh0,ca=w/h;let sx=0,sy=0,sw=sw0,sh=sh0;
  if(sa>ca){sw=sh0*ca;sx=(sw0-sw)/2}else{sh=sw0/ca;sy=(sh0-sh)/2}
  ctx.drawImage(src,sx,sy,sw,sh,x,y,w,h);
}
function drawCover(ctx,v,w,h){drawCoverRect(ctx,v,0,0,w,h)}
function wrapText(ctx,text,maxWidth,maxLines=3){
  const words=text.split(/\s+/);const lines=[];let line='';
  for(const word of words){const test=line?line+' '+word:word;if(ctx.measureText(test).width>maxWidth&&line){lines.push(line);line=word}else line=test}
  if(line)lines.push(line);return lines.slice(0,maxLines);
}
function subtitleAt(t){
  if(!selected)return'';const x=selected.chunks.find(c=>t>=c.start&&t<=c.end);return x?.text||'';
}
function drawDefaultBackground(ctx,w,h){
  const g=ctx.createLinearGradient(0,0,0,h);
  g.addColorStop(0,'#090909');g.addColorStop(.55,'#111318');g.addColorStop(1,'#080a0e');
  ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
  ctx.globalAlpha=.12;ctx.strokeStyle='#fff';ctx.lineWidth=1;
  for(let i=0;i<16;i++){ctx.beginPath();ctx.moveTo(w*.5,h*.35);ctx.lineTo((i/15)*w,h*.78);ctx.stroke()}
  ctx.globalAlpha=1;
}
function drawHeadline(ctx,w,h){
  const a=$('headline1').value.trim(),b=$('headline2').value.trim();
  if(!a&&!b)return;
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.font=`900 ${Math.round(w*.11)}px Arial Black, Arial`;
  ctx.strokeStyle='#000';ctx.lineWidth=Math.max(4,w*.008);ctx.fillStyle='#fff';
  const y1=h*.10;
  if(a){ctx.strokeText(a,w/2,y1);ctx.fillText(a,w/2,y1)}
  ctx.font=`900 ${Math.round(w*.12)}px Arial Black, Arial`;
  ctx.fillStyle='#20ff57';
  const y2=h*.19;
  if(b){ctx.strokeText(b,w/2,y2);ctx.fillText(b,w/2,y2)}
}
function drawEditorial(ctx,w,h,posterOnly=false,forPreview=false){
  if(bgImage)drawCoverRect(ctx,bgImage,0,0,w,h); else drawDefaultBackground(ctx,w,h);
  drawHeadline(ctx,w,h);
  if(posterOnly)return;
  const y=h*(Number($('videoY').value)/100);
  const vh=h*(Number($('videoH').value)/100);
  const x=0,vw=w;
  ctx.fillStyle='#000';ctx.fillRect(x,y,vw,vh);
  if(video.readyState>=2)drawCoverRect(ctx,video,x,y,vw,vh);
  ctx.strokeStyle='rgba(255,255,255,.10)';ctx.lineWidth=1;ctx.strokeRect(x,y,vw,vh);
  if($('subtitle').value==='on' && selected){
    const t=forPreview?selected.start+Math.min(2,(selected.end-selected.start)/2):video.currentTime;
    const s=subtitleAt(t);
    if(s){
      ctx.font=`800 ${Math.max(28,Math.round(w/28))}px Arial`;
      ctx.textAlign='center';ctx.textBaseline='middle';
      const lines=wrapText(ctx,s,w*.78,2),lh=Math.round(w/24),boxH=lines.length*lh+24,cy=y+vh*.55;
      ctx.fillStyle='rgba(0,0,0,.62)';ctx.fillRect(w*.1,cy-boxH/2,w*.8,boxH);
      ctx.strokeStyle='#000';ctx.lineWidth=5;ctx.fillStyle='#fff';
      lines.forEach((ln,i)=>{const yy=cy-(lines.length-1)*lh/2+i*lh;ctx.strokeText(ln,w/2,yy);ctx.fillText(ln,w/2,yy)});
    }
  }
}
function drawTemplatePreview(){
  if(!$('templatePreview'))return;
  const c=$('templatePreview'),ctx=c.getContext('2d'),w=c.width,h=c.height;
  ctx.clearRect(0,0,w,h);
  if($('clipTemplate').value==='editorial')drawEditorial(ctx,w,h,false,true);
  else{
    ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);
    if(video.readyState>=2)drawCover(ctx,video,w,h);
  }
}