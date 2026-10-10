const {test}=require('node:test');
const assert=require('node:assert/strict');
const {deflateRawSync}=require('node:zlib');
const {mergeFiles,crc32}=require('../dist/import.js');
const {createHash}=require('node:crypto');
const vin='TEST-VEHICLE';
const empty=()=>({schemaVersion:2,vehicleId:createHash('sha256').update(vin).digest('hex'),model:'E38V',sources:[],counts:{},points:[]});
const name='export_operation_di.csv';
const csv=(rows,v=vin)=>'vin,vmodel,timer,esp_vehspd,cdcu_totalodometer\r\n'+rows.map(([t,s,o])=>`${v},E38V,${t},${s},${o}`).join('\r\n');
const file=(text,n=name)=>new File([text],n);
test('fresh checkout accepts its first export and establishes vehicle identity',async()=>{
  const base={...empty(),vehicleId:null,model:null};
  const r=await mergeFiles(base,[file(csv([[60,10,100]]))]);
  assert.equal(r.added,1);assert.equal(r.data.vehicleId,empty().vehicleId);assert.equal(r.data.model,'E38V');assert.equal(base.points.length,0);
});
function zip(text,corrupt=false){
  const raw=Buffer.from(text),compressed=deflateRawSync(raw),filename=Buffer.from(name),crc=(crc32(raw)^0xffffffff)>>>0;
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(filename.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(corrupt?0:crc,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(filename.length,28);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+filename.length,12);end.writeUInt32LE(local.length+filename.length+compressed.length,16);
  return new File([local,filename,compressed,central,filename,end],'export.zip');
}
test('partial-minute overlaps merge once and preserve exact averages',async()=>{
  const first=await mergeFiles(empty(),[file(csv([[60,10,100],[61,20,100]]))]);
  const second=await mergeFiles(first.data,[file(csv([[61,999,999],[62,30,101],[120,40,102]]))]);
  assert.equal(second.added,2);assert.equal(second.duplicates,1);
  assert.equal(second.data.points[0].speed,20);assert.equal(second.data.points[0].samples,3);
  assert.equal(second.data.points[0].moving,3);assert.equal(second.data.points[0].maxSpeed,30);
  assert.equal(second.data.points[0].odoMax,101);assert.equal(second.data.uniqueCounts.operation,4);
  const again=await mergeFiles(second.data,[file(csv([[60,10,100],[61,20,100],[62,30,101],[120,40,102]]))]);
  assert.equal(again.added,0);assert.deepEqual(again.data.points,second.data.points);
});
test('battery energies and complementary CSV categories merge independently',async()=>{
  const power='vin,timer,bms_battvolt,bms_battcurr,ldcu_bms_soc_disp\n'+`${vin},60,600,60,70\n${vin},61,600,-30,71`;
  const r=await mergeFiles(empty(),[file(csv([[60,10,100]])),file(power,'export_power_energy_di.csv')]);
  assert.equal(r.data.points[0].soc,70.5);assert.equal(r.data.points[0].energyOut,.01);assert.equal(r.data.points[0].energyIn,.005);
  assert.equal(r.data.uniqueCounts.power_energy,2);assert.equal(r.data.uniqueCounts.operation,1);
  const repeat=await mergeFiles(r.data,[file(power,'export_power_energy_di.csv')]);assert.equal(repeat.added,0);assert.equal(repeat.data.points[0].energyOut,.01);
});
test('different vehicle or malformed later file rolls back the entire selection',async()=>{
  const original=empty(),snapshot=structuredClone(original);
  await assert.rejects(mergeFiles(original,[file(csv([[60,10,100]])),file(csv([[61,20,101]],'OTHER'))]),/different vehicle/);
  assert.deepEqual(original,snapshot);
  await assert.rejects(mergeFiles(original,[file(csv([[60,10,100]])),file('vin,timer\nTEST-VEHICLE,60')]),/missing required/);
  assert.deepEqual(original,snapshot);
});
test('standard deflated ZIP imports and CRC corruption is rejected',async()=>{
  const text=csv([[60,10,100],[61,20,101]]);
  const r=await mergeFiles(empty(),[zip(text)]);assert.equal(r.added,2);
  await assert.rejects(mergeFiles(empty(),[zip(text,true)]),/integrity check/);
});
test('quoted CSV fields, BOM, missing speeds, and invalid timestamps',async()=>{
  const text='\ufeffvin,timer,esp_vehspd,cdcu_totalodometer,note\r\n'+`"${vin}",60,,100,"hello, world"\r\n${vin},61,20,101,"line one\nline two"\r\n${vin},bad,30,101,note`;
  const r=await mergeFiles(empty(),[file(text)]);assert.equal(r.added,2);assert.equal(r.invalid,1);assert.equal(r.data.points[0].speed,20);assert.equal(r.data.points[0].moving,1);
});
