import json, numpy as np
from scipy.signal import savgol_filter
d = json.load(open('/tmp/w/pose.json')); fr = d['frames']; N=len(fr)
W = np.full((N,33,3), np.nan); S = np.full((N,33,2), np.nan)
for k,f in enumerate(fr):
    if f['world']:
        W[k]=np.array(f['world'])[:,:3]; S[k]=np.array(f['screen'])[:,:2]
idx=np.arange(N)
for A in (W,S):
    for j in range(33):
        for c in range(A.shape[2]):
            v=A[:,j,c]; m=~np.isnan(v); A[:,j,c]=np.interp(idx,idx[m],v[m])
Ws=savgol_filter(W,9,2,axis=0); Ss=savgol_filter(S,9,2,axis=0)
# root: meters per normalized-width unit from shoulder width
ww=np.linalg.norm(Ws[:,11]-Ws[:,12],axis=1); sw=np.abs(Ss[:,11,0]-Ss[:,12,0])+1e-3
scale=np.median(ww/np.maximum(sw,0.05))
hip=(Ss[:,23]+Ss[:,24])/2
root=np.stack([(hip[:,0]-0.5)*scale,np.zeros(N),-(hip[:,1]-0.5)*scale*9/16],1)
root=savgol_filter(root,15,2,axis=0)
json.dump({'fps':d['fps'],'world':Ws.tolist(),'root':root.tolist()},open('/tmp/w/anim.json','w'))
print(N,scale)
