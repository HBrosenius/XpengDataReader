# XPENG Drive Journal

A clean, responsive dashboard for XPENG GDPR telemetry exports.
Includes overview, inferred driving sessions, battery and charging analysis,
vehicle sensor readings, daily filtering, chart tooltips and CSV summary export.

No personal telemetry is included in this repository. Start the dashboard and
click **Add data** to import your own export. Processing happens in your browser.
Use **Save journal** for a portable HTML copy with your combined data. Fonts use
an online stylesheet with local fallback fonts.

## Add more data

Click **Add data** in the dashboard and select one or more XPENG export ZIPs,
or extracted telemetry CSVs with their original filenames. Data is processed
locally and merged into the existing journal. Overlapping seconds are skipped
per telemetry category, including partial-minute overlaps. Exports for a different
vehicle are rejected. A failed selection leaves the loaded journal unchanged.

Imports are saved in this browser using IndexedDB when available. Browser data
can be cleared, and file-based storage varies between browsers, so use **Save
journal** to download a portable HTML backup containing all combined data. Open
that copy to continue later or on another computer. Nothing is uploaded.

Run import verification with `node --test tools/import.test.cjs`.

## Run locally

Requires Node.js 18 or newer. No npm dependencies or build step.

```powershell
npm start
```

Open http://127.0.0.1:4173. A fresh checkout starts with an empty journal.

## Optional: prepare an export with Python

Requires Python 3.10 or newer; no third-party libraries.

```powershell
python tools/prepare_data.py "path\to\export.zip"
python tools/package_local.py
```

Open the generated `dashboard.html`, or refresh the local server after processing.
Running `python tools/package_local.py` without data also creates an empty portable
journal ready for browser imports. Source CSVs are read directly from the ZIP
without extraction. Only the three recognized telemetry filenames are read; file
contents are treated as data. The dashboard dataset excludes VIN, but still
contains personal vehicle telemetry. Keep its hosting private.

## Calculation notes

- Timestamps are interpreted as Unix seconds and displayed in Europe/Stockholm.
- Duplicate timestamps within each source CSV are counted once for calculations.
- Charts contain minute averages; source peak speed is retained separately.
- Distance is max minus min odometer within the selected period.
- Moving time is the count of source seconds with speed above 1 km/h.
- Driving sessions are inferred from moving minutes with 5-minute inactivity gaps.
- Power is battery voltage × current. Energy integrates each source sample as one
  second. Positive and negative flows are summed separately. Missing source
  samples are not filled. Charging and regeneration both contribute to energy in.
- Charging time counts seconds in minutes with positive average charging power,
  so its duration is approximate at session boundaries.
- Vehicle range is the car's reported estimate. Tyre values are shown in kPa;
  verify pressure units against export documentation if supplied separately.
- There are no GPS coordinates or route maps in this export.

Static application files are in `dist/`. The original ZIP is ignored by Git.
