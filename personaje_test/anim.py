import cv2, numpy as np, math, os, shutil, subprocess, random
from rig import P, paste, draw_char
W,H=960,640; FPS=24; GROUND=560; SC=1.5
random.seed(4)
bg=np.zeros((H,W,3),np.uint8)
for y in range(H):
    t=y/H; bg[y]=(int(60+40*t),int(35+20*t),int(30+15*t))
cv2.rectangle(bg,(0,GROUND-4),(W,H),(30,28,34),-1)
for x in range(0,W,80): cv2.line(bg,(x,GROUND-4),(x-120,H),(45,42,50),2)
leg_h={k:P(k).shape[0] for k in (34,40,41,45)}
def frame_for(t):
    cv=bg.copy(); shake=(0,0); flash=0
    cx=560
    # --- choose phase
    if t<2.5:   # idle
        legs,torso,head=34,29,0; ph="idle"; br=math.sin(t*4)
        dxs=dys=0
    elif t<5.5: # charge
        u=(t-2.5)/3.0; legs,torso=34,27
        heads=[0,2,3,4,11,12,18]; head=heads[min(int(u*len(heads)),len(heads)-1)]; ph="charge"; br=math.sin(t*14)
        amp=2+10*u*u; shake=(random.uniform(-amp,amp),random.uniform(-amp,amp))
    elif t<6.0: # wind up
        legs,torso,head=40,28,18; ph="wind"; br=0
    elif t<8.2: # punch
        u=(t-6.0)/2.2; legs,torso,head=41,30,18; ph="punch"; br=0
        if u<0.35: shake=(random.uniform(-14,14),random.uniform(-10,10))
    else:
        legs,torso,head=34,28,12; ph="end"; br=math.sin(t*3)
    hipy=GROUND-leg_h[legs]*SC
    # shadow
    ov=cv.copy(); cv2.ellipse(ov,(cx,GROUND+6),(170,16),0,0,360,(10,10,12),-1); cv=cv2.addWeighted(ov,0.45,cv,0.55,0)
    body_c=(cx,int(hipy-80))
    # back effects
    if ph=="charge":
        u=(t-2.5)/3.0
        a=0.35+0.4*u
        paste(cv,P(66),body_c[0],body_c[1]+30,2.4+0.4*math.sin(t*20),0,alpha=a,flip=int(t*12)%2==0)
        paste(cv,P(58),body_c[0]-150,body_c[1]+10,1.8,0,alpha=a,flip=int(t*10)%2==1)
        paste(cv,P(58),body_c[0]+150,body_c[1]+10,1.8,0,alpha=a,flip=int(t*10)%2==0)
        for i in range(7):
            ph_i=(t*0.9+i/7)%1
            rx=body_c[0]+(i-3)*55+20*math.sin(i*2+t*3); ry=GROUND-20-ph_i*380
            paste(cv,P(70 if i%2 else 74),rx,ry,0.7+0.3*math.sin(i),rot=t*80*(1 if i%2 else -1),alpha=1-ph_i*0.6)
        paste(cv,P(62),body_c[0]-120,body_c[1]-60,1.1,rot=20,alpha=a+0.2,flip=int(t*20)%2==0)
        paste(cv,P(67),body_c[0]+130,body_c[1]+40,1.1,rot=-15,alpha=a+0.2,flip=int(t*20)%2==1)
    if ph=="punch":
        u=(t-6.0)/2.2
        paste(cv,P(64),cx-260,body_c[1]-30,2.0,0,alpha=0.9*max(0,1-u*1.2))
    # character
    dx=shake[0]; dy=shake[1]
    cv2draw=cv
    draw_char(cv2draw,cx+dx,hipy+dy,legs,torso,head,sc=SC,breathe=br,headdy=2*br)
    # front effects
    if ph=="charge":
        u=(t-2.5)/3.0
        if u>0.85: flash=(u-0.85)/0.15*0.8
        if u>0.9: paste(cv,P(69),body_c[0],body_c[1],2.0+(u-0.9)*14,alpha=0.9)
    if ph=="wind":
        flash=0.0
    if ph=="punch":
        u=(t-6.0)/2.2
        if 0.0<=u<0.6:
            k=u/0.6
            paste(cv,P(72),cx-370,body_c[1]-70,1.2+2.2*k,rot=k*40,alpha=max(0,1-k))
            paste(cv,P(17),cx-350,body_c[1]-30,0.8+1.8*k,alpha=max(0,0.9-k))
            for i in range(6):
                ang=i*1.0+0.3; rr=40+k*260
                paste(cv,P(70 if i%2 else 74),cx-370+math.cos(ang)*rr,body_c[1]-70+math.sin(ang)*rr*0.7,0.6+0.4*(i%3==0),rot=k*200*(i+1),alpha=max(0,1-k))
        if u<0.08: flash=(0.08-u)/0.08*0.7
    if flash>0:
        ov=np.full_like(cv,255); cv=cv2.addWeighted(ov,flash,cv,1-flash,0)
    M=np.float32([[1,0,shake[0]*0.3],[0,1,shake[1]*0.3]])
    return cv
d='/home/user/Analisador/personaje_test'; os.makedirs(d+'/f',exist_ok=True); os.makedirs(d+'/piezas',exist_ok=True)
N=int(9.0*FPS)
for i in range(N): cv2.imwrite(f'{d}/f/f_{i:04d}.png',frame_for(i/FPS))
for i in range(75): shutil.copy(f'/tmp/k/p/p{i:02d}.png',f'{d}/piezas/p{i:02d}.png')
subprocess.run(f'ffmpeg -v error -y -framerate {FPS} -i {d}/f/f_%04d.png -c:v libx264 -pix_fmt yuv420p -crf 20 {d}/personaje_animado.mp4',shell=True)
shutil.rmtree(d+'/f'); print('ok',N)
