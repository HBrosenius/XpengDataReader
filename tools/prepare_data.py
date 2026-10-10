"""Convert the original XPENG CSV ZIP into a compact dashboard dataset.

Raw records and VIN are never included in the web output. Times are UTC Unix
seconds; the browser displays them in Europe/Stockholm.
"""
import csv
import io
import json
import math
import hashlib
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIELDS = {
    'operation': {'esp_vehspd':'speed','cdcu_totalodometer':'odometer','esp_vehlongaccel':'acceleration'},
    'power_energy': {'bms_battvolt':'voltage','bms_battcurr':'current','ldcu_chrgpwr':'chargePower','ldcu_bms_soc_disp':'soc','bms_batttempmax_gb':'tempMax','bms_batttempmin_gb':'tempMin','ldcu_dstbatdisp_dynamic':'range'},
    'status': {'ldcu_tpmsprfl':'tyreFL','ldcu_tpmsprfr':'tyreFR','ldcu_tpmsprrl':'tyreRL','ldcu_tpmsprrr':'tyreRR'},
}

def prepare(source, target):
    buckets = defaultdict(lambda: defaultdict(list))
    counts = {}
    unique_counts = {}
    model = None
    vehicle_id = None
    coverage = defaultdict(lambda: defaultdict(set))
    with zipfile.ZipFile(source) as archive:
        for category, fields in FIELDS.items():
            entries = [n for n in archive.namelist() if n.endswith(category + '_di.csv')]
            if len(entries) != 1:
                raise ValueError(f'Expected one {category} CSV, found {len(entries)}')
            count = 0
            seen = set()
            with archive.open(entries[0]) as raw:
                for row in csv.DictReader(io.TextIOWrapper(raw, encoding='utf-8-sig')):
                    count += 1
                    model = model or row.get('vmodel')
                    if vehicle_id is None and row.get('vin'):
                        vehicle_id = hashlib.sha256(row['vin'].encode()).hexdigest()
                    try:
                        timestamp = int(float(row['timer']))
                    except (ValueError, KeyError):
                        continue
                    if timestamp in seen:
                        continue
                    seen.add(timestamp)
                    bucket = buckets[timestamp // 60 * 60]
                    coverage[timestamp // 60 * 60][category].add(timestamp % 60)
                    if category == 'power_energy':
                        try:
                            power = float(row['bms_battvolt']) * float(row['bms_battcurr']) / 1000
                            if math.isfinite(power):
                                bucket['energyOut'].append(max(0, power) / 3600)
                                bucket['energyIn'].append(max(0, -power) / 3600)
                        except (ValueError, KeyError):
                            pass
                    for name, key in fields.items():
                        try:
                            val = float(row.get(name, ''))
                        except (ValueError, TypeError):
                            continue
                        if not math.isfinite(val):
                            continue
                        if key == 'speed' and not 0 <= val <= 300: continue
                        if key == 'soc' and not 0 <= val <= 100: continue
                        if key.startswith('tyre') and not 50 <= val <= 500: continue
                        bucket[key].append(val)
                    if category == 'operation':
                        bucket['samples'].append(timestamp)
                        if row.get('esp_vehspd'):
                            try:
                                if float(row['esp_vehspd']) > 1: bucket['moving'].append(1)
                            except ValueError: pass
            counts[category] = count
            unique_counts[category] = len(seen)
            print(f'{category}: {count:,} records', flush=True)
    result = []
    for timestamp, values in sorted(buckets.items()):
        point = {'t': timestamp}
        point['_coverage'] = {k: ''.join('1' if i in seconds else '0' for i in range(60)) for k, seconds in coverage[timestamp].items()}
        point['_stats'] = {k: [sum(v), len(v)] for k, v in values.items() if k not in ('samples', 'moving', 'energyOut', 'energyIn')}
        for key, items in values.items():
            if key in ('energyOut', 'energyIn'): point[key] = round(sum(items), 6)
            elif key == 'samples': point['samples'] = len(set(items))
            elif key == 'moving': point['moving'] = len(items)
            else: point[key] = round(sum(items) / len(items), 3)
        if 'speed' in values: point['maxSpeed'] = round(max(values['speed']), 2)
        if 'odometer' in values:
            point['odoMin'] = min(values['odometer'])
            point['odoMax'] = max(values['odometer'])
        result.append(point)
    data = {'schemaVersion':2, 'vehicleId':vehicle_id, 'model': model, 'source': Path(source).name, 'sources':[Path(source).name], 'counts': counts, 'uniqueCounts':unique_counts, 'resolutionSeconds':60, 'points':result}
    Path(target).parent.mkdir(parents=True, exist_ok=True)
    Path(target).write_text(json.dumps(data, separators=(',', ':')), encoding='utf-8')
    print(f'{len(result):,} minute buckets; {Path(target).stat().st_size:,} bytes')
    print(json.dumps({'first':result[0], 'last':result[-1]}))

if __name__ == '__main__':
    prepare(Path(sys.argv[1]) if len(sys.argv)>1 else next(ROOT.glob('*.zip')), ROOT/'dist'/'data.json')
