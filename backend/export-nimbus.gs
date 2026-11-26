/** Run exportForNimbus from the existing Apps Script editor as the spreadsheet owner.
 * No public HTTP action is added. The output contains account passwords: keep it private.
 * The existing spreadsheet, files, settings and deployments are not modified.
 */
function exportForNimbus(options) {
  options=options||{};
  var ss=typeof getSpreadsheet_==='function'?getSpreadsheet_():SpreadsheetApp.getActiveSpreadsheet();
  if(!ss)throw new Error('Jalankan dari project Apps Script database MEDIA WADUL.');
  var timezone=ss.getSpreadsheetTimeZone()||'Asia/Jakarta',sheets={},counts={},hashes={},htmlErrors=[],externalErrors=[];
  var dateOnly={BRIEF:['tanggal','deadline'],TUGAS:['deadline'],HOT_ISSUE:['tanggal','followup_deadline'],RAPAT:['tanggal','deadline_followup'],HTML_ANALIS:['tanggal'],FOOTAGE:['tanggal']};
  function exportSheet(sheet,prefix){
    var name=(prefix||'')+sheet.getName(),values=sheet.getDataRange().getValues();
    if(values.length<1)return;
    var headers=values[0].map(function(v){return String(v||'').trim();});
    if(headers.filter(Boolean).length!==Array.from(new Set(headers.filter(Boolean))).length)throw new Error('Header ganda: '+name);
    var rows=values.slice(1).filter(function(row){return row.some(function(v){return v!==''&&v!==null;});}).map(function(row,index){
      var record={};headers.forEach(function(key,i){
        if(!key){if(row[i]!==''&&row[i]!==null)throw new Error('Kolom tanpa header berisi data: '+name+' baris '+(index+2));return;}
        var value=row[i];
        if(Object.prototype.toString.call(value)==='[object Date]')value=(dateOnly[name]||[]).indexOf(key)>=0||['date','week_start','week_end'].indexOf(key)>=0?Utilities.formatDate(value,timezone,'yyyy-MM-dd'):value.toISOString();
        record[key]=value;
      });return record;
    });
    if(name==='HTML_ANALIS')rows.forEach(function(record){
      if(record.html_content)return;
      try{
        if(!record.drive_file_id)throw new Error('File Drive tidak tersedia.');
        var blob=DriveApp.getFileById(String(record.drive_file_id)).getBlob();
        if(String(record.storage_type)==='DRIVE_GZIP')record.html_gzip_base64=Utilities.base64Encode(blob.getBytes());
        else record.html_content=blob.getDataAsString('UTF-8');
      }catch(e){htmlErrors.push({id:record.id,message:String(e.message||e)});}
    });
    sheets[name]=rows;counts[name]=rows.length;
    hashes[name]=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(rows),Utilities.Charset.UTF_8).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
  }
  ss.getSheets().forEach(function(sheet){exportSheet(sheet,'');});
  if(options.includeListening!==false&&typeof listeningSpreadsheet_==='function'){
    try{var listening=listeningSpreadsheet_();if(listening.getId()!==ss.getId())listening.getSheets().forEach(function(sheet){exportSheet(sheet,'LISTENING__');});}
    catch(e){externalErrors.push(String(e.message||e));}
  }
  var result={format:'mwg-nimbus-export-v1',generated_at:new Date().toISOString(),sheets:sheets,manifest:{counts:counts,sha256:hashes,html_errors:htmlErrors,external_errors:externalErrors}};
  var file=DriveApp.createFile(Utilities.newBlob(JSON.stringify(result),'application/json','MWG_NIMBUS_EXPORT_'+Utilities.formatDate(new Date(),timezone,'yyyyMMdd_HHmmss')+'.json'));
  Logger.log('Ekspor privat dibuat: '+file.getUrl());
  Logger.log('Jumlah per sheet: '+JSON.stringify(counts));
  Logger.log('Dokumen HTML belum lengkap: '+htmlErrors.length);
  Logger.log('Kesalahan ekspor eksternal: '+externalErrors.length);
  return {file_id:file.getId(),url:file.getUrl(),counts:counts,html_errors:htmlErrors,external_errors:externalErrors};
}
