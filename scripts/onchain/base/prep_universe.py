"""universe.json for the run = live desk (snapshot-base-volume.load_universe) U cached state U every asset ever on base.json.
Usage: prep_universe.py DAY  (cwd = work dir; REPO_SCRIPTS, REPO_DATA env)"""
import json,os,sys,importlib.util
S=os.environ['REPO_SCRIPTS']; D=os.environ['REPO_DATA']; sys.path.insert(0,S)
import base_gecko_et as bge
spec=importlib.util.spec_from_file_location('snapbase',os.path.join(S,'snapshot-base-volume.py')); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
desk=m.load_universe().rows
recs=json.load(open(os.path.join(D,'volume-snapshots','base.json')))['records']
known=json.load(open('universe.json'))
tok=bge.index_tokens(desk,known,recs)
json.dump(desk,open('desk_rows.json','w'))
json.dump({k:{'address':v['address'],'symbol':v['symbol'],'issuer':v['issuer'],'kind':v['kind']} for k,v in tok.items()},open('universe.json','w'))
print('universe desk',len(desk),'cached',len(known),'total',len(tok))
