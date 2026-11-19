// Deterministic multi-car race simulation. No dependencies: runs identically in Node and the browser.
import {buildTrack,ROAD_W,CURB_W} from './track.js';
export const WALL_N=17.5;
const G=9.81,RHO=1.2;

export function rng(seed){let a=seed>>>0;return()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
const clamp=(v,a,b)=>v<a?a:v>b?b:v;

function buildProfile(T,sp){
  const N=T.N,ds=T.ds,m=sp.kg,P=sp.kw*1000*0.86,vmax=sp.vmax/3.6;
  const capLat=sp.mu*G*0.9*sp.skill; const aB=sp.mu*G*0.52;
  const trac=(sp.drive==='awd'?0.9:0.6)*sp.mu*G;
  const drag=v=>0.5*RHO*sp.cda*v*v/m+0.015*G;
  const v=new Float64Array(N);
  for(let i=0;i<N;i++){const k=Math.abs(T.k[i]);v[i]=k<1e-5?vmax:Math.min(vmax,Math.sqrt(capLat/k));}
  for(let it=0;it<3;it++){
    for(let c=0;c<2*N;c++){const i=(2*N-1-c)%N,j=(i+1)%N;const vn=v[j];const lim=Math.sqrt(vn*vn+2*(aB+drag(vn))*ds);if(lim<v[i])v[i]=lim;}
    for(let c=0;c<2*N;c++){const i=c%N,j=(i+1)%N;const vi=v[i];const a=Math.min(P/(m*Math.max(vi,3)),trac)-drag(vi);const lim=Math.sqrt(vi*vi+2*Math.max(0.05,a)*ds);if(lim<v[j])v[j]=lim;}
  }
  return v;
}

// corners = local maxima of curvature
function findCorners(T){
  const out=[];const N=T.N;let i=0;
  const thr=1/130;
  while(i<N){if(Math.abs(T.k[i])>thr){let j=i,best=i;while(j<N&&Math.abs(T.k[j])>thr){if(Math.abs(T.k[j])>Math.abs(T.k[best]))best=j;j++;}out.push({s:best*T.ds,start:i*T.ds,end:j*T.ds,r:1/Math.abs(T.k[best])});i=j;}else i++;}
  // merge wraparound
  return out;
}

export function runRace(specs,opt={}){
  const seed=opt.seed??1,laps=opt.laps??3,dt=1/120,maxT=opt.maxT??420,REC=2; // record every REC steps (60 Hz)
  const R=rng(seed),T=buildTrack(),LEN=T.LEN;
  const corners=findCorners(T);
  const order=specs.map((_,i)=>i);for(let i=order.length-1;i>0;i--){const j=Math.floor(R()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
  const cars=specs.map((sp,i)=>{
    const slot=order.indexOf(i);const row=Math.floor(slot/2),col=slot%2;
    const D0=-12-row*10.5-(col?4:0),n0=col?2.6:-2.6;const p=T.at(D0,n0);
    const m=sp.kg;
    return {i,sp,m,I:m*(sp.L*sp.L+sp.W*sp.W)/12*1.25,prof:buildProfile(T,sp),
      x:p.x,z:p.z,th:p.psi,vx:0,vz:0,om:0,mode:'grid',modeT:0,damage:0,
      idx:undefined,n:n0,sPrev:T.wrap(D0),D:D0,nTgt:n0*0.4,react:0.25+R()*0.3,
      attack:0,attackHold:0,mult:1,mistake:{},err:sp.err,
      aLat:0,aLong:0,roll:0,pitch:0,steer:0,phF:0,phR:0,smoke:0,brake:0,spin:0,
      finished:false,finT:null,lapT:[],lapStart:0,dnf:false,slotRow:row,grid:slot+1,
      vf:0,tow:0,surf:1,stuck:0,mistakeLog:[]};
  });
  const NF=Math.ceil(maxT/dt/REC)+4;
  for(const c of cars){c.rec={x:new Float32Array(NF),z:new Float32Array(NF),th:new Float32Array(NF),v:new Float32Array(NF),roll:new Float32Array(NF),pitch:new Float32Array(NF),
    steer:new Float32Array(NF),phF:new Float32Array(NF),phR:new Float32Array(NF),smoke:new Float32Array(NF),dmg:new Float32Array(NF),brake:new Float32Array(NF),D:new Float32Array(NF),mode:new Uint8Array(NF),slip:new Float32Array(NF)};}
  const events=[];let nf=0,t=0,started=false,startT=3.0,fastest=1e9,finishedCount=0;
  const ev=(type,o)=>{events.push(Object.assign({t,type},o));};

  const aero=(c,v)=>0.5*RHO*c.sp.cda*v*v/c.m*(1-0.28*c.tow)+0.015*G;

  function carCorners(c){const f=[Math.sin(c.th),Math.cos(c.th)],r=[Math.cos(c.th),-Math.sin(c.th)],hl=c.sp.L/2,hw=c.sp.W/2;
    return [[1,1],[1,-1],[-1,-1],[-1,1]].map(([a,b])=>[c.x+f[0]*hl*a+r[0]*hw*b,c.z+f[1]*hl*a+r[1]*hw*b]);}
  function axes(c){return [[Math.sin(c.th),Math.cos(c.th)],[Math.cos(c.th),-Math.sin(c.th)]];}
  function obbHit(a,b){ // SAT: returns {depth,nx,nz} (normal from a to b) or null
    const ca=carCorners(a),cb=carCorners(b);let best=1e9,bn=null;
    for(const ax of [...axes(a),...axes(b)]){let amin=1e9,amax=-1e9,bmin=1e9,bmax=-1e9;
      for(const p of ca){const d=p[0]*ax[0]+p[1]*ax[1];amin=Math.min(amin,d);amax=Math.max(amax,d);}
      for(const p of cb){const d=p[0]*ax[0]+p[1]*ax[1];bmin=Math.min(bmin,d);bmax=Math.max(bmax,d);}
      const o=Math.min(amax,bmax)-Math.max(amin,bmin);if(o<=0)return null;
      if(o<best){best=o;const dir=((b.x-a.x)*ax[0]+(b.z-a.z)*ax[1])>=0?1:-1;bn=[ax[0]*dir,ax[1]*dir];}}
    return {depth:best,nx:bn[0],nz:bn[1]};}

  function setSlide(c,why,yawKick){c.mode='slide';c.modeT=0;c.om+=yawKick||0;c.attack=0;ev('slide',{car:c.i,why,x:c.x,z:c.z});}

  function rank(){return [...cars].sort((a,b)=>(b.finished?1e6-b.finT:b.D)-(a.finished?1e6-a.finT:a.D));}

  while(t<maxT){
    if(!started&&t>=startT)started=true;
    // ---- strategy / follow info (every step; cheap)
    for(const c of cars){
      const pr=T.project(c.x,c.z,c.idx);c.idx=pr.idx;c.n=pr.n;
      let d=pr.s-c.sPrev;if(d>LEN/2)d-=LEN;if(d<-LEN/2)d+=LEN;c.D+=d;c.sPrev=pr.s;c.sLoc=T.wrap(pr.s);
      c.vx_=c.vx;
    }
    const rk=rank();
    for(const c of cars){
      c.tow=0;c.ahead=null;
      for(const o of cars){if(o===c)continue;const gap=o.D-c.D-(o.sp.L/2+c.sp.L/2);
        if(gap>-2&&gap<45&&(!c.ahead||gap<c.ahead.gap))c.ahead={o,gap};}
      if(c.ahead&&c.ahead.gap<28&&Math.abs(c.ahead.o.n-c.n)<2.2)c.tow=Math.exp(-Math.max(0,c.ahead.gap)/16);
    }
    for(const c of cars){
      if(c.mode==='grid'){ if(started&&t>=startT+c.react){c.mode='drive';c.modeT=0;} else {c.vx=c.vz=0;continue;} }
      if(c.dnf||(c.finished&&c.mode==='parked')){c.vx*=0.98;c.vz*=0.98;c.x+=c.vx*dt;c.z+=c.vz*dt;continue;}
      c.modeT+=dt;
      const f=[Math.sin(c.th),Math.cos(c.th)],r=[Math.cos(c.th),-Math.sin(c.th)];
      let vf=c.vx*f[0]+c.vz*f[1],vr=c.vx*r[0]+c.vz*r[1];c.vf=vf;
      const off=Math.abs(c.n)>ROAD_W/2+CURB_W+0.4;c.surf=off?0.55:1;
      const spd=Math.hypot(c.vx,c.vz);
      let aLongNet=0,aLatNow=0;
      if(c.mode==='drive'){
        // --- speed target: profile + mistakes + follow
        const sLoc=c.sLoc,ii=Math.floor(sLoc/T.ds)%T.N;
        // mistakes at corners (decided once per lap/corner)
        c.mult=1;
        for(let k=0;k<corners.length;k++){const cn=corners[k];const lap=Math.floor(c.D/LEN);
          const key=lap+':'+k;
          let dd=cn.s-sLoc;if(dd<-LEN/2)dd+=LEN;if(dd>LEN/2)dd-=LEN;
          if(dd>-5&&dd<120){
            if(c.mistake[key]===undefined){const rr=R();const p=0.024*c.err*(1+0.12*Math.max(0,lap))*(cn.r<80?1.5:1);
              c.mistake[key]=(!opt.noMistakes&&rr<p)?1.09+R()*0.11:0;if(c.mistake[key])c.mistakeLog.push({t,corner:k,m:c.mistake[key]});}
            if(c.mistake[key]&&dd>-8&&dd<115){c.mult=c.mistake[key];if(!c.mistake['L'+key]){c.mistake['L'+key]=1;ev('mistake',{car:c.i,corner:k,x:c.x,z:c.z});}}
          }
        }
        let vt=c.prof[ii]*c.mult*(c.attack?1+0.035*c.sp.aggr:1);
        if(c.finished)vt=Math.min(vt,24);
        if(c.damage>0.3)vt*=1-0.35*c.damage;
        vt/=1+0.025*Math.min(8,Math.abs(c.nTgt-c.n));
        if(c.recover)vt=Math.min(vt,c.recover);
        // follow / overtake
        let nTgt=0;
        const A=c.ahead;
        if(A&&!c.finished){
          const o=A.o,lat=o.n-c.n;
          const mine=c.prof[ii]*c.mult;
          if(A.gap<30&&Math.abs(lat)<3.6){
            // look at the next corner to pick the inside
            const kA=T.at(c.sLoc+60).k;
            let side=Math.sign(kA)||1; // +n = inside of a +k corner
            if(c.attack===0){
              const room=Math.abs(o.n+side*3.7)<6.6;
              if(!room)side=-side;
              if(Math.abs(o.n+side*3.7)<6.8&&(o.vf<mine*0.995||A.gap<14)&&(c.sp.aggr+R()*0.4>0.55)){c.attack=side;c.attackHold=0;}
            }
          }
          if(c.attack){ c.attackHold+=dt; nTgt=clamp(o.n+c.attack*3.7,-6.2,6.2); if(A.gap<-6||c.attackHold>9)c.attack=0; }
          else{
            // can't or won't pass: follow the car in front
            if(A.gap<22&&Math.abs(lat)<2.6){const vfol=o.vf+Math.max(-3,(A.gap-6.5)*0.7);vt=Math.min(vt,Math.max(vfol,4));}
            nTgt=0;
          }
        } else if(c.attack){c.attack=0;}
        if(c.recover&&Math.abs(c.n)>3)nTgt=0;
        c.nTgt+=(nTgt-c.nTgt)*Math.min(1,dt*2.2);
        // --- steering (pure pursuit)
        const Ld=clamp(0.75*Math.max(vf,4),7,32);
        const P=T.at(c.sLoc+Ld,c.nTgt);
        const dx=P.x-c.x,dz=P.z-c.z;const alpha=Math.atan2(dx*r[0]+dz*r[1],dx*f[0]+dz*f[1]);
        const delta=clamp(Math.atan2(2*c.sp.wb*Math.sin(alpha),Ld),-0.5,0.5);
        let omCmd=Math.max(vf,0)*Math.tan(delta)/c.sp.wb;
        { const capL=c.sp.mu*G*c.surf*(1-0.3*c.damage)*0.9; const omMax=capL/Math.max(vf,6); omCmd=clamp(omCmd,-omMax,omMax); }
        // --- longitudinal command
        const eta=0.86,Pw=c.sp.kw*1000*eta;
        const trac=(c.sp.drive==='awd'?0.9:0.6)*c.sp.mu*G*c.surf*(1-0.3*c.damage);
        const lim=c.sp.vmax/3.6;
        let gross=vf>lim?0:Math.min(Pw/(c.m*Math.max(vf,2.5)),trac);
        const aBrake=c.sp.mu*G*0.93*c.surf;
        let aCmd;const err=vt-vf;
        if(err>0)aCmd=Math.min(gross,err*5+1.5);else aCmd=Math.max(-aBrake,err*6);
        // friction circle shared with cornering
        const capTot=c.sp.mu*G*c.surf*(1-0.3*c.damage)*(spd<10?1.15:1);
        const aLatReq=Math.abs(vf*omCmd);
        const tot=Math.hypot(aCmd>0?aCmd:aCmd,aLatReq);
        let scale=1;if(tot>capTot)scale=capTot/tot;
        const aLongUse=aCmd*(aCmd<0?Math.min(1,scale*1.02):scale);
        omCmd*=Math.max(0.35,scale);
        // wheelspin / smoke
        const spinUp=aCmd>0&&aCmd>trac*0.92&&vf<22?clamp((aCmd/trac-0.9)*8,0,1)*(1-vf/22):0;
        c.spin+=(spinUp-c.spin)*Math.min(1,dt*6);
        // --- integrate
        const drag=aero(c,Math.max(vf,0))*(vf>0?1:0)*(aLongUse>0?1:0.6);
        aLongNet=aLongUse-drag-(off?2.2:0);
        if(opt.debug&&c.i===opt.debug.car&&(opt.debug.n=(opt.debug.n||0)+1)%20===0&&t>opt.debug.t0&&t<opt.debug.t1)(opt.debug.log=opt.debug.log||[]).push({t,s:c.sLoc,n:c.n,v:vf,vt,aCmd,scale,omCmd,om:c.om,delta,capTot,aLatReq,k:T.at(c.sLoc).k});
        const om0=c.om;c.om+=(omCmd-c.om)*(1-Math.exp(-dt*9));
        // weathercock restoring torque
        const beta=Math.atan2(vr,Math.max(vf,1));c.om+=5*beta*dt*(spd>3?1:0);
        // lateral tyre force towards heading direction, limited by grip
        const capLat=Math.max(0,Math.sqrt(Math.max(0,capTot*capTot-aLongUse*aLongUse)));
        let dvr=-12*vr*dt;const maxd=capLat*dt;dvr=clamp(dvr,-maxd,maxd);
        aLatNow=-dvr/dt;
        const dvf=aLongNet*dt;
        c.vx+=f[0]*dvf+r[0]*dvr;c.vz+=f[1]*dvf+r[1]*dvr;
        if(vf<0.3&&aCmd<=0){c.vx*=0.98;c.vz*=0.98;}
        // loss of control when slip is large
        const slipA=Math.abs(Math.atan2(vr,Math.max(Math.abs(vf),1)));
        if(spd>9&&slipA>0.42){setSlide(c,'slip',c.om*0.4+(vr>0?1:-1)*0.8*R());}
        // visuals
        c.brake=aCmd<-2.5?1:0;
        const lat=Math.abs(aLatReq)/(capTot||1);
        c.smoke+=((clamp(slipA*5,0,1)*(spd>6?1:0)+clamp((lat-0.93)*6,0,1)+c.spin*0.9+(aCmd<-aBrake*0.97&&spd>20?0.35:0))-c.smoke)*Math.min(1,dt*8);
        c.steer=c.steer+(delta-c.steer)*Math.min(1,dt*14);
        // recovery speed limiter fades when back on track
        if(c.recover&&Math.abs(c.n)<4.5&&c.modeT>3)c.recover=0;
      }else if(c.mode==='slide'){
        // sliding: friction opposes velocity, spin decays
        const mu=0.78*c.surf;const dec=mu*G;
        if(spd>0.05){const k=Math.min(dec*dt,spd)/spd;c.vx-=c.vx*k;c.vz-=c.vz*k;}
        c.om*=Math.exp(-0.65*dt);
        aLongNet=-dec;c.smoke+=(clamp(spd/25,0,1)-c.smoke)*Math.min(1,dt*6);c.spin=0;c.brake=1;
        c.steer*=0.98;
        const th0=c.th; // can the car drive again?
        const vfn=c.vx*f[0]+c.vz*f[1],vrn=c.vx*r[0]+c.vz*r[1];
        const slipA=Math.abs(Math.atan2(vrn,Math.max(Math.abs(vfn),0.5)));
        if(c.modeT>1.2&&vfn>6&&slipA<0.3&&Math.abs(c.om)<0.5){c.mode='drive';c.modeT=0;c.recover=Math.max(20,spd);}
        else if(spd<1.2&&c.modeT>1.0){c.mode='recover';c.modeT=0;c.vx=c.vz=0;c.om=0;}
        else if(c.modeT>9){c.mode='recover';c.modeT=0;}
      }else if(c.mode==='recover'){
        c.vx*=0.9;c.vz*=0.9;c.om=0;c.smoke*=0.95;c.brake=0;aLongNet=0;
        if(c.damage>0.8&&c.modeT>2){c.dnf=true;ev('dnf',{car:c.i,x:c.x,z:c.z});continue;}
        if(c.modeT>1.6){ // turn the car back towards the track direction
          const tgt=T.at(c.sLoc).psi;let d=tgt-c.th;while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;
          if(Math.abs(d)>0.08){c.th+=clamp(d,-1.7*dt,1.7*dt);}else{c.mode='drive';c.modeT=0;c.recover=14;c.vx=f[0]*2;c.vz=f[1]*2;ev('rejoin',{car:c.i,x:c.x,z:c.z});}
        }
        c.stuck+=dt;
      }
      // ---- kinematics
      c.x+=c.vx*dt;c.z+=c.vz*dt;c.th+=c.om*dt;
      if(c.mode!=='recover'){}
      c.aLong+=(aLongNet-c.aLong)*Math.min(1,dt*6);c.aLat+=((c.mode==='drive'?aLatNow:0)-c.aLat)*Math.min(1,dt*6);
      // wheel angles
      const vfw=Math.max(0,c.vx*Math.sin(c.th)+c.vz*Math.cos(c.th));
      c.phF+=vfw/0.33*dt;c.phR+=vfw/0.33*(1+c.spin*1.6)*dt;
    }
    // ---- walls
    for(const c of cars){
      if(c.mode==='grid'||c.dnf)continue;
      const tg=T.at(c.sLoc).psi;let d=c.th-tg;const ext=Math.abs(Math.sin(d))*c.sp.L/2+Math.abs(Math.cos(d))*c.sp.W/2;
      const over=Math.abs(c.n)+ext-WALL_N;
      if(over>0){
        const nx=T.nx[c.idx]*Math.sign(c.n),nz=T.nz[c.idx]*Math.sign(c.n); // outward normal
        c.x-=nx*over;c.z-=nz*over;
        const vn=c.vx*nx+c.vz*nz;
        if(vn>0){const sev=vn;c.vx-=(1+0.18)*vn*nx;c.vz-=(1+0.18)*vn*nz;c.vx*=0.93;c.vz*=0.93;
          if(sev>2.5){c.damage=Math.min(1,c.damage+Math.max(0,sev-2)*0.045);ev('wall',{car:c.i,sev,x:c.x,z:c.z});
            if(c.mode==='drive'&&sev>4.5)setSlide(c,'wall',(R()-0.5)*sev*0.5);else if(c.mode==='slide')c.om+=(R()-0.5)*sev*0.3;}}
      }
    }
    // ---- car vs car
    for(let a=0;a<cars.length;a++)for(let b=a+1;b<cars.length;b++){
      const A=cars[a],B=cars[b];if(opt.noContact||A.mode==='grid'||B.mode==='grid')continue;
      const dd=Math.hypot(A.x-B.x,A.z-B.z);if(dd>5.6)continue;
      const h=obbHit(A,B);if(!h)continue;
      const nx=h.nx,nz=h.nz;
      const wA=1/A.m,wB=1/B.m;
      A.x-=nx*h.depth*wA/(wA+wB);A.z-=nz*h.depth*wA/(wA+wB);B.x+=nx*h.depth*wB/(wA+wB);B.z+=nz*h.depth*wB/(wA+wB);
      const cx=(A.x+B.x)/2,cz=(A.z+B.z)/2;
      const rA=[cx-A.x,cz-A.z],rB=[cx-B.x,cz-B.z];
      const vAx=A.vx-A.om*(-rA[1])*0+A.om*rA[1],vAz=A.vz-A.om*rA[0];
      const vBx=B.vx+B.om*rB[1],vBz=B.vz-B.om*rB[0];
      const vn=(vBx-vAx)*nx+(vBz-vAz)*nz;
      if(vn<0){
        const cA=rA[1]*nx-rA[0]*nz,cB=rB[1]*nx-rB[0]*nz; // cross(r,n) in our yaw sense
        const e=0.22;const j=-(1+e)*vn/(wA+wB+cA*cA/A.I+cB*cB/B.I);
        const Jx=j*nx,Jz=j*nz;
        A.vx-=Jx*wA;A.vz-=Jz*wA;A.om-=(rA[1]*Jx-rA[0]*Jz)/A.I;
        B.vx+=Jx*wB;B.vz+=Jz*wB;B.om+=(rB[1]*Jx-rB[0]*Jz)/B.I;
        const sev=-vn;
        if(sev>1.2)ev('contact',{a:A.i,b:B.i,sev,x:cx,z:cz});
        if(sev>2.0){A.damage=Math.min(1,A.damage+sev*0.012*B.m/A.m);B.damage=Math.min(1,B.damage+sev*0.012*A.m/B.m);}
        for(const c of [A,B]){ if(sev>3.2&&c.mode==='drive'&&R()<clamp((sev-2.2)/6,0.25,1))setSlide(c,'contact',0); c.attack=0; }
      }
    }
    // ---- lap bookkeeping + finish
    for(const c of cars){
      if(c.mode==='grid'||c.finished||c.dnf)continue;
      const lapNow=Math.floor(c.D/LEN);
      if(lapNow>c.lapT.length&&lapNow>=1){c.lapT.push(t);const lt=t-(c.lapT.length>1?c.lapT[c.lapT.length-2]:startT+c.react);
        if(lapNow>=1&&lapNow<=laps){c.lapTimes=(c.lapTimes||[]);c.lapTimes.push(lt);if(lt<fastest&&c.lapTimes.length>0){fastest=lt;ev('fastlap',{car:c.i,time:lt,lap:lapNow});}}}
      if(c.D>=laps*LEN){c.finished=true;c.finT=t;c.finPos=++finishedCount;ev('finish',{car:c.i,pos:c.finPos,x:c.x,z:c.z});}
    }
    // ---- record
    if((nf*REC)<=Math.round(t/dt)){
      for(const c of cars){const q=c.rec;const vfw=c.vx*Math.sin(c.th)+c.vz*Math.cos(c.th),vrw=c.vx*Math.cos(c.th)-c.vz*Math.sin(c.th);
        q.x[nf]=c.x;q.z[nf]=c.z;q.th[nf]=c.th;q.v[nf]=Math.hypot(c.vx,c.vz);
        q.roll[nf]=clamp(-c.aLat*0.0075*(c.mode==='drive'?1:0)+(c.mode==='slide'?0.02*Math.sign(c.om||1):0),-0.09,0.09)*(vrw>=0?1:1);
        q.pitch[nf]=clamp(-c.aLong*0.0035,-0.05,0.05);
        q.steer[nf]=c.steer;q.phF[nf]=c.phF;q.phR[nf]=c.phR;q.smoke[nf]=clamp(c.smoke,0,1);q.dmg[nf]=c.damage;q.brake[nf]=c.brake;q.D[nf]=c.D;
        q.mode[nf]=c.dnf?5:c.mode==='drive'?0:c.mode==='slide'?1:c.mode==='recover'?2:c.mode==='grid'?3:4;
        q.slip[nf]=Math.atan2(vrw,Math.max(Math.abs(vfw),1));}
      nf++;
    }
    t+=dt;
    if(finishedCount+cars.filter(c=>c.dnf&&!c.finished).length>=cars.length&&t>cars.reduce((m,c)=>Math.max(m,c.finT||0),0)+7)break;
    if(cars.every(c=>c.finished||c.dnf)&&t>maxT*0.95)break;
  }
  const results=[...cars].sort((a,b)=>(a.finished?a.finPos:99)-(b.finished?b.finPos:99)).map(c=>({id:c.sp.id,pos:c.finished?c.finPos:null,time:c.finT,dnf:c.dnf,grid:c.grid,laps:c.lapTimes||[],damage:c.damage}));
  return {T,cars:cars.map(c=>({id:c.sp.id,rec:c.rec,grid:c.grid,finT:c.finT,finPos:c.finPos,dnf:c.dnf})),events,results,nf,dt:dt*REC,startT,laps,LEN,seed,
    rankAt(f){return cars.map((c,i)=>({i,D:c.rec.D[f],fin:c.finished&&c.finT!==null&&f*dt*REC>=c.finT,finT:c.finT,finPos:c.finPos})).sort((a,b)=>(b.fin?1e7-b.finT:b.D)-(a.fin?1e7-a.finT:a.D)).map(x=>x.i);}};
}
