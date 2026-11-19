import cv2, numpy as np, math
P=lambda k: cv2.imread(f'/tmp/k/p/p{k:02d}.png', cv2.IMREAD_UNCHANGED)
def paste(cv, spr, cx, cy, sc=1.0, rot=0.0, anchor=(0.5,0.5), alpha=1.0, flip=False):
    """paste sprite so that its anchor (fractional) lands at (cx,cy)"""
    if flip: spr=spr[:,::-1]
    h,w=spr.shape[:2]
    s=max(sc,0.01); nw,nh=max(int(w*s),2),max(int(h*s),2)
    r=cv2.resize(spr,(nw,nh),interpolation=cv2.INTER_AREA)
    ax,ay=anchor[0]*nw,anchor[1]*nh
    if abs(rot)>0.01:
        pad=int(math.hypot(nw,nh)); canvas=np.zeros((nh+2*pad,nw+2*pad,4),np.uint8); canvas[pad:pad+nh,pad:pad+nw]=r
        M=cv2.getRotationMatrix2D((ax+pad,ay+pad),rot,1.0)
        r=cv2.warpAffine(canvas,M,(canvas.shape[1],canvas.shape[0]),flags=cv2.INTER_LINEAR); ax,ay=ax+pad,ay+pad; nh,nw=r.shape[:2]
    x0,y0=int(round(cx-ax)),int(round(cy-ay)); H,W=cv.shape[:2]
    xa,ya=max(x0,0),max(y0,0); xb,yb=min(x0+nw,W),min(y0+nh,H)
    if xa>=xb or ya>=yb: return
    s_=r[ya-y0:yb-y0,xa-x0:xb-x0]; a=(s_[...,3:]/255.0)*alpha
    cv[ya:yb,xa:xb]=(s_[...,:3]*a+cv[ya:yb,xa:xb]*(1-a)).astype(np.uint8)
def draw_char(cv, hipx, hipy, legs, torso, head, sc=1.6, dx=0, dy=0, breathe=0.0, headdy=0, headrot=0, torsorot=0):
    L=P(legs); T=P(torso); Hd=P(head)
    paste(cv,L,hipx,hipy,sc,anchor=(0.5,0.0))                       # legs hang from hip point
    ty=hipy+19*sc+dy
    paste(cv,T,hipx+dx,ty,sc*(1+breathe*0.02),torsorot,anchor=(0.5,1.0))   # torso sits on hips
    th=T.shape[0]*sc*(1+breathe*0.02)
    paste(cv,Hd,hipx+dx,ty-th+22*sc+headdy,sc,headrot,anchor=(0.5,0.92))   # head on neck
if __name__=="__main__":
    out=[]
    for legs,torso,head in [(40,21,0),(34,30,4),(41,27,12),(45,28,18)]:
        cv=np.full((620,520,3),(150,120,100),np.uint8)
        draw_char(cv,260,300,legs,torso,head)
        out.append(cv)
    cv2.imwrite('/tmp/k/rigtest.jpg',np.hstack(out))
