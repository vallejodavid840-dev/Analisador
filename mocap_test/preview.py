import json, cv2, numpy as np
from scipy.signal import savgol_filter
d = json.load(open('/tmp/w/pose.json')); fr = d['frames']; fps = d['fps']
N = len(fr)
W = np.full((N,33,3), np.nan); S = np.full((N,33,2), np.nan)
for k,f in enumerate(fr):
    if f['world']:
        W[k] = np.array(f['world'])[:,:3]; S[k] = np.array(f['screen'])[:,:2]
def fill(a):
    a = a.copy(); idx = np.arange(len(a))
    for j in range(a.shape[1]):
        for c in range(a.shape[2]):
            v = a[:,j,c]; m = ~np.isnan(v)
            a[:,j,c] = np.interp(idx, idx[m], v[m])
    return a
W = fill(W); S = fill(S)
Ws = savgol_filter(W, 9, 2, axis=0); Ss = savgol_filter(S, 9, 2, axis=0)
np.save('/tmp/w/world_smooth.npy', Ws)
print('jitter raw/smooth', np.abs(np.diff(W,axis=0)).mean(), np.abs(np.diff(Ws,axis=0)).mean())
E = [(11,12),(11,13),(13,15),(12,14),(14,16),(11,23),(12,24),(23,24),(23,25),(25,27),(24,26),(26,28),(27,31),(28,32),(0,11),(0,12)]
cap = cv2.VideoCapture('/root/.claude/uploads/51f9ae8e-22c7-51fc-a305-c0f4ce5e2a48/8db0bb4e-20261117_184146.mp4')
out = cv2.VideoWriter('/tmp/w/prev.mp4', cv2.VideoWriter_fourcc(*'mp4v'), fps, (960+480, 540))
k = 0
while True:
    ok, im = cap.read()
    if not ok or k >= N: break
    im = cv2.resize(im, (960,540)); h,w = im.shape[:2]
    for a,b in E:
        p=(int(Ss[k,a,0]*w),int(Ss[k,a,1]*h)); q=(int(Ss[k,b,0]*w),int(Ss[k,b,1]*h))
        cv2.line(im,p,q,(0,255,120),3)
    panel = np.full((540,480,3),30,np.uint8)
    P = Ws[k]; 
    for a,b in E:
        # front view x,-y centered at hips
        c = (P[23]+P[24])/2
        f = lambda j:(int(240+(P[j,0]-c[0])*260), int(300+(P[j,1]-c[1])*260))
        cv2.line(panel,f(a),f(b),(255,200,0),4)
    out.write(np.hstack([im,panel])); k+=1
out.release()
import subprocess
subprocess.run('ffmpeg -v error -y -i /tmp/w/prev.mp4 -vf "select=not(mod(n\\,45))" -vsync vfr /tmp/w/pv_%02d.jpg',shell=True)
