import json, numpy as np, soundfile as sf, torch
from speechbrain.inference.speaker import EncoderClassifier
from sklearn.cluster import AgglomerativeClustering
from sklearn.metrics import silhouette_score
d=json.load(open('/tmp/dub/jp.json')); a,sr=sf.read('/tmp/dub/v16.wav',dtype='float32')
clf=EncoderClassifier.from_hparams(source="speechbrain/spkrec-ecapa-voxceleb",savedir="/tmp/dub/ecapa",run_opts={"device":"cpu"})
E=[]
for s in d:
    x=a[int(s['start']*sr):int(s['end']*sr)]
    if len(x)<sr*0.6: x=np.pad(x,(0,int(sr*0.6)-len(x)))
    with torch.no_grad(): e=clf.encode_batch(torch.tensor(x)[None]).squeeze().numpy()
    E.append(e/np.linalg.norm(e))
E=np.array(E); best=None
for k in range(2,9):
    lab=AgglomerativeClustering(n_clusters=k,metric='cosine',linkage='average').fit_predict(E)
    sc=silhouette_score(E,lab,metric='cosine'); print(k,round(sc,3)); 
    if best is None or sc>best[0]: best=(sc,k,lab)
lab=best[2]; print('chosen k',best[1])
for s,l in zip(d,lab): s['spk']=int(l)
json.dump(d,open('/tmp/dub/jp_spk.json','w'),ensure_ascii=False)
for c in range(best[1]):
    segs=sorted([s for s in d if s['spk']==c],key=lambda s:-(s['end']-s['start']))[:3]
    clip=np.concatenate([a[int(s['start']*sr):int(s['end']*sr)] for s in segs])[:sr*12]
    sf.write(f'/tmp/dub/spk{c}.wav',clip,sr); print('spk',c,'lines',sum(1 for s in d if s['spk']==c))
