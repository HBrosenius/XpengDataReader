'use strict';
const $ = id => document.getElementById(id);
const TZ = 'Europe/Stockholm';
const num = (n, digits = 0) => Number.isFinite(n) ? n.toLocaleString('en-GB', {maximumFractionDigits:digits, minimumFractionDigits:digits}) : '—';
const formatters = new Map(), dayKeys = new Map();
const date = (t, options = {}) => {
  const key=JSON.stringify(options);
  if(!formatters.has(key))formatters.set(key,new Intl.DateTimeFormat('en-GB',{timeZone:TZ,...options}));
  return formatters.get(key).format(new Date(t*1000));
};
const dayKey = t => {
  if(!dayKeys.has(t))dayKeys.set(t,date(t,{year:'numeric',month:'2-digit',day:'2-digit'}).split('/').reverse().join('-'));
  return dayKeys.get(t);
};
const shortDate = t => date(t, {day:'numeric', month:'short'});
const time = t => date(t, {hour:'2-digit', minute:'2-digit'});
const duration = seconds => seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ${Math.round(seconds % 3600 / 60)}m` : `${Math.round(seconds / 60)} min`;
const present = (p, key) => p.filter(x => Number.isFinite(x[key]));
const lastValue = (p, key) => present(p, key).at(-1)?.[key];
const sum = (p, key) => p.reduce((a, x) => a + (x[key] || 0), 0);
const bounds = (p, key) => {let lo,hi;for(const a of p)if(Number.isFinite(a[key])){lo=lo===undefined?a[key]:Math.min(lo,a[key]);hi=hi===undefined?a[key]:Math.max(hi,a[key]);}return [lo,hi];};
let dataset, points, selected = [], view = 'overview', allTrips = [];

function distance(p) {
  const lo = bounds(p,'odoMin')[0], hi = bounds(p,'odoMax')[1];
  return Number.isFinite(lo) && Number.isFinite(hi) ? Math.max(0,hi-lo) : 0;
}
function journeys(p) {
  const result=[];
  let session;
  for(const point of p) {
    if(!(point.moving > 0)) continue;
    if(!session || point.t-session.end>=300) {
      session={start:point.t,end:point.t,points:[],seconds:0}; result.push(session);
    }
    session.end=point.t;session.points.push(point);session.seconds+=point.moving||0;
  }
  return result.map(s=>({...s,km:distance(s.points),peak:bounds(s.points,'maxSpeed')[1]}));
}
function metric(label,value,unit,note,icon) {
  return `<article class="metric"><div class="metric-top">${label}<span class="metric-icon">${icon}</span></div><div class="metric-value">${value}<small>${unit}</small></div><div class="metric-note">${note}</div></article>`;
}
function detail(label,value) { return `<div class="insight-row"><span>${label}</span><b>${value}</b></div>`; }
function daily(p) {
  const groups = new Map();
  for(const x of p) { const key=dayKey(x.t); if(!groups.has(key))groups.set(key,[]);groups.get(key).push(x); }
  return [...groups.values()].map(a=>({t:a[0].t,value:distance(a),minutes:sum(a,'moving')/60}));
}
function chart(container, values, {type='line', unit='', minimum=0, maximum, color='#8ba86d', decimals=0}={}) {
  const el=$(container);el.innerHTML='';
  const p=values.filter(x=>Number.isFinite(x.value));
  if(!p.length){el.innerHTML='<p class="empty-state">No readings available for this period.</p>';return;}
  const W=520,H=188,L=35,R=12,T=13,B=30,plotW=W-L-R,plotH=H-T-B;
  const max=maximum || p.reduce((m,x)=>Math.max(m,x.value),1)*1.15;
  const min=minimum;
  const y=v=>T+plotH-(v-min)/(max-min)*plotH;
  const tmin=p[0].t,tmax=p.at(-1).t;
  const x=(a,i)=>type==='bar'?L+plotW*(i+.5)/p.length:L+(a.t-tmin)/(tmax-tmin||1)*plotW;
  let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${unit} over time"><defs><linearGradient id="fill-${container}" x2="0" y2="1"><stop stop-color="${color}" stop-opacity=".20"/><stop offset="1" stop-color="${color}" stop-opacity=".015"/></linearGradient></defs>`;
  for(let i=0;i<=3;i++){const val=min+(max-min)*i/3;svg+=`<line x1="${L}" x2="${W-R}" y1="${y(val)}" y2="${y(val)}" stroke="#edf1e8" stroke-dasharray="3 4"/><text x="${L-10}" y="${y(val)+3}" text-anchor="end">${num(val,0)}</text>`;}
  if(type==='bar') {
    const width=Math.min(40,plotW/p.length*.54);
    p.forEach((a,i)=>{svg+=`<rect x="${x(a,i)-width/2}" y="${y(a.value)}" width="${width}" height="${Math.max(.5,y(min)-y(a.value))}" rx="4" fill="${i===p.length-1?'#557a4b':'#d5e1bf'}"/><text x="${x(a,i)}" y="${H-8}" text-anchor="middle">${shortDate(a.t)}</text>`;});
  } else {
    const segments=[];let segment=[];
    for(let i=0;i<p.length;i++) {if(i&&p[i].t-p[i-1].t>600){if(segment.length)segments.push(segment);segment=[];}segment.push(p[i]);}if(segment.length)segments.push(segment);
    for(const seg of segments){const coords=seg.map((a,i)=>`${i?'L':'M'}${x(a)},${y(a.value)}`).join(' ');svg+=`<path d="${coords} L${x(seg.at(-1))},${y(min)} L${x(seg[0])},${y(min)} Z" fill="url(#fill-${container})"/><path d="${coords}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>`;}
    for(let i=0;i<=4;i++){const timestamp=tmin+(tmax-tmin)*i/4;svg+=`<text x="${L+plotW*i/4}" y="${H-8}" text-anchor="${i===0?'start':i===4?'end':'middle'}">${tmax-tmin<90000?time(timestamp):shortDate(timestamp)}</text>`;}
  }
  svg+='</svg>';el.innerHTML=svg;
  const tooltip=document.createElement('div');tooltip.className='tooltip';tooltip.hidden=true;el.append(tooltip);
  el.onpointermove = event => {
    const box=el.getBoundingClientRect(), px=(event.clientX-box.left)/box.width*W;
    let nearest=0,best=Infinity;p.forEach((a,i)=>{const diff=Math.abs(x(a,i)-px);if(diff<best){best=diff;nearest=i;}});
    const a=p[nearest];tooltip.innerHTML=`<small>${shortDate(a.t)}${type==='line'?' · '+time(a.t):''}</small>${num(a.value,decimals)} ${unit}`;
    tooltip.hidden=false;tooltip.style.left=`${Math.max(60,Math.min(box.width-60,x(a,nearest)/W*box.width))}px`;tooltip.style.top=`${Math.max(40,y(a.value)/H*box.height)}px`;
  };
  el.onpointerleave=()=>{tooltip.hidden=true;};
}
function series(p,key,{scale=1,step=1}={}) {
  const out=[];
  // Keep missing intervals visible. Average only contiguous groups of readings.
  let group=[];
  const flush=()=>{if(group.length){out.push({t:group[Math.floor(group.length/2)].t,value:sum(group,key)/group.length*scale});group=[];}};
  for(const a of p){if(!Number.isFinite(a[key])){flush();continue;}if(group.length&&a.t-group.at(-1).t>60)flush();group.push(a);if(group.length>=step)flush();}flush();return out;
}
function render() {
  selected=points.filter(p=>$('period').value==='all'||dayKey(p.t)===$('period').value);
  const p=selected,trips=journeys(p),km=distance(p),moving=sum(p,'moving'),peak=bounds(p,'maxSpeed')[1],soc=lastValue(p,'soc'),range=lastValue(p,'range');
  const energyOut=sum(p,'energyOut'),energyIn=sum(p,'energyIn');
  const chargeSeconds=p.reduce((total,a)=>total+(a.chargePower>0?(a.samples||0):0),0);
  const titles={overview:['Your drive, at a glance.','The places you went. The energy you used. All in one place.','Overview'],journeys:['Every journey, in perspective.','Explore when you drove, how far you went, and time spent moving.','Journeys'],battery:['A little energy intelligence.','Follow your battery, charging, and the power behind each drive.','Battery & energy'],vehicle:['Get to know your XPENG.','A simple view of the vehicle readings in your export.','Vehicle health']};
  const title=titles[view];$('pageTitle').textContent=title[0];$('pageDescription').textContent=title[1];$('crumb').textContent=title[2];
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  $('hero').hidden=view!=='overview';
  $('heroText').textContent=`${num(km)} kilometres. ${trips.length} driving sessions. A small snapshot of life with your XPENG.`;
  $('dateLabel').textContent=`${shortDate(p[0].t)} — ${date(p.at(-1).t,{day:'numeric',month:'short',year:'numeric'})}`;
  $('coverageLabel').textContent=`${daily(p).length} calendar days covered`;
  const common=[metric('Distance travelled',num(km),'km','From recorded odometer','⌁'),metric('Time in motion',duration(moving),'','Recorded speed above 1 km/h','◷')];
  if(view==='battery')$('metrics').innerHTML=metric('Latest battery level',num(soc),'%',`Last reading · ${shortDate(p.at(-1).t)} ${time(p.at(-1).t)}`,'ϟ')+metric('Battery energy out',num(energyOut,1),'kWh','Estimated · includes stationary use','↗')+metric('Battery energy in',num(energyIn,1),'kWh','Estimated · charging and regeneration','↙')+metric('Charging detected',duration(chargeSeconds),'','Minutes with positive charge power','⌁');
  else if(view==='vehicle')$('metrics').innerHTML=metric('Latest odometer',num(lastValue(p,'odometer')),'km','Last available reading','⌁')+metric('Estimated range',num(range),'km','Vehicle estimate at last reading','↗')+metric('Battery temperature',num(lastValue(p,'tempMax')),'°C','Maximum sensor at last reading','♧')+metric('Latest battery level',num(soc),'%','Displayed state of charge','ϟ');
  else $('metrics').innerHTML=common.join('')+metric('Peak recorded speed',num(peak),'km/h','Highest original speed sample','↗')+metric('Latest battery level',num(soc),'%',`<b>${num(range)} km</b> estimated remaining range`,'ϟ');
  const step=p.length>2000?10:p.length>500?4:1;
  $('mainChartTitle').textContent=view==='battery'?'Power at the battery':view==='vehicle'?'Battery temperature':view==='journeys'?'When you were moving':'A week on the road';
  $('mainChartSubtitle').textContent=view==='battery'?'Positive: energy out · negative: energy in':view==='vehicle'?'Maximum sensor reading over time':view==='journeys'?'Recorded speed across the selected period':'Distance travelled, day by day';
  $('chartUnit').textContent=view==='battery'?'kW':view==='vehicle'?'°C':view==='journeys'?'km/h':'km';
  if(view==='overview')chart('mainChart',daily(p),{type:'bar',unit:'km'});
  if(view==='journeys')chart('mainChart',series(p,'speed',{step}),{unit:'km/h'});
  if(view==='vehicle')chart('mainChart',series(p,'tempMax',{step}),{unit:'°C',maximum:Math.max(25,bounds(p,'tempMax')[1]*1.15),color:'#96a779'});
  if(view==='battery') {const power=p.map(a=>({...a,power:a.voltage*a.current/1000}));const b=bounds(power,'power');chart('mainChart',series(power,'power',{step}),{unit:'kW',minimum:Math.min(-5,b[0]*1.1),maximum:Math.max(5,b[1]*1.1),decimals:1});}
  $('secondChartTitle').textContent=view==='vehicle'?'Tyre pressure trend':'Battery rhythm';
  $('secondChartSubtitle').textContent=view==='vehicle'?'Front left · as recorded in the export':'Displayed state of charge over time';
  $('secondLegend').textContent=view==='vehicle'?'Front left':'Battery';
  chart('secondChart',series(p,view==='vehicle'?'tyreFL':'soc',{step}),{unit:view==='vehicle'?'kPa':'%',minimum:view==='vehicle'?200:0,maximum:view==='vehicle'?320:100,decimals:view==='vehicle'?1:0});
  const socBounds=bounds(p,'soc');
  $('batteryFooter').innerHTML=view==='vehicle'?`<span>Latest front left <b>${num(lastValue(p,'tyreFL'),1)} kPa</b></span><span>All four tyres below ↓</span>`:`<span>Lowest <b>${num(socBounds[0])}%</b></span><span>Highest <b>${num(socBounds[1])}%</b></span><span>Latest <b>${num(soc)}%</b></span>`;
  $('activityTitle').textContent=view==='battery'?'Charging activity':view==='vehicle'?'Latest tyre pressures':'Your journeys';
  $('activitySubtitle').textContent=view==='battery'?'Sessions with positive recorded charging power':view==='vehicle'?'Last available reading · kPa':'Movement grouped with a 5-minute inactivity gap';
  $('allJourneys').hidden=view!=='overview';
  if(view==='vehicle')$('activity').innerHTML=[['Front left','tyreFL'],['Front right','tyreFR'],['Rear left','tyreRL'],['Rear right','tyreRR']].map(([label,key])=>detail(label,`${num(lastValue(p,key),1)} kPa`)).join('')+'<div class="insight-callout">Compare with the pressure specification on your vehicle’s tyre placard. These readings vary with temperature and driving.</div>';
  else if(view==='battery') {
    const sessions=[];let session;
    for(const a of p){if(!(a.chargePower>0))continue;if(!session||a.t-session.end>180){session={start:a.t,end:a.t,points:[]};sessions.push(session);}session.end=a.t;session.points.push(a);}
    $('activity').innerHTML=sessions.length?sessions.map(s=>`<div class="trip-row"><div class="trip-icon">ϟ</div><div class="trip-title">${shortDate(s.start)} · Charging<span class="trip-time">${time(s.start)} — ${time(s.end+60)} · ${num(s.points[0].soc)}% → ${num(s.points.at(-1).soc)}%</span></div><div class="trip-distance">${num(bounds(s.points,'chargePower')[1],1)} <small>kW peak</small></div><div class="trip-duration">${duration(sum(s.points,'samples'))}</div></div>`).join(''):'<p class="empty-state">No charging recorded in this period.</p>';
  } else {
    const visible=view==='journeys'?[...trips].reverse():[...trips].reverse().slice(0,4);
    $('activity').innerHTML=visible.length?visible.map(s=>`<div class="trip-row"><div class="trip-icon">↗</div><div class="trip-title">${date(s.start,{weekday:'short',day:'numeric',month:'short'})}<span class="trip-time">${time(s.start)} — ${time(s.end+60)} · ${num(s.peak)} km/h peak</span></div><div class="trip-distance">${num(s.km)} <small>km</small></div><div class="trip-duration">${duration(s.seconds)}</div></div>`).join(''):'<p class="empty-state">No driving sessions in this period.</p>';
  }
  $('insightTitle').textContent=view==='battery'?'Energy, explained':view==='journeys'?'Your driving snapshot':'The little details';
  $('insightSubtitle').textContent=view==='battery'?'Estimates from one-second source samples':'A closer look at your selected period';
  if(view==='battery')$('insights').innerHTML=detail('Battery energy out',`${num(energyOut,1)} kWh`)+detail('Battery energy in',`${num(energyIn,1)} kWh`)+detail('Net battery energy',`${num(energyOut-energyIn,1)} kWh`)+detail('Peak recorded charge power',`${num(bounds(p,'chargePower')[1],1)} kW`)+ '<div class="insight-callout">Energy in includes charging and regenerative braking. Energy out includes stationary use. These are battery-side estimates, not charger totals.</div>';
  else if(view==='journeys')$('insights').innerHTML=detail('Driving sessions',num(trips.length))+detail('Average session distance',`${num(trips.length?km/trips.length:0,1)} km`)+detail('Time in motion',duration(moving))+detail('Longest recorded session',trips.length?`${num(Math.max(...trips.map(s=>s.km)))} km`:'—')+'<div class="insight-callout">Sessions are inferred from movement. The export can cut off a journey at either end. No location data is available.</div>';
  else $('insights').innerHTML=detail('Latest odometer',`${num(lastValue(p,'odometer'))} km`)+detail('Estimated remaining range',`${num(range)} km`)+detail('Battery sensor range',`${num(lastValue(p,'tempMin'))}–${num(lastValue(p,'tempMax'))} °C`)+detail('Recorded charging time',duration(chargeSeconds))+'<div class="insight-callout">A snapshot from your export, not a live connection to your car. Select a day to explore it in more detail.</div>';
}
function showInfo(){ $('infoDialog').showModal(); }
$('sourceButton').onclick=showInfo;$('methodButton').onclick=showInfo;
$('closeDialog').onclick=()=>$('infoDialog').close();
$('infoDialog').addEventListener('click',e=>{if(e.target===$('infoDialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{view=button.dataset.view;history.replaceState(null,'',`#${view}`);if(dataset)render();});
window.addEventListener('hashchange',()=>{const next=location.hash.slice(1);if(['overview','journeys','battery','vehicle'].includes(next)){view=next;if(dataset)render();}});
$('allJourneys').onclick=()=>{view='journeys';history.replaceState(null,'','#journeys');render();window.scrollTo({top:0,behavior:'smooth'});};
$('period').onchange=()=>{if(dataset)render();};
$('downloadButton').onclick=()=>{
  if(!selected.length)return;
  const csv='Date,Distance (km),Time in motion (min)\r\n'+daily(selected).map(a=>`${dayKey(a.t)},${a.value},${num(a.minutes,2).replaceAll(',','')}`).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='xpeng-driving-summary.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
async function init(){
  try {
    const embedded=document.getElementById('telemetry-data');
    if(embedded)dataset=JSON.parse(embedded.textContent);
    else {const response=await fetch('data.json');if(response.status===404)dataset={schemaVersion:2,vehicleId:null,model:null,sources:[],counts:{},uniqueCounts:{},resolutionSeconds:60,points:[]};else{if(!response.ok)throw new Error(`Unable to load export (${response.status})`);dataset=await response.json();}}
    try {const saved=await journalStorage('read');if(saved?.schemaVersion===2&&(!dataset.vehicleId||saved.vehicleId===dataset.vehicleId)&&containsJournal(saved,dataset)){dataset=saved;setImportStatus('Your saved journal has been restored from this browser.');}}catch{setImportStatus('Browser storage is unavailable here. Use Save journal after importing to keep a portable copy.');}
    points=dataset.points;
    if(!points?.length){$('loading').textContent='Your journal is ready. Click Add data to import your first XPENG ZIP export or telemetry CSV files.';return;}
    refreshJournal();
    view=['overview','journeys','battery','vehicle'].includes(location.hash.slice(1))?location.hash.slice(1):'overview';
    render();$('loading').hidden=true;$('dashboard').hidden=false;
  }catch(error){$('loading').textContent=`Could not open the driving journal. ${error.message} Run the local server and check that data.json is present.`;}
}
function setImportStatus(message,error=false){$('importStatus').hidden=false;$('importStatus').textContent=message;$('importStatus').classList.toggle('import-error',error);}
function containsJournal(candidate,base){
  const map=new Map(candidate.points.map(p=>[p.t,p]));
  return base.points.every(p=>{const q=map.get(p.t);return q&&Object.entries(p._coverage||{}).every(([k,mask])=>[...mask].every((bit,i)=>bit!=='1'||q._coverage?.[k]?.[i]==='1'));});
}
function refreshJournal(){
  points=dataset.points;
  const previous=$('period').value,days=new Map();
  for(const p of points){const key=dayKey(p.t);if(!days.has(key))days.set(key,p.t);}
  $('period').replaceChildren(new Option('Entire journal','all'));
  for(const [key,t] of days)$('period').append(new Option(date(t,{weekday:'short',day:'numeric',month:'short',year:'numeric'}),key));
  $('period').value=days.has(previous)?previous:'all';
  $('modelLabel').textContent=`Model code ${dataset.model}`;
  const c=dataset.uniqueCounts||dataset.counts;
  $('sourceDetails').innerHTML=`<div class="source-stats">${shortDate(points[0].t)} — ${date(points.at(-1).t,{day:'numeric',month:'short',year:'numeric'})}<br>${num(c.operation)} driving · ${num(c.power_energy)} energy · ${num(c.status)} status records<br>${num((dataset.sources||[dataset.source]).length)} source files · overlapping timestamps counted once<br>${num(points.length)} one-minute chart summaries</div>`;
}
function journalStorage(mode,value){
  return new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB){reject(new Error('Storage unavailable'));return;}
    const open=indexedDB.open('xpeng-drive-journal',1);let finished=false;
    const timer=setTimeout(()=>{finished=true;reject(new Error('Storage timed out'));},8000);
    const fail=error=>{if(!finished){finished=true;clearTimeout(timer);reject(error);}};
    open.onupgradeneeded=()=>open.result.createObjectStore('journals');
    open.onerror=()=>fail(open.error);open.onblocked=()=>fail(new Error('Storage is blocked'));
    open.onsuccess=()=>{
      const db=open.result;if(finished){db.close();return;}
      try{const tx=db.transaction('journals',mode==='write'?'readwrite':'readonly'),store=tx.objectStore('journals');
        let req=mode==='write'?store.put(value,'current'):store.get('current');
        if(mode==='read'&&dataset.vehicleId)req.onsuccess=()=>{if(!req.result)req=store.get(dataset.vehicleId);};
        tx.oncomplete=()=>{db.close();if(!finished){finished=true;clearTimeout(timer);resolve(req.result);}};
        tx.onerror=()=>{db.close();fail(tx.error);};tx.onabort=()=>{db.close();fail(tx.error||new Error('Storage write aborted'));};
      }catch(e){db.close();fail(e);}
    };
  });
}
$('importButton').onclick=()=>{if(dataset)$('importFiles').click();};
$('importFiles').onchange=async()=>{
  const files=[...$('importFiles').files];if(!files.length||!dataset)return;
  $('importButton').disabled=true;$('saveJournalButton').disabled=true;
  try{
    const result=await XpengImport.mergeFiles(dataset,files,setImportStatus);
    dataset=result.data;refreshJournal();render();$('loading').hidden=true;$('dashboard').hidden=false;
    let saved=true;try{await journalStorage('write',dataset);}catch{saved=false;}
    setImportStatus(`${num(result.added)} new records added · ${num(result.duplicates)} overlapping records skipped${result.invalid?` · ${num(result.invalid)} invalid timestamps skipped`:''}. ${saved?'Saved in this browser. Save journal for a portable backup.':'Browser storage unavailable: use Save journal to keep your imported data.'}`);
  }catch(e){setImportStatus(`Import cancelled. Your journal is unchanged. ${e.message}`,true);}
  finally{$('importButton').disabled=false;$('saveJournalButton').disabled=false;$('importFiles').value='';}
};
$('saveJournalButton').onclick=async()=>{
  if(!dataset?.points?.length)return;$('saveJournalButton').disabled=true;
  try{
    const copy=document.documentElement.cloneNode(true);
    let embedded=copy.querySelector('#telemetry-data');
    if(!embedded){embedded=document.createElement('script');embedded.id='telemetry-data';embedded.type='application/json';copy.querySelector('body').prepend(embedded);}
    embedded.textContent=JSON.stringify(dataset).replaceAll('<','\\u003c');
    // Inline application assets when saving from the server version as well.
    for(const script of copy.querySelectorAll('script[src]')){const response=await fetch(script.getAttribute('src'));if(!response.ok)throw new Error('Could not embed application code.');script.textContent=(await response.text()).replaceAll('</script','<\\/script');script.removeAttribute('src');}
    for(const link of copy.querySelectorAll('link[rel="stylesheet"]')){const response=await fetch(link.getAttribute('href'));if(!response.ok)throw new Error('Could not embed styles.');const style=document.createElement('style');style.textContent=await response.text();link.replaceWith(style);}
    const car=copy.querySelector('img[src="g9.svg"]');if(car){const response=await fetch('g9.svg');if(!response.ok)throw new Error('Could not embed illustration.');car.outerHTML=await response.text();}
    copy.querySelectorAll('dialog[open]').forEach(d=>d.removeAttribute('open'));
    copy.querySelector('#importStatus').hidden=true;
    copy.querySelector('#importButton').disabled=false;copy.querySelector('#saveJournalButton').disabled=false;
    const url=URL.createObjectURL(new Blob(['<!doctype html>\n'+copy.outerHTML],{type:'text/html;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='xpeng-journal.html';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    setImportStatus('Journal copy prepared for download, including all imported data. Keep the downloaded HTML file as your backup.');
  }catch(e){setImportStatus(`Could not save the journal. ${e.message}`,true);}finally{$('saveJournalButton').disabled=false;}
};
init();
