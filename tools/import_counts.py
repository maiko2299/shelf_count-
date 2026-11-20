"""Load past shelf-count spreadsheets into the Inventory Count API as dated, finished sessions.

Usage:  COUNT_NAME=Mike COUNT_PIN=xxxx python import_counts.py <folder with the .xlsx files> [--dry-run]
Needs openpyxl (and certifi on python.org builds of Python). Each sheet becomes one session (source "import"); re-running updates the same rows.
"""
import json, os, re, sys, ssl, urllib.parse, urllib.request
import openpyxl
try:
    import certifi; CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    CTX = ssl.create_default_context()

API = 'https://n8n.ngadvantage.com/webhook/inventory-count'
# file -> (warehouse key, area, count date). Dates come from the sheet title where it says, else the file's save date.
FILES = {
    'CI1 Counted.xlsx':                        (13, 'CI1', '2026-11-10'),
    'Counted inventory CI2 Shelf started.xlsx': (13, 'CI2', '2026-10-19'),
    'CI3 shelf .xlsx':                         (13, 'CI3', '2026-11-17'),
    'CI4 Shelf count.xlsx':                    (13, 'CI4', '2026-10-22'),
    'CI5 Shelf Counted .xlsx':                 (13, 'CI5', '2026-10-23'),
    'CI6 Shelf counted .xlsx':                 (13, 'CI6', '2026-10-30'),
    'CI7 Count.xlsx':                          (13, 'CI7', '2026-11-07'),
    'CI8 Counted .xlsx':                       (13, 'CI8', '2026-11-13'),
    'Blank no bins assigned .xlsx':            (13, 'No bin', '2026-11-17'),
    'Sylvamo W-H count variances.xlsx':        (17, 'Sylvamo Paper', '2026-11-19'),
}
WH_NAMES = {13: 'Milton Ops controlled II', 17: 'Sylvamo Paper'}
COUNT_COL = re.compile(r'^(counted|count|physical count|counted qty)$', re.I)

def call(action, **body):
    payload = json.dumps({'action': action, 'name': os.environ['COUNT_NAME'], 'pin': os.environ['COUNT_PIN'], **body})
    req = urllib.request.Request(API, data=urllib.parse.urlencode({'payload': payload}).encode(), method='POST')
    with urllib.request.urlopen(req, timeout=180, context=CTX) as r:
        return json.loads(r.read())

def num(v):
    if v is None or v == '': return None
    try: return float(str(v).replace('$', '').replace(',', ''))
    except ValueError: return None

def norm(s): return re.sub(r'[^A-Z0-9]', '', str(s or '').upper())

def read_sheet(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.worksheets[0]
    rows = [r for _, r in zip(range(3000), ws.iter_rows(values_only=True))]
    hi = next(i for i, r in enumerate(rows) if r and any(isinstance(c, str) and c.strip().lower() in ('part id', 'sheet2') for c in r[:3]))
    H = [str(c or '').strip() for c in rows[hi]]
    col = lambda *names: next((i for i, h in enumerate(H) if h.lower() in names), None)
    ci = dict(id=0 if H[0].lower() in ('part id', 'sheet2') else col('part id'), desc=col('description'), loc=col('bin location', 'location'),
              onhand=col('on hand', 'on hand (m+)'), cost=col('current cost', 'unit cost'),
              count=next(i for i, h in enumerate(H) if COUNT_COL.match(h)),
              notes=[i for i, h in enumerate(H) if h.lower() in ('notes', 'count notes', 'result', 'legend', 'count location')])
    out = []
    for r in rows[hi + 1:]:
        if not r or r[ci['id']] in (None, ''): continue
        qty = num(r[ci['count']]) if ci['count'] < len(r) else None
        if qty is None: continue
        g = lambda k: r[ci[k]] if ci[k] is not None and ci[k] < len(r) else None
        out.append(dict(partId=str(g('id')).strip(), desc=str(g('desc') or '').strip(), loc=str(g('loc') or '').strip(),
                        onHand=num(g('onhand')), cost=num(g('cost')), qty=qty,
                        notes='; '.join(str(r[i]).strip() for i in ci['notes'] if i < len(r) and r[i] not in (None, ''))))
    return out

def main():
    folder, dry = sys.argv[1], '--dry-run' in sys.argv
    systems = {}
    for wk in {v[0] for v in FILES.values()}:
        res = call('load', warehouseKey=wk)
        systems[wk] = {norm(p['id']): p for p in res['parts']}
    for fname, (wk, area, day) in FILES.items():
        path = os.path.join(folder, fname)
        if not os.path.exists(path): print('missing', fname); continue
        rows = read_sheet(path)
        sid = 'import-' + re.sub(r'[^a-z0-9]+', '-', fname.lower()).strip('-').replace('-xlsx', '')
        at = f'{day}T16:00:00.000Z'
        lines, seen = [], {}
        for r in rows:
            p = systems[wk].get(norm(r['partId']))
            kind = 'r' if p else 'u'
            key = f"{kind}:{p['key'] if p else norm(r['partId'])}"
            seen[key] = seen.get(key, 0) + 1
            if seen[key] > 1: key += f"-{seen[key]}"
            sys_bin = (p['loc'] if p else '') or ''
            found = r['loc'] or (area if not sys_bin else sys_bin)
            status = 'imported' if p else 'not_in_system'
            if p and r['onHand'] is None: status = 'imported_other_location'
            lines.append(dict(id=f'{sid}:{key}', area=area, partKey=p['key'] if p else None, partId=r['partId'], desc=r['desc'] or (p['desc'] if p else ''),
                              systemBin=r['loc'] if r['onHand'] is not None else sys_bin, foundBin=found, qty=r['qty'],
                              systemOnHand=r['onHand'], cost=r['cost'] if r['cost'] is not None else (p['cost'] if p else None),
                              countedAt=at, counter='Mike', status=status, unlisted=not p, notes=r['notes'], source='import'))
        session = dict(id=sid, warehouseKey=wk, warehouseName=WH_NAMES[wk], area=area, counter='Mike', startedAt=at, finishedAt=at,
                       source='import', lineCount=len(lines), notes=f'Imported from {fname}; count date {day} (from the sheet or its save date)')
        unmatched = sum(1 for l in lines if l['unlisted'])
        print(f'{fname}: {len(lines)} lines, {unmatched} not matched to a ManagerPlus part, date {day}')
        if not dry:
            res = call('save', session=session, lines=lines)
            print('   saved' if res.get('ok') else f"   FAILED: {res.get('error')}")

if __name__ == '__main__':
    main()
