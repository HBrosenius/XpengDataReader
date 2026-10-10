/* Local-only XPENG ZIP/CSV import. No uploaded data leaves the browser. */
(() => {
  'use strict';
  const FIELDS={
    operation:{esp_vehspd:'speed',cdcu_totalodometer:'odometer',esp_vehlongaccel:'acceleration'},
    power_energy:{bms_battvolt:'voltage',bms_battcurr:'current',ldcu_chrgpwr:'chargePower',ldcu_bms_soc_disp:'soc',bms_batttempmax_gb:'tempMax',bms_batttempmin_gb:'tempMin',ldcu_dstbatdisp_dynamic:'range'},
    status:{ldcu_tpmsprfl:'tyreFL',ldcu_tpmsprfr:'tyreFR',ldcu_tpmsprrl:'tyreRL',ldcu_tpmsprrr:'tyreRR'}
  };
  const categoryOf=name=>Object.keys(FIELDS).find(k=>name.toLowerCase().endsWith(k+'_di.csv'));
  const MAX_SIZE=350*1024*1024;
  const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  function crc32(bytes,crc=0xffffffff){for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return crc>>>0;}
  function zipEntries(buffer){
    const v=new DataView(buffer), bytes=new Uint8Array(buffer);let end=-1;
    for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v.getUint32(i,true)===0x06054b50&&i+22+v.getUint16(i+20,true)===bytes.length){end=i;break;}
    if(end<0)throw new Error('This is not a valid ZIP archive.');
    if(v.getUint16(end+4,true)||v.getUint16(end+6,true))throw new Error('Multi-part ZIP archives are not supported.');
    const count=v.getUint16(end+10,true);let offset=v.getUint32(end+16,true),total=0;const entries=[];
    if(count===65535||offset===0xffffffff)throw new Error('ZIP64 archives are not supported.');
    for(let i=0;i<count;i++){
      if(offset+46>bytes.length||v.getUint32(offset,true)!==0x02014b50)throw new Error('The ZIP directory is damaged.');
      const flags=v.getUint16(offset+8,true),method=v.getUint16(offset+10,true),crc=v.getUint32(offset+16,true),compressed=v.getUint32(offset+20,true),size=v.getUint32(offset+24,true);
      const nl=v.getUint16(offset+28,true),extra=v.getUint16(offset+30,true),comment=v.getUint16(offset+32,true),local=v.getUint32(offset+42,true);
      if(offset+46+nl+extra+comment>bytes.length)throw new Error('The ZIP directory is truncated.');
      const name=new TextDecoder().decode(bytes.subarray(offset+46,offset+46+nl));offset+=46+nl+extra+comment;
      const category=categoryOf(name);if(!category)continue;
      if(flags&1)throw new Error('Encrypted ZIP files are not supported.');
      if(![0,8].includes(method))throw new Error('Unsupported ZIP compression. Use a standard ZIP export.');
      total+=size;if(total>MAX_SIZE)throw new Error('This export is too large. Import smaller exports (up to 350 MB uncompressed).');
      if(local+30>bytes.length||v.getUint32(local,true)!==0x04034b50)throw new Error('The ZIP file header is damaged.');
      const start=local+30+v.getUint16(local+26,true)+v.getUint16(local+28,true);
      if(start+compressed>bytes.length)throw new Error('The ZIP file is truncated.');
      entries.push({name,category,size,crc,method,bytes:bytes.subarray(start,start+compressed)});
    }
    if(!entries.length)throw new Error('No recognized XPENG telemetry CSVs were found in this ZIP.');
    return entries;
  }
  async function* csvRows(stream){
    const reader=stream.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
    let row=[],field='',quoted=false,afterQuote=false,skipLF=false;
    function consume(text){
      const rows=[];
      for(const c of text){
        if(skipLF){skipLF=false;if(c==='\n')continue;}
        if(quoted){if(c==='"'){quoted=false;afterQuote=true;}else field+=c;continue;}
        if(afterQuote&&c==='"'){quoted=true;afterQuote=false;field+='"';continue;}
        afterQuote=false;
        if(c==='"'&&field===''){quoted=true;continue;}
        if(c===','){row.push(field);field='';}
        else if(c==='\n'||c==='\r'){row.push(field);if(row.some(Boolean))rows.push(row);row=[];field='';skipLF=c==='\r';}
        else field+=c;
      }
      if(field.length>1000000||row.length>1000)throw new Error('Invalid CSV: an individual record is too large.');
      return rows;
    }
    try{while(true){const {value,done}=await reader.read();if(done)break;for(const row of consume(decoder.decode(value,{stream:true})))yield row;}
      for(const row of consume(decoder.decode()))yield row;
      if(quoted)throw new Error('CSV has an unclosed quoted field.');
      if(field!==''||row.length){row.push(field);if(row.some(Boolean))yield row;}
    }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  }
  async function hash(value){const a=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(a),b=>b.toString(16).padStart(2,'0')).join('');}
  function number(value){if(value===undefined||value.trim()==='')return undefined;const n=Number(value);return Number.isFinite(n)?n:undefined;}
  function addSample(point,category,timestamp,row){
    const seconds=point._coverage[category]||'0'.repeat(60),second=timestamp%60;
    if(seconds[second]==='1')return false;
    point._coverage[category]=seconds.slice(0,second)+'1'+seconds.slice(second+1);
    if(category==='operation')point.samples=(point.samples||0)+1;
    for(const [name,key] of Object.entries(FIELDS[category])){
      const n=number(row[name]);if(n===undefined)continue;
      if(key==='speed'&&(n<0||n>300)||key==='soc'&&(n<0||n>100)||key.startsWith('tyre')&&(n<50||n>500))continue;
      const stat=point._stats[key]||(point._stats[key]=[0,0]);stat[0]+=n;stat[1]++;point[key]=Math.round(stat[0]/stat[1]*1000)/1000;
      if(key==='speed'){point.maxSpeed=Math.max(point.maxSpeed??0,n);if(n>1)point.moving=(point.moving||0)+1;}
      if(key==='odometer'){point.odoMin=Math.min(point.odoMin??n,n);point.odoMax=Math.max(point.odoMax??n,n);}
    }
    if(category==='power_energy'){
      const voltage=number(row.bms_battvolt),current=number(row.bms_battcurr);
      if(voltage!==undefined&&current!==undefined){const e=voltage*current/3600000;if(Number.isFinite(e)){point.energyOut=(point.energyOut||0)+Math.max(0,e);point.energyIn=(point.energyIn||0)+Math.max(0,-e);}}
    }
    return true;
  }
  async function mergeFiles(original,files,onProgress=()=>{}){
    if(original.schemaVersion!==2)throw new Error('Refresh the dashboard to load the updated import-ready dataset.');
    const data=structuredClone(original),buckets=new Map(data.points.map(p=>[p.t,p]));let added=0,duplicates=0,invalid=0;
    for(const file of files){
      onProgress(`Opening ${file.name}…`);
      if(file.size>MAX_SIZE)throw new Error('File exceeds the 350 MB import limit.');
      let entries;
      if(file.name.toLowerCase().endsWith('.zip'))entries=zipEntries(await file.arrayBuffer());
      else{const category=categoryOf(file.name);if(!category)throw new Error('Choose an XPENG export ZIP or a CSV with its original export filename.');entries=[{name:file.name,category,size:file.size,file}];}
      for(const entry of entries){
        let stream=entry.file?entry.file.stream():new Blob([entry.bytes]).stream();
        if(entry.method===8){try{stream=stream.pipeThrough(new DecompressionStream('deflate-raw'));}catch{throw new Error('ZIP import needs a modern browser with deflate-raw support. You can also select the extracted CSV files.');}}
        let crc=0xffffffff,size=0;
        stream=stream.pipeThrough(new TransformStream({transform(chunk,controller){size+=chunk.length;if(size>entry.size||size>MAX_SIZE)throw new Error('Decompressed file exceeds its declared size.');crc=crc32(chunk,crc);controller.enqueue(chunk);}}));
        let headers,count=0;
        for await(const values of csvRows(stream)){
          if(!headers){headers=values.map(s=>s.replace(/^\ufeff/,'').trim());if(!headers.includes('timer')||!headers.includes('vin')||!Object.keys(FIELDS[entry.category]).some(k=>headers.includes(k)))throw new Error('CSV is missing required XPENG telemetry columns.');continue;}
          count++;
          const row=Object.fromEntries(headers.map((h,i)=>[h,values[i]??'']));
          if(row.vin.trim()){
            // Avoid hashing the VIN for every second, while still checking every row.
            if(row.vin!==entry.lastVin){entry.lastVin=row.vin;const vehicleId=await hash(row.vin);if(data.vehicleId&&data.vehicleId!==vehicleId)throw new Error('This export belongs to a different vehicle. No data was added.');data.vehicleId=vehicleId;data.model=data.model||row.vmodel||'Unknown';}
          }else throw new Error('A telemetry row has no vehicle identifier. No data was added.');
          const timestamp=number(row.timer);
          if(timestamp===undefined||!Number.isSafeInteger(timestamp)||timestamp<0||timestamp>4102444800){invalid++;continue;}
          const minute=Math.floor(timestamp/60)*60;
          let point=buckets.get(minute);if(!point){point={t:minute,_coverage:{},_stats:{}};buckets.set(minute,point);}
          if(addSample(point,entry.category,timestamp,row))added++;else duplicates++;
          if(count%5000===0){onProgress(`Reading ${entry.category.replaceAll('_',' ')} · ${count.toLocaleString()} records…`);await new Promise(resolve=>setTimeout(resolve,0));}
        }
        if(!count)throw new Error('A telemetry CSV has no data rows.');
        if(size!==entry.size||entry.crc!==undefined&&((crc^0xffffffff)>>>0)!==entry.crc)throw new Error('The ZIP data failed its integrity check. No data was added.');
      }
      data.sources=[...new Set([...(data.sources||[data.source]),file.name])];
    }
    data.points=[...buckets.values()].sort((a,b)=>a.t-b.t);
    if(!data.points.length)throw new Error('No valid telemetry timestamps were found.');
    data.uniqueCounts={operation:0,power_energy:0,status:0};
    for(const point of data.points)for(const category of Object.keys(FIELDS))data.uniqueCounts[category]+=(point._coverage[category]||'').split('1').length-1;
    return {data,added,duplicates,invalid};
  }
  const api={mergeFiles,zipEntries,csvRows,addSample,crc32};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else globalThis.XpengImport=api;
})();
