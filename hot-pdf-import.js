/* Hot Issue PDF import. Text and links are read locally; no PDF upload or AI extraction. */
const HotPdfImport=(()=>{
  'use strict';
  const MAX_BYTES=8*1024*1024,MAX_PAGES=100,MAX_RECORDS=500;
  const SECTIONS={hot:'Hot Issue Wadul Gus’e',negative:'Sentimen Negatif'};
  const base=typeof document!=='undefined'?new URL('.',document.currentScript?.src||document.baseURI).href:'';
  let enginePromise=null;
  const clean=s=>String(s||'').replace(/\u00ad/g,'').replace(/\s+/g,' ').trim();
  const abortError=()=>Object.assign(new Error('Pembacaan file dibatalkan.'),{name:'AbortError'});
  const checkAbort=signal=>{if(signal?.aborted)throw abortError()};
  function lines(items){
    const out=[];
    [...items].sort((a,b)=>a.y-b.y||a.x-b.x).forEach(item=>{
      let row=out.find(r=>Math.abs(r.y-item.y)<=Math.max(2,Math.min(r.h,item.h||12)*.22));
      if(!row){row={y:item.y,h:item.h||12,items:[]};out.push(row)}row.items.push(item);
    });
    return out.sort((a,b)=>a.y-b.y).map(r=>({...r,text:clean(r.items.sort((a,b)=>a.x-b.x).map(x=>x.s).join(' '))}));
  }
  function safeUrl(value){
    const text=clean(value);if(!text||/[\s…]|\.{3}/.test(text))return '';
    try{const url=new URL(/^https?:\/\//i.test(text)?text:'https://'+text);return /^https?:$/.test(url.protocol)&&url.hostname.includes('.')&&!url.username&&!url.password?url.href:''}catch{return ''}
  }
  function monitoringDate(text){
    const months=['januari','februari','maret','april','mei','juni','juli','agustus','september','oktober','november','desember'];
    const match=clean(text).toLowerCase().match(/(?:periode\s*(?:monitoring)?\s*:\s*)?(\d{1,2})\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+(20\d{2})/);
    if(!match)return '';const day=+match[1],month=months.indexOf(match[2])+1,year=+match[3],d=new Date(Date.UTC(year,month-1,day));
    return d.getUTCDate()===day&&d.getUTCMonth()===month-1?`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`:'';
  }
  function parsePage(page){
    const {width,height}=page,items=page.items||[],header=lines(items.filter(x=>x.y<height*.12)).map(x=>x.text).join(' ');
    const section=/LIST\s+HOT\s+ISSUE/i.test(header)?'hot':/LIST\s+SENTIMEN\s+NEGATIF/i.test(header)?'negative':'';
    if(!section)return [];
    const anchors=items.filter(x=>/^\d{2,3}$/.test(clean(x.s))&&x.y>height*.1&&x.y<height*.88&&x.x% (width/2)<width*.15).sort((a,b)=>a.y-b.y||a.x-b.x);
    return anchors.map(anchor=>{
      const column=anchor.x<width/2?0:1,left=column*width/2,right=(column+1)*width/2;
      const next=anchors.find(x=>x.y>anchor.y+anchor.h*2&&(x.x<width/2?0:1)===column);
      const top=anchor.y-anchor.h*2,bottom=next?next.y-next.h*2:height*.93;
      const card=items.filter(x=>x!==anchor&&x.x>=left&&x.x<right&&x.y>=top&&x.y<bottom),rows=lines(card);
      const badge=/^(NEGATIF|POSITIF|NETRAL|CAMPURAN|HOT|CHECK|VERIFIKASI)$/i;
      const badges=card.filter(x=>badge.test(clean(x.s)));
      const source=rows.find(x=>/^(?:tik\s?tok|facebook|instagram|twitter|youtube|media\s+online|web(?:site)?|berita|aduan|x)\s*(?:[·•|–—-]|$)/i.test(x.text));
      const sourceY=source?.y??(badges.length?Math.min(...badges.map(x=>x.y))-anchor.h*2:anchor.y+anchor.h*4);
      const titleRows=rows.filter(x=>x.y<sourceY-2&&!x.items.every(t=>badge.test(clean(t.s))));
      const linkRows=rows.filter(x=>/^link\s*:/i.test(x.text)),linkY=linkRows[0]?.y??bottom;
      const bodyY=badges.length?Math.max(...badges.map(x=>x.y)):sourceY;
      const description=rows.filter(x=>x.y>bodyY+2&&x.y<linkY-2).map(x=>x.text).join(' ');
      const links=(page.annotations||[]).filter(a=>{
        const rect=a.rect||[],x=(rect[0]+rect[2])/2,y=height-(rect[1]+rect[3])/2;
        return x>=left&&x<right&&y>=top&&y<bottom;
      }).map(a=>safeUrl(a.url)).filter(Boolean);
      const visible=linkRows.map(x=>x.text.replace(/^link\s*:\s*/i,'')).join('');
      const warnings=[];let link=links[0]||safeUrl(visible);
      // A separately rendered ellipsis belongs to the visible link, not its destination.
      if(!links.length&&card.some(x=>/^(?:…|\.{3})$/.test(clean(x.s))&&Math.abs(x.y-linkY)<4))link='';
      if(!link)warnings.push('Tautan lengkap tidak tersedia di PDF');
      if(/…|\.{3}/.test(description))warnings.push('Deskripsi pada PDF berupa kutipan/teks terpotong');
      if(!source)warnings.push('Sumber tidak terbaca; periksa pratinjau');
      return {judul:clean(titleRows.map(x=>x.text).join(' ')),deskripsi:clean(description),sumber:source?.text||'',link,
        _pdf_page:page.number,_pdf_number:Number(anchor.s),_pdf_section:section,_pdf_warnings:warnings,
        _pdf_sentiment:badges.map(x=>clean(x.s)).find(x=>/^(negatif|positif|netral|campuran)$/i.test(x))||''};
    });
  }
  function parsePages(pages){
    const records=pages.flatMap(parsePage);if(records.length>MAX_RECORDS)throw new Error(`Maksimal ${MAX_RECORDS} isu per PDF.`);
    if(!records.length)throw new Error(pages.some(p=>p.items?.length)?'Susunan PDF belum dikenali. Gunakan laporan dengan kartu bernomor, judul, sumber, deskripsi, dan Link.':'PDF tidak memiliki teks yang dapat dibaca. PDF hasil pindai/foto belum didukung.');
    const counts={hot:0,negative:0};records.forEach(r=>counts[r._pdf_section]++);
    return {records,counts,numPages:pages.length,date:monitoringDate((pages[0]?.items||[]).map(x=>x.s).join(' '))};
  }
  async function engine(){
    if(!enginePromise)enginePromise=import(new URL('vendor/pdfjs-5.6.205/pdf.min.mjs',base).href).then(pdfjs=>{
      pdfjs.GlobalWorkerOptions.workerSrc=new URL('vendor/pdfjs-5.6.205/pdf.worker.min.mjs',base).href;return pdfjs;
    }).catch(()=>{enginePromise=null;throw new Error('Pembaca PDF belum termuat. Periksa koneksi lalu pilih file kembali.')});
    return enginePromise;
  }
  async function read(file,{signal,onProgress}={}){
    if(!file)throw new Error('Pilih file PDF terlebih dahulu.');
    if(file.size>MAX_BYTES)throw new Error('Ukuran file maksimal 8 MB.');
    checkAbort(signal);onProgress?.('Menyiapkan pembaca PDF…');
    const pdfjs=await engine();checkAbort(signal);
    const data=new Uint8Array(await file.arrayBuffer());checkAbort(signal);
    let task=null,doc=null,locked=false;
    const cancel=()=>{if(task)task.destroy().catch(()=>{})};signal?.addEventListener('abort',cancel,{once:true});
    try{
      task=pdfjs.getDocument({data,isEvalSupported:false,enableXfa:false,useSystemFonts:true});
      task.onPassword=()=>{locked=true;task.destroy().catch(()=>{})};
      doc=await task.promise;checkAbort(signal);
      if(doc.numPages>MAX_PAGES)throw new Error(`Maksimal ${MAX_PAGES} halaman per PDF.`);
      const pages=[];
      for(let number=1;number<=doc.numPages;number++){
        checkAbort(signal);onProgress?.(`Membaca PDF: halaman ${number}/${doc.numPages}…`);
        const page=await doc.getPage(number),viewport=page.getViewport({scale:1}),text=await page.getTextContent(),annotations=await page.getAnnotations({intent:'display'});
        const items=text.items.filter(x=>typeof x.str==='string'&&clean(x.str)).map(x=>{
          const tx=pdfjs.Util.transform(viewport.transform,x.transform);
          return {s:x.str,x:tx[4],y:tx[5],w:x.width,h:Math.hypot(tx[2],tx[3])||x.height||12};
        });
        const links=annotations.filter(a=>a.subtype==='Link').map(a=>({url:a.url||'',rect:a.rect}));
        pages.push({number,width:viewport.width,height:viewport.height,items,annotations:links});page.cleanup();
      }
      checkAbort(signal);return parsePages(pages);
    }catch(error){
      checkAbort(signal);
      if(locked||/password|passwordexception/i.test(String(error?.name)+' '+String(error?.message)))throw new Error('PDF terkunci. Gunakan salinan PDF tanpa kata sandi.');
      if(/invalidpdf|invalid pdf|missingpdf/i.test(String(error?.name)+' '+String(error?.message)))throw new Error('File PDF rusak atau tidak valid. Ekspor ulang PDF lalu coba kembali.');
      throw error;
    }finally{signal?.removeEventListener('abort',cancel);if(task)await task.destroy().catch(()=>{})}
  }
  return {read,parsePage,parsePages,monitoringDate,safeUrl,SECTIONS,MAX_BYTES,MAX_PAGES,MAX_RECORDS};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=HotPdfImport;
