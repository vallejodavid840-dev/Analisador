import numpy as np, cv2, math, os, subprocess, shutil
S=lambda k: cv2.imread(f'/tmp/g/spr/s{k:02d}.png', cv2.IMREAD_UNCHANGED)
W=H=640; FPS=24; GROUND=520
# background: dusk gradient + dark ground (original)
bg=np.zeros((H,W,3),np.uint8)
for y in range(H):
    t=y/H; bg[y]=(int(90+60*t),int(55+35*t),int(70+20*t))   # BGR dusk
cv2.rectangle(bg,(0,GROUND-10),(W,H),(45,60,50),-1)
for x in range(0,W,64): cv2.circle(bg,(x+20,60+(x*7)%80),2,(220,230,240),-1)  # stars
def place(canvas, spr, cx, cy, sx, sy, rot=0, tint=None):
    h,w=spr.shape[:2]
    M=cv2.getRotationMatrix2D((w/2,h/2),rot,1.0)
    big=cv2.warpAffine(spr,M,(w,h),flags=cv2.INTER_LINEAR,borderValue=(0,0,0,0))
    nw,nh=max(int(w*sx),2),max(int(h*sy),2)
    big=cv2.resize(big,(nw,nh),interpolation=cv2.INTER_AREA)
    x0,y0=int(cx-nw/2),int(cy-nh/2)
    xa,ya=max(x0,0),max(y0,0); xb,yb=min(x0+nw,W),min(y0+nh,H)
    if xa>=xb or ya>=yb: return
    s=big[ya-y0:yb-y0, xa-x0:xb-x0]; a=s[...,3:]/255.0
    rgb=s[...,:3].astype(float)
    if tint is not None: rgb=rgb*(1-tint[1])+np.array(tint[0])*tint[1]
    canvas[ya:yb,xa:xb]=(rgb*a+canvas[ya:yb,xa:xb]*(1-a)).astype(np.uint8)
# (name, sprite ids, seconds, scale multiplier, motion)
SEQ=[("idle",[18,36,18,24,1,24],2.0,1.0,"float"),
     ("wave",[19,15,19,15],1.2,1.0,"float"),
     ("thumbs",[33,0,28,32,33,0],1.4,1.0,"float"),
     ("angry",[2,9,22,16,9],1.2,1.0,"shake"),
     ("laugh",[25,29,25,29],1.5,1.15,"laugh"),
     ("dodge",[31,4,20,26,27,34,26,20],1.5,1.0,"dodge"),
     ("idle",[18,36,24,18],1.0,1.0,"float")]
frames=[]; n=0
TARGET=300
for name,ids,secs,mult,motion in SEQ:
    sprs=[S(i) for i in ids]; nf=int(secs*FPS)
    for f in range(nf):
        t=f/FPS; idx=(f//3)%len(sprs); spr=sprs[idx]
        h,w=spr.shape[:2]; base=TARGET/max(h,w)*mult
        sx=sy=base; dx=0; rot=0; bob=10*math.sin(2*math.pi*t*1.0)
        if motion=="float":
            sy*=1+0.03*math.sin(2*math.pi*t*1.3); sx*=1-0.02*math.sin(2*math.pi*t*1.3)
        elif motion=="shake":
            dx=9*math.sin(t*60); rot=4*math.sin(t*35); bob=0
        elif motion=="laugh":
            k=math.sin(t*28); sy*=1+0.06*k; sx*=1-0.04*k; rot=3*math.sin(t*14); bob=6*abs(k)
        elif motion=="dodge":
            u=f/nf; bob=-60*math.sin(math.pi*u); rot=12*math.sin(2*math.pi*u); dx=40*math.sin(2*math.pi*u)
        cv=bg.copy()
        # shadow
        sh_w=int(sx*w*0.45*(1-0.003*max(-bob,0)))
        ov=cv.copy(); cv2.ellipse(ov,(int(W/2+dx),GROUND+8),(max(sh_w,10),12),0,0,360,(20,25,20),-1)
        cv=cv2.addWeighted(ov,0.5,cv,0.5,0)
        place(cv,spr,W/2+dx,GROUND-sy*h/2-40-bob,sx,sy,rot)
        cv2.putText(cv,name,(14,28),cv2.FONT_HERSHEY_SIMPLEX,0.7,(235,235,235),2)
        frames.append(cv)
d='/home/user/Analisador/fantasma_test'; os.makedirs(d+'/frames_tmp',exist_ok=True); os.makedirs(d+'/sprites',exist_ok=True)
for i,fr in enumerate(frames): cv2.imwrite(f'{d}/frames_tmp/f_{i:04d}.png',fr)
for i in range(37): shutil.copy(f'/tmp/g/spr/s{i:02d}.png',f'{d}/sprites/s{i:02d}.png')
subprocess.run(f'ffmpeg -v error -y -framerate {FPS} -i {d}/frames_tmp/f_%04d.png -c:v libx264 -pix_fmt yuv420p -crf 20 {d}/fantasma_animado.mp4',shell=True)
shutil.rmtree(d+'/frames_tmp')
print(len(frames),'frames')
