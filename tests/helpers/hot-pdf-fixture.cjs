'use strict';
// Synthetic layout: no monitoring report or personal data is included.
function page(number,section='hot',titles=['Permintaan lampu jalan','Komentar warga']){
  const items=[{s:section==='hot'?'LIST HOT ISSUE — MENTION SOCIAL MEDIA':'LIST SENTIMEN NEGATIF',x:40,y:20,w:300,h:12}],annotations=[];
  titles.forEach((title,i)=>{
    const x=i%2===0?60:504,y=i<2?92:305;
    const add=(s,dx,dy)=>items.push({s,x:x+dx,y:y+dy,w:200,h:12});
    add(String(i+1).padStart(2,'0'),4,0);add(title,32,-4);add('TikTok - Comment - Akun Contoh '+i,0,46);add('NEGATIF',10,71);add('HOT',90,71);
    add('Kronologi kartu '+(i+1)+' tentang pelayanan publik.',0,95);add('Link: example.com/post/bersama…',0,150);
    annotations.push({url:'https://example.com/post/bersama?ref=lengkap',rect:[x,540-(y+150)-5,x+250,540-(y+150)+8]});
  });
  return {number,width:959,height:540,items,annotations};
}
module.exports={page};
