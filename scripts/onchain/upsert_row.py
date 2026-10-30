"""Upsert out/DAY.json into data/volume-snapshots/CHAIN.json only when out/DAY.status.json is READY.
Usage: upsert_row.py CHAIN STATUS_JSON ROW_JSON. A NOT READY day writes nothing and exits 0."""
import json, sys, os, tempfile
chain, stp, rowp = sys.argv[1:4]
st = json.load(open(stp))
if not st.get('ready'):
    print(f"{chain} {st.get('day')} NOT READY, row not written:", *st.get('reasons', []), sep='\n  '); sys.exit(0)
row = json.load(open(rowp))
path = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'volume-snapshots', f'{chain}.json')
d = json.load(open(path))
recs = [r for r in d['records'] if r.get('date') != row['date']] + [row]
d['records'] = sorted(recs, key=lambda r: r['date'])
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path)); os.close(fd)
json.dump(d, open(tmp, 'w'), indent=2); open(tmp, 'a').write('\n'); os.replace(tmp, path)
print(f"{chain} {row['date']} READY combined24hUsd={row.get('combined24hUsd')} -> {path}")
