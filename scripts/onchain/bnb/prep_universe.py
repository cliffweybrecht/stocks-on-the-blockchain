"""universe_raw.json = live repo BNB universe (bnb_volume_universe.load_universe) with cached rows unioned in."""
import json,os,sys
sys.path.insert(0,os.environ['REPO_SCRIPTS']); os.chdir(os.environ['REPO_ROOT'])
import bnb_volume_universe as u
res=u.load_universe()
os.chdir(os.environ['WORK'])
rows,errs,meta=(res if isinstance(res,tuple) else (res,[],{}))
cached=json.load(open('universe_raw.json'))[0]
have={r['address'].lower() for r in rows}; add=[r for r in cached if r['address'].lower() not in have]
json.dump([rows+add,errs,dict(meta) if isinstance(meta,dict) else {},],open('universe_raw.json','w'))
print('universe live',len(rows),'cached-only',len(add),'errors',errs)
