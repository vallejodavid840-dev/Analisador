// Pure-math circuit description shared by the race simulation and the 3D scene.
export const CONTROL=[[0,0],[220,0],[420,0],[540,-25],[620,-90],[635,-185],[580,-255],[490,-270],[430,-225],[395,-160],[320,-135],[245,-165],[225,-245],[160,-310],[60,-320],[-35,-285],[-95,-215],[-110,-130],[-85,-50]];
export const ROAD_W=15;          // asphalt width (m)
export const CURB_W=1.4;         // each side
export const WALL_N=21;          // lateral distance of the barriers from the centre line

export function buildTrack(){
  const P=CONTROL,N=P.length,fine=[];
  for(let i=0;i<N;i++){const p0=P[(i-1+N)%N],p1=P[i],p2=P[(i+1)%N],p3=P[(i+2)%N];
    for(let k=0;k<60;k++){const t=k/60,t2=t*t,t3=t2*t;
      fine.push([0.5*((2*p1[0])+(-p0[0]+p2[0])*t+(2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2+(-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3),
                 0.5*((2*p1[1])+(-p0[1]+p2[1])*t+(2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2+(-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3)]);}}
  // arc-length table
  const M=fine.length,cum=new Float64Array(M+1);
  for(let i=0;i<M;i++){const a=fine[i],b=fine[(i+1)%M];cum[i+1]=cum[i]+Math.hypot(b[0]-a[0],b[1]-a[1]);}
  const LEN0=cum[M],NP=Math.round(LEN0),ds=LEN0/NP;
  const x=new Float64Array(NP),z=new Float64Array(NP);let j=0;
  for(let i=0;i<NP;i++){const s=i*ds;while(cum[j+1]<s)j++;const r=(s-cum[j])/(cum[j+1]-cum[j]);const a=fine[j],b=fine[(j+1)%M];x[i]=a[0]+(b[0]-a[0])*r;z[i]=a[1]+(b[1]-a[1])*r;}
  const tx=new Float64Array(NP),tz=new Float64Array(NP),psi=new Float64Array(NP);
  for(let i=0;i<NP;i++){const a=(i-1+NP)%NP,b=(i+1)%NP;let dx=x[b]-x[a],dz=z[b]-z[a];const l=Math.hypot(dx,dz);tx[i]=dx/l;tz[i]=dz/l;psi[i]=Math.atan2(tx[i],tz[i]);}
  const kap=new Float64Array(NP);
  const W=6;for(let i=0;i<NP;i++){let d=psi[(i+W)%NP]-psi[(i-W+NP)%NP];while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;kap[i]=d/(2*W*ds);}
  const ks=new Float64Array(NP);for(let i=0;i<NP;i++){let a=0;for(let k=-4;k<=4;k++)a+=kap[(i+k+NP)%NP];ks[i]=a/9;}
  const nx=new Float64Array(NP),nz=new Float64Array(NP);for(let i=0;i<NP;i++){nx[i]=tz[i];nz[i]=-tx[i];} // right-hand normal (+n = right of travel)
  const LEN=NP*ds;
  const wrap=s=>((s%LEN)+LEN)%LEN;
  const at=(s,n=0)=>{const f=wrap(s)/ds,i=Math.floor(f)%NP,r=f-Math.floor(f),k=(i+1)%NP;
    const px=x[i]+(x[k]-x[i])*r,pz=z[i]+(z[k]-z[i])*r;let a=psi[i],b=psi[k];let d=b-a;while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;
    const nx_=nx[i]+(nx[k]-nx[i])*r,nz_=nz[i]+(nz[k]-nz[i])*r;const l=Math.hypot(nx_,nz_);
    return {x:px+nx_/l*n,z:pz+nz_/l*n,psi:a+d*r,k:ks[i]+(ks[k]-ks[i])*r,cx:px,cz:pz};};
  // project a world point: returns {s (0..LEN), n, idx}
  const project=(px,pz,hint)=>{let best=1e18,bi=0;
    if(hint===undefined){for(let i=0;i<NP;i+=2){const d=(x[i]-px)**2+(z[i]-pz)**2;if(d<best){best=d;bi=i;}}hint=bi;best=1e18;}
    for(let o=-40;o<=40;o++){const i=((hint+o)%NP+NP)%NP;const d=(x[i]-px)**2+(z[i]-pz)**2;if(d<best){best=d;bi=i;}}
    const i=bi;const dx=px-x[i],dz=pz-z[i];return {idx:i,s:i*ds+(dx*tx[i]+dz*tz[i]),n:dx*nx[i]+dz*nz[i]};};
  return {N:NP,ds,LEN,x,z,tx,tz,nx,nz,psi,k:ks,at,project,wrap};
}
