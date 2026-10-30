import json,sys,os,gzip
from rpc import logs
from blocks import day_range
day=sys.argv[1]; pools=json.load(open(sys.argv[2] if len(sys.argv)>2 else 'allpools.json'))
s,e,a,b=day_range(day)
a20=sorted(p for p in pools if len(p)==42)
ids=sorted(set([p for p in pools if len(p)==66]+[p.split('-')[1] for p in pools if '-' in p]))
EMIT=["0x0310cfebe1d7a69f2414f6595bbe9d17c5342acc", "0x2093dfc86b1c59b120a4453a958aaed7c6ab68c4", "0x20f8b7ec9cc3bb5c739dedb15a8b4275f84b00c8", "0x33e924fb8663871bab61d6844e79cdea159c60c0", "0x4468322dccd822a0d81c95d25e5dc51e45551afc", "0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544", "0x550cfe1292d0d9c0d28f232b3f42edb4439b1d09", "0x582ce3ff87e8f64063c9a546a0587534863e52ef", "0x5eb87f69be00df39981622fd60a8de4b7837e080", "0x5ee081d5100ae4233269928590d72e2f23f72909", "0x5f9eb5f6726fe88d5e39867967f5b833d2fa3215", "0x630853c520f00e712268a3d55a376a267c7c4118", "0x66622f77b797d506e5376f7798b67ab288966080", "0x672c572c6caaafce3cc4d91b20c9d4ea7adce201", "0x73dfd2aec79c0e8990906628c1718f878f8ec0c8", "0x778b0c4eea7d35d66513b587ba87fc9084b0eacc", "0x8366a39cc670b4001a1121b8f6a443a643e40951", "0x95062972d0b41975390e58efc49a50d6f268cc5d", "0x992118de23b4ebe9f527dacbbb7d8d4bbbf8e044", "0x9c4c1ffad1ce3c71ae1ea23ed43316cea11774bb", "0xa1018c1d9655292a2de0f7dea9a0f848eaa8ca83", "0xa4e6f5500e88691fdcb289aa0e99067481434880", "0xca89f079af00f752bfd3c345358dc38d4d73e080", "0xd01c774d4a66408326bc65728ac5ae5aaf004032", "0xd065aac3419a018def2e1f118ada0acf6a439468", "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044", "0xee04c68742e6bf434be8039580d2e89bbe55bc6f", "0xf199d378b402fd292df4aed03bf9a48fc8485cc8", "0xf7358b2fbabcc45ace8fbe656ff24e3f2b36898a", "0xfa80b85cd044be80795e3344be1a7435dbb3facc"]
out=[]
for i in range(0,len(a20),300): out+=logs({'address':a20[i:i+300]},a,b,20000); print(day,'a20',i,len(out),flush=True)
for i in range(0,len(ids),100): out+=logs({'address':EMIT,'topics':[None,ids[i:i+100]]},a,b,50000); print(day,'ids',i,len(out),flush=True)
keep=[{k:l[k] for k in('address','topics','data','blockNumber','logIndex','transactionHash')} for l in out]
json.dump({'day':day,'range':[s,e,a,b],'logs':keep},gzip.open(f'logs-{day}.json.gz','wt'))
print('done',day,len(keep))
