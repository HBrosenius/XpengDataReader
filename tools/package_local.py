"""Build a portable HTML dashboard that opens without a local web server."""
from pathlib import Path
import json

root = Path(__file__).resolve().parents[1]
dist = root / 'dist'
html = (dist / 'index.html').read_text(encoding='utf-8')
css = (dist / 'style.css').read_text(encoding='utf-8')
js = (dist / 'app.js').read_text(encoding='utf-8')
data = (dist / 'data.json').read_text(encoding='utf-8') if (dist / 'data.json').exists() else json.dumps({'schemaVersion':2,'vehicleId':None,'model':None,'sources':[],'counts':{},'uniqueCounts':{},'resolutionSeconds':60,'points':[]})
html = html.replace('<link rel="stylesheet" href="style.css">', f'<style>{css}</style>')
html = html.replace('<img src="g9.svg" alt="Silver XPENG G9 Performance SUV">', (dist / 'g9.svg').read_text(encoding='utf-8'))
html = html.replace('<script src="import.js"></script>', '<script>' + (dist / 'import.js').read_text(encoding='utf-8').replace('</script', '<\\/script') + '</script>')
html = html.replace('<script src="app.js"></script>', '<script id="telemetry-data" type="application/json">' + data.replace('<', '\\u003c') + '</script><script>' + js.replace('</script', '<\\/script') + '</script>')
target = root / 'dashboard.html'
target.write_text(html, encoding='utf-8')
print(f'Portable dashboard saved: {target}')
