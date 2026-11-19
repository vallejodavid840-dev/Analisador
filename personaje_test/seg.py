import cv2, numpy as np
im=cv2.imread('/root/.claude/uploads/51f9ae8e-22c7-51fc-a305-c0f4ce5e2a48/8a00eaa7-image.jpg')
h,w=im.shape[:2]
white=(im.min(axis=2)>236).astype(np.uint8)
# background = white connected to border
n,lab=cv2.connectedComponents(white,connectivity=4)
border=set(lab[0,:])|set(lab[-1,:])|set(lab[:,0])|set(lab[:,-1])
bg=np.isin(lab,[b for b in border if b!=0]) & (white>0)
fg=(~bg).astype(np.uint8)
fg=cv2.morphologyEx(fg,cv2.MORPH_OPEN,np.ones((2,2),np.uint8))
grp=cv2.dilate(fg,np.ones((5,5),np.uint8))
n,lab,st,_=cv2.connectedComponentsWithStats(grp,8)
parts=[]
for i in range(1,n):
    x,y,bw,bh,a=st[i]
    if a<900: continue
    m=((lab==i)&(fg>0)).astype(np.uint8)
    cnts,_=cv2.findContours(m,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    f=np.zeros_like(m); cv2.drawContours(f,cnts,-1,1,-1)
    # keep inner white (e.g. hair holes) only where truly bg: use f but remove white pixels connected inside? keep simple
    a_=cv2.GaussianBlur((f*255).astype(np.uint8),(3,3),0)
    p=3; x0,y0,x1,y1=max(x-p,0),max(y-p,0),min(x+bw+p,w),min(y+bh+p,h)
    parts.append((y0,x0,np.dstack([im[y0:y1,x0:x1],a_[y0:y1,x0:x1]])))
parts.sort(key=lambda t:(round(t[0]/110),t[1]))
for k,(y0,x0,r) in enumerate(parts): cv2.imwrite(f'/tmp/k/p/p{k:02d}.png',r)
print(len(parts))
cols=10;cell=150;rows=(len(parts)+cols-1)//cols
sh=np.full((rows*cell,cols*cell,3),(120,150,120),np.uint8)
for k,(y0,x0,r) in enumerate(parts):
    s=min((cell-22)/r.shape[1],(cell-22)/r.shape[0]);rr=cv2.resize(r,None,fx=s,fy=s,interpolation=cv2.INTER_AREA)
    cx=(k%cols)*cell;cy=(k//cols)*cell;a=rr[...,3:]/255.;hh,ww=rr.shape[:2]
    roi=sh[cy+20:cy+20+hh,cx+4:cx+4+ww];roi[:]=(rr[...,:3]*a+roi*(1-a)).astype(np.uint8)
    cv2.putText(sh,str(k),(cx+4,cy+16),cv2.FONT_HERSHEY_SIMPLEX,0.55,(0,0,0),2)
    cv2.putText(sh,str(k),(cx+4,cy+16),cv2.FONT_HERSHEY_SIMPLEX,0.55,(255,255,255),1)
cv2.imwrite('/tmp/k/contact.jpg',sh)
