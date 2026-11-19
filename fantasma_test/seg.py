import cv2, numpy as np, sys
im = cv2.imread('/root/.claude/uploads/51f9ae8e-22c7-51fc-a305-c0f4ce5e2a48/640601d8-image.jpg')
h,w = im.shape[:2]; print(w,h)
lum = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
fg = (lum > 70).astype(np.uint8)            # pale body, white, red tongue etc.
fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((5,5),np.uint8))
# group: dilate to merge arm/glove pieces with their body
grp = cv2.dilate(fg, np.ones((3,3),np.uint8))
n, lab, st, cen = cv2.connectedComponentsWithStats(grp, 8)
out=[]
for i in range(1,n):
    x,y,bw,bh,a = st[i]
    if a < 700: continue
    m = ((lab==i) & (fg>0)).astype(np.uint8)
    # fill holes (eyes, mouth) 
    cnts,_ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled = np.zeros_like(m); cv2.drawContours(filled, cnts, -1, 1, -1)
    alpha = cv2.dilate(filled, np.ones((5,5),np.uint8))   # keeps dark outline rim
    pad=4; x0,y0,x1,y1 = max(x-pad,0),max(y-pad,0),min(x+bw+pad,w),min(y+bh+pad,h)
    rgba = np.dstack([im[y0:y1,x0:x1], (alpha[y0:y1,x0:x1]*255)])
    out.append((y0,x0,rgba))
out.sort(key=lambda t:(round(t[0]/120), t[1]))
for k,(y0,x0,r) in enumerate(out):
    cv2.imwrite(f'/tmp/g/spr/s{k:02d}.png', r)
print(len(out))
# contact sheet with labels
cols=8; cell=180
rows=(len(out)+cols-1)//cols
sheet=np.full((rows*cell, cols*cell,3),(60,90,60),np.uint8)
for k,(y0,x0,r) in enumerate(out):
    s=min((cell-24)/r.shape[1],(cell-24)/r.shape[0]); rr=cv2.resize(r,None,fx=s,fy=s,interpolation=cv2.INTER_AREA)
    cx=(k%cols)*cell; cy=(k//cols)*cell
    a=rr[...,3:]/255.0; hh,ww=rr.shape[:2]
    roi=sheet[cy+20:cy+20+hh, cx+4:cx+4+ww]
    roi[:]=(rr[...,:3]*a+roi*(1-a)).astype(np.uint8)
    cv2.putText(sheet,str(k),(cx+4,cy+16),cv2.FONT_HERSHEY_SIMPLEX,0.55,(255,255,255),1)
cv2.imwrite('/tmp/g/contact.jpg',sheet)
