import * as THREE from 'three';
import {CAR_SPECS} from './specs.js';
import {loadCar,setCarLod} from './cars.js';
import {runRace,WALL_N} from './sim.js';
import {ROAD_W,CURB_W} from './track.js';

const Q=new URLSearchParams(location.search);
const RENDER=Q.has('render');
const W=+(Q.get('w')||1280),H=+(Q.get('h')||720),FPS=+(Q.get('fps')||24);
const SEED=+(Q.get('seed')||105),LAPS=+(Q.get('laps')||3);
const stage=document.getElementById('stage');
stage.style.width=W+'px';stage.style.height=H+'px';
if(!RENDER){document.getElementById('ctl').style.display='block';
  const fit=()=>{const k=Math.min(innerWidth/W,innerHeight/H);stage.style.transform=`scale(${k})`;};fit();addEventListener('resize',fit);}

// ------------------------------------------------------------------ renderer / scene
const renderer=new THREE.WebGLRenderer({antialias:Q.get('aa')!=='0',preserveDrawingBuffer:true});
renderer.setPixelRatio(+(Q.get('dpr')||1));renderer.setSize(W,H);
renderer.shadowMap.enabled=Q.get('shadow')!=='0';renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.0;renderer.outputColorSpace=THREE.SRGBColorSpace;
stage.insertBefore(renderer.domElement,stage.firstChild);
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(50,W/H,0.3,2500);

function rnd(seed){let s=seed>>>0;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};}
function canvasTex(w,h,draw,rep){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;if(rep)t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;}
const sstep=(x,a,b)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
const clamp=(v,a,b)=>v<a?a:v>b?b:v;

const sky=canvasTex(1024,512,(g,w,h)=>{
  const gr=g.createLinearGradient(0,0,0,h);
  gr.addColorStop(0,'#2d5798');gr.addColorStop(.36,'#7fa3cf');gr.addColorStop(.5,'#f4c08a');gr.addColorStop(.55,'#ebb07a');gr.addColorStop(.6,'#6b5d58');gr.addColorStop(1,'#2a2622');
  g.fillStyle=gr;g.fillRect(0,0,w,h);
  const sx=w*0.32,sy=h*0.46,rg=g.createRadialGradient(sx,sy,2,sx,sy,190);
  rg.addColorStop(0,'rgba(255,248,225,1)');rg.addColorStop(.14,'rgba(255,220,160,.8)');rg.addColorStop(1,'rgba(255,175,95,0)');g.fillStyle=rg;g.fillRect(0,0,w,h);
  const r=rnd(4);for(let i=0;i<30;i++){g.fillStyle=`rgba(255,230,205,${.05+r()*.08})`;g.beginPath();g.ellipse(r()*w,h*(.2+r()*.22),60+r()*140,5+r()*11,0,0,7);g.fill();}
  // far mountains silhouette
  g.fillStyle='#51505f';g.beginPath();g.moveTo(0,h*.52);for(let x=0;x<=w;x+=16)g.lineTo(x,h*(.5-.03*Math.sin(x*.013)-.025*Math.sin(x*.041+2)));g.lineTo(w,h*.52);g.fill();
});
sky.mapping=THREE.EquirectangularReflectionMapping;scene.background=sky;
const pm=new THREE.PMREMGenerator(renderer);scene.environment=pm.fromEquirectangular(sky).texture;
scene.fog=new THREE.Fog(0xd9a67e,260,1500);
const sun=new THREE.DirectionalLight(0xffd7a8,3.0);const sunDir=new THREE.Vector3(-0.55,0.42,-0.55).normalize();
sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);const sc=sun.shadow.camera;sc.left=-24;sc.right=24;sc.top=24;sc.bottom=-24;sc.near=1;sc.far=160;sun.shadow.bias=-0.0004;sun.shadow.normalBias=0.04;
scene.add(sun,sun.target);scene.add(new THREE.HemisphereLight(0x9db8ff,0x6b4c34,0.8));

// ------------------------------------------------------------------ simulation
const SIM=runRace(CAR_SPECS,{seed:SEED,laps:LAPS});
const T=SIM.T,NF=SIM.nf,DT=SIM.dt,NC=CAR_SPECS.length;
// lateral offset per frame (for dust / off-track)
const LAT=CAR_SPECS.map((_,i)=>{const a=new Float32Array(NF),c=SIM.cars[i].rec;let h;for(let f=0;f<NF;f++){const p=T.project(c.x[f],c.z[f],h);h=p.idx;a[f]=p.n;}return a;});

// ------------------------------------------------------------------ world
function ribbon(off0,off1,y,mat,vscale,stride=2){
  const pos=[],uv=[],idx=[];let k=0;
  for(let i=0;i<=T.N;i+=stride){const j=i%T.N;const a=[T.x[j]+T.nx[j]*off0,T.z[j]+T.nz[j]*off0],b=[T.x[j]+T.nx[j]*off1,T.z[j]+T.nz[j]*off1];
    pos.push(a[0],y,a[1],b[0],y,b[1]);const v=(i*T.ds)/vscale;uv.push(0,v,1,v);if(i>0){idx.push(k-2,k,k-1,k-1,k,k+1);}k+=2;}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();
  const m=new THREE.Mesh(g,mat);m.receiveShadow=true;scene.add(m);return m;}
function buildWorld(){
  const grass=canvasTex(512,512,(g,w,h)=>{g.fillStyle='#6d7a3c';g.fillRect(0,0,w,h);const r=rnd(9);
    for(let i=0;i<9000;i++){const v=r();g.fillStyle=v<.5?`rgba(60,80,30,${r()*.5})`:`rgba(150,140,70,${r()*.4})`;g.fillRect(r()*w,r()*h,2+r()*3,2+r()*3);}},true);grass.repeat.set(160,160);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(3500,3500),new THREE.MeshStandardMaterial({map:grass,roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.set(260,-0.06,-160);ground.receiveShadow=true;scene.add(ground);
  const asphalt=canvasTex(512,512,(g,w,h)=>{g.fillStyle='#3b3c40';g.fillRect(0,0,w,h);const r=rnd(3);
    for(let i=0;i<14000;i++){const v=40+r()*50|0;g.fillStyle=`rgba(${v},${v},${v+4},${.35+r()*.4})`;g.fillRect(r()*w,r()*h,1+r()*2,1+r()*2);}
    g.fillStyle='rgba(18,18,20,.28)';g.fillRect(w*.28,0,w*.14,h);g.fillRect(w*.58,0,w*.14,h);
    g.fillStyle='#e8e8e8';g.fillRect(w*.03,0,w*.014,h);g.fillRect(w*.956,0,w*.014,h);},true);
  ribbon(-ROAD_W/2,ROAD_W/2,0.03,new THREE.MeshStandardMaterial({map:asphalt,roughness:.92,envMapIntensity:.35}),ROAD_W*1.6);
  const curbTex=canvasTex(64,128,(g,w,h)=>{g.fillStyle='#d8262a';g.fillRect(0,0,w,h/2);g.fillStyle='#f3f3f3';g.fillRect(0,h/2,w,h/2);},true);
  const curbMat=new THREE.MeshStandardMaterial({map:curbTex,roughness:.7});
  ribbon(ROAD_W/2,ROAD_W/2+CURB_W,0.07,curbMat,5.6);ribbon(-ROAD_W/2-CURB_W,-ROAD_W/2,0.07,curbMat,5.6);
  const gravel=new THREE.MeshStandardMaterial({color:0x9a8a70,roughness:1});
  ribbon(ROAD_W/2+CURB_W,WALL_N-0.6,0.015,gravel,10,4);ribbon(-(WALL_N-0.6),-ROAD_W/2-CURB_W,0.015,gravel,10,4);
  // start/finish line + grid boxes
  {const m=new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W,1.8),new THREE.MeshBasicMaterial({map:canvasTex(256,32,(g)=>{for(let x=0;x<16;x++)for(let y=0;y<2;y++){g.fillStyle=(x+y)%2?'#111':'#fff';g.fillRect(x*16,y*16,16,16);}})}));
    m.rotation.order='YXZ';m.rotation.set(-Math.PI/2,0,0);m.rotation.y=T.psi[0];m.position.set(T.x[0],0.09,T.z[0]);m.rotation.set(0,0,0);
    m.quaternion.setFromEuler(new THREE.Euler(-Math.PI/2,0,0));const q2=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),T.psi[0]+Math.PI/2);m.quaternion.premultiply(q2);scene.add(m);}
  // walls
  {const bg=new THREE.BoxGeometry(0.8,1.05,4.1),bm=new THREE.MeshStandardMaterial({color:0xeeeeee,roughness:.8});
    const n=Math.floor(T.N/4)*2+2,inst=new THREE.InstancedMesh(bg,bm,n);const col=new THREE.Color(),m4=new THREE.Matrix4(),q=new THREE.Quaternion(),e=new THREE.Euler();let c=0;
    for(let i=0;i<T.N;i+=4){for(const side of [-1,1]){const d=WALL_N+0.4;const px=T.x[i]+T.nx[i]*d*side,pz=T.z[i]+T.nz[i]*d*side;
      e.set(0,T.psi[i],0);q.setFromEuler(e);m4.compose(new THREE.Vector3(px,.52,pz),q,new THREE.Vector3(1,1,1));inst.setMatrixAt(c,m4);inst.setColorAt(c,col.set(((i/4|0)%2)?0xd8262a:0xf0f0f0));c++;}}
    inst.count=c;inst.receiveShadow=true;inst.castShadow=true;scene.add(inst);
    // tyre stacks on the outside of slower corners
    const tg=new THREE.CylinderGeometry(.45,.45,.34,12),tm=new THREE.MeshStandardMaterial({color:0x151515,roughness:.9}),tires=new THREE.InstancedMesh(tg,tm,1500);let tn=0;
    for(let i=0;i<T.N;i+=6){const k=T.k[i];if(Math.abs(k)<1/150)continue;const side=k>0?-1:1;const d=(WALL_N-1.3)*side;
      for(let h=0;h<3&&tn<1497;h++){m4.compose(new THREE.Vector3(T.x[i]+T.nx[i]*d,.2+h*.34,T.z[i]+T.nz[i]*d),new THREE.Quaternion(),new THREE.Vector3(1,1,1));tires.setMatrixAt(tn++,m4);}}
    tires.count=tn;tires.castShadow=true;scene.add(tires);}
  // grandstands
  {const crowd=canvasTex(512,64,(g,w,h)=>{g.fillStyle='#303036';g.fillRect(0,0,w,h);const r=rnd(21);const cs=['#e04a3a','#f2c94c','#4aa0e0','#fff','#7ee08a','#c084e0','#f28c3a'];for(let i=0;i<2600;i++){g.fillStyle=cs[(r()*cs.length)|0];g.fillRect(r()*w,r()*h,3,3+r()*2);}});
    const mats=[new THREE.MeshStandardMaterial({map:crowd,roughness:1}),...Array(5).fill(0).map(()=>new THREE.MeshStandardMaterial({color:0x6b6e73}))];
    for(const [s0,len] of [[70,110],[210,90],[620,60]]){const i=Math.floor(s0/T.ds)%T.N;const side=-1;const d=(WALL_N+10)*side;
      for(let step=0;step<3;step++){const b=new THREE.Mesh(new THREE.BoxGeometry(7-step*1.7,3.4+step*3.2,len),mats);const dd=(WALL_N+6.5+step*3.4)*side;
        b.position.set(T.x[i]+T.nx[i]*dd,(3.4+step*3.2)/2,T.z[i]+T.nz[i]*dd);b.rotation.y=T.psi[i];b.material=[mats[0],mats[1],mats[2],mats[3],mats[4],mats[5]];b.castShadow=true;b.receiveShadow=true;scene.add(b);}}}
  // gantry
  {const i=0,d=ROAD_W/2+2.5,mk=new THREE.MeshStandardMaterial({color:0x2a2c30,metalness:.6,roughness:.4});
    for(const sd of [-1,1]){const p=new THREE.Mesh(new THREE.BoxGeometry(.7,8,.7),mk);p.position.set(T.x[i]+T.nx[i]*d*sd,4,T.z[i]+T.nz[i]*d*sd);p.castShadow=true;scene.add(p);}
    const beam=new THREE.Mesh(new THREE.BoxGeometry(ROAD_W+5.5,2.3,.5),new THREE.MeshStandardMaterial({map:canvasTex(1024,128,(g,w,h)=>{g.fillStyle='#111';g.fillRect(0,0,w,h);g.fillStyle='#e10600';g.fillRect(0,0,w,10);g.fillStyle='#fff';g.font='italic 900 78px sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText('GRAN PREMIO HOONICORN',w/2,h/2+8);}),roughness:.5}));
    beam.position.set(T.x[i],8.2,T.z[i]);beam.rotation.y=T.psi[i];beam.castShadow=true;scene.add(beam);}
  // trees
  {const r=rnd(77),cg=new THREE.ConeGeometry(3,10,7),tg=new THREE.CylinderGeometry(.35,.45,2.2,6);
    const cm=new THREE.MeshStandardMaterial({color:0x35552e,roughness:1}),tm=new THREE.MeshStandardMaterial({color:0x4b3523,roughness:1});
    const N=420,cones=new THREE.InstancedMesh(cg,cm,N),trunks=new THREE.InstancedMesh(tg,tm,N),m4=new THREE.Matrix4();let n=0,guard=0;
    while(n<N&&guard++<4000){const x=-380+r()*1250,z=-620+r()*820;const p=T.project(x,z);if(Math.abs(p.n)<40)continue;const s=.8+r()*1.3;
      m4.compose(new THREE.Vector3(x,5*s+1.8,z),new THREE.Quaternion(),new THREE.Vector3(s,s,s));cones.setMatrixAt(n,m4);
      m4.compose(new THREE.Vector3(x,1.1*s,z),new THREE.Quaternion(),new THREE.Vector3(s,s,s));trunks.setMatrixAt(n,m4);n++;}
    cones.count=trunks.count=n;cones.castShadow=true;scene.add(cones,trunks);}
}
buildWorld();

// ------------------------------------------------------------------ cars
const cars=[];
function prepLod(car){
  const detail=[],major=[];
  car.root.updateMatrixWorld(true);
  for(const m of car.meshes){const b=new THREE.Box3().setFromObject(m);const d=b.getSize(new THREE.Vector3()).length();const nm=m.name.toLowerCase();
    const interior=/cockpit_(interior|steering|fuel|gauge|speed|tach|seat|dash|pedal|shift|vent|console)|undercarriage|_engine|seat/.test(nm);
    if(interior||d<0.5)detail.push(m);else major.push(m);}
  car.detail=detail;car.major=major;
}
async function loadAll(){
  for(let i=0;i<NC;i++){const c=await loadCar(CAR_SPECS[i]);c.root.visible=true;scene.add(c.root);prepLod(c);cars.push(c);}
}

// ------------------------------------------------------------------ particles
const pool=[];const POOL=1100;
const smokeTex=canvasTex(128,128,(g,w,h)=>{const r=g.createRadialGradient(64,64,2,64,64,62);r.addColorStop(0,'rgba(255,255,255,.9)');r.addColorStop(.5,'rgba(235,235,235,.45)');r.addColorStop(1,'rgba(220,220,220,0)');g.fillStyle=r;g.fillRect(0,0,w,h);});
for(let i=0;i<POOL;i++){const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:smokeTex,transparent:true,depthWrite:false,opacity:0,fog:true}));sp.visible=false;scene.add(sp);pool.push(sp);}
const sparkPool=[];for(let i=0;i<160;i++){const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:smokeTex,transparent:true,depthWrite:false,opacity:0,color:0xffa030,blending:THREE.AdditiveBlending,fog:false}));sp.visible=false;scene.add(sp);sparkPool.push(sp);}
const lerp=(a,b,r)=>a+(b-a)*r;
function poseAt(i,t){const rec=SIM.cars[i].rec;const f=clamp(t/DT,0,NF-2),a=Math.floor(f),r=f-a;
  let d=rec.th[a+1]-rec.th[a];while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;
  return {x:lerp(rec.x[a],rec.x[a+1],r),z:lerp(rec.z[a],rec.z[a+1],r),th:rec.th[a]+d*r,v:lerp(rec.v[a],rec.v[a+1],r),roll:lerp(rec.roll[a],rec.roll[a+1],r),pitch:lerp(rec.pitch[a],rec.pitch[a+1],r),
    steer:lerp(rec.steer[a],rec.steer[a+1],r),phF:lerp(rec.phF[a],rec.phF[a+1],r),phR:lerp(rec.phR[a],rec.phR[a+1],r),smoke:lerp(rec.smoke[a],rec.smoke[a+1],r),dmg:rec.dmg[a],D:lerp(rec.D[a],rec.D[a+1],r),mode:rec.mode[a],slip:lerp(rec.slip[a],rec.slip[a+1],r),brake:rec.brake[a],f:a};}
function updateParticles(t){
  let n=0;const life=2.6;
  for(let i=0;i<NC;i++){const rec=SIM.cars[i].rec,sp=CAR_SPECS[i];
    const k1=Math.floor(t/DT),k0=Math.max(0,k1-Math.ceil(life/DT));
    for(let k=k0;k<=k1&&n<POOL-4;k+=2){
      const sm=rec.smoke[k],dm=rec.dmg[k];const off=Math.abs(LAT[i][k])>ROAD_W/2+CURB_W+0.5;
      if(sm<0.16&&dm<0.35)continue;
      const te=k*DT,age=t-te;if(age<0||age>life)continue;
      const th=rec.th[k],fx=Math.sin(th),fz=Math.cos(th),rx=Math.cos(th),rz=-Math.sin(th);
      if(sm>=0.16)for(const side of [-1,1]){const rr=rnd(k*7+i*3+(side>0?1:0)+11);const a=rr(),b=rr(),c=rr();if(a>0.3+sm*0.6)continue;
        const p=pool[n++];const u=age/life;
        const hx=rec.x[k]-fx*sp.wb*0.5+rx*side*0.8,hz=rec.z[k]-fz*sp.wb*0.5+rz*side*0.8;
        const v=rec.v[k];const vx=fx*v*0.32+(b-.5)*3,vz=fz*v*0.32+(c-.5)*3;
        p.position.set(hx+vx*age*.8,0.3+age*0.9+u*u*1.2,hz+vz*age*.8);const sz=1.1+u*5.5*(.7+a);p.scale.set(sz,sz,1);
        p.material.color.set(off?0xb9a37a:0xffffff);p.material.opacity=Math.min(1,sm)*0.5*Math.pow(1-u,1.4)*clamp((p.position.distanceTo(camera.position)-3)/9,0,1);p.material.rotation=a*6+age*.3;p.visible=true;}
      if(dm>=0.35){const rr=rnd(k*13+i*5+99);const a=rr(),b=rr();if(a<0.7){const p=pool[n++];const u=age/life;const hx=rec.x[k]+fx*1.7,hz=rec.z[k]+fz*1.7;
        p.position.set(hx+(b-.5)*.8,0.9+age*1.6,hz);const sz=0.7+u*3.2;p.scale.set(sz,sz,1);p.material.color.set(0x2c2c2c);p.material.opacity=Math.min(1,dm*1.3)*0.55*Math.pow(1-u,1.2)*clamp((p.position.distanceTo(camera.position)-3)/8,0,1);p.material.rotation=b*6;p.visible=true;}}
    }
  }
  for(let i=n;i<POOL;i++)pool[i].visible=false;
  // sparks
  let sn=0;
  for(const e of SIM.events){if((e.type!=='wall'&&e.type!=='contact')||!(e.sev>1.5))continue;const age=t-e.t;if(age<0||age>0.7)continue;
    const cnt=Math.min(18,Math.round(6+e.sev*1.2));for(let q=0;q<cnt&&sn<sparkPool.length;q++){const rr=rnd(Math.round(e.t*1000)+q*31);const ang=rr()*6.28,sp_=3+rr()*7,vy=2+rr()*5;
      const p=sparkPool[sn++];p.position.set(e.x+Math.cos(ang)*sp_*age,0.6+vy*age-6*age*age,e.z+Math.sin(ang)*sp_*age);p.scale.set(.35,.35,1);p.material.opacity=1-age/0.7;p.visible=true;}}
  for(let i=sn;i<sparkPool.length;i++)sparkPool[i].visible=false;
}

// ------------------------------------------------------------------ director
const tEnd=(()=>{let m=0;for(const c of SIM.cars)if(c.finT)m=Math.max(m,c.finT);return m+3.5;})();
const incidents=(()=>{
  // cluster destructive events
  const cand=SIM.events.filter(e=>(e.type==='contact'&&e.sev>4.5)||(e.type==='wall'&&e.sev>5.5)||(e.type==='slide'&&(e.why==='slip')));
  const out=[];for(const e of cand.sort((a,b)=>a.t-b.t)){if(e.t<6||e.t>tEnd-14)continue;if(out.length&&e.t-out[out.length-1].t<16)continue;out.push(e);}
  // keep the strongest few
  const score=e=>(e.sev||3);return out.sort((a,b)=>score(b)-score(a)).slice(0,5).sort((a,b)=>a.t-b.t);
})();
function rankSnapshot(t){const f=clamp(Math.round(t/DT),0,NF-1);return SIM.rankAt(f);}
function carAtPos(t,p){return rankSnapshot(t)[p];}
function battleFocus(t){
  const rk=rankSnapshot(t);let best=rk[0],bs=-1;const f=clamp(Math.round(t/DT),0,NF-1);
  for(let a=0;a<NC;a++){const i=rk[a];const pi=poseAt(i,t);let s=(a===0?1.2:0)+(pi.mode===1?3:0)+(pi.smoke>0.5?1:0);
    if(a>0){const pj=poseAt(rk[a-1],t);const g=pj.D-pi.D;if(g<22)s+=2.2-g/14;}
    s+=Math.sin(i*12.9898+Math.floor(t/7)*78.233)*0.3;if(s>bs){bs=s;best=i;}}
  return best;
}
const shots=[];
(function buildTimeline(){
  let tv=0;
  const add=(o)=>{o.v0=tv;shots.push(o);tv+=o.dur;};
  // intro: frozen grid, flyover then low cams
  add({dur:3.2,sim0:0,rate:0,cam:'heli0',focus:0,label:'intro'});
  add({dur:2.2,sim0:0,rate:0,cam:'grid',focus:0,label:'intro'});
  // live
  const camsCycle=['tv','chase','heli','onboard','low','tv','side','chase','heli','low'];
  let simT=0,ci=0,finDone=false;const inc=[...incidents];
  const winT=Math.min(...SIM.cars.map(c=>c.finT||1e9));
  const blockCam=()=>camsCycle[ci++%camsCycle.length];
  while(simT<tEnd-0.05){
    while(inc.length&&inc[0].t-1.6<simT-0.1)inc.shift();
    const nextInc=inc[0];
    if(simT<4.3){const d=simT<2?2:2.4;add({dur:d,sim0:simT,rate:1,cam:simT<2?'grid':'startchase',focus:0});simT+=d;continue;}
    if(!finDone&&simT>=winT-2.2){const d=5.2;add({dur:d,sim0:simT,rate:1,cam:'finish',focus:carAtPos(winT+0.5,0)});simT+=d;finDone=true;continue;}
    if(nextInc&&nextInc.t-1.6<=simT+6.2){
      const s0=Math.max(simT,nextInc.t-1.6);
      if(s0-simT>0.8){const d=s0-simT;add({dur:d,sim0:simT,rate:1,cam:blockCam(),focus:battleFocus(simT+d/2)});simT=s0;}
      const ev=nextInc;const who=ev.car!==undefined?ev.car:ev.a;
      add({dur:4.4,sim0:simT,rate:1,cam:'incident',focus:who,ev});simT+=4.4;
      add({dur:7.6,sim0:Math.max(0,ev.t-1.6),rate:0.5,cam:'tv',focus:who,replay:true,ev});
      inc.shift();continue;}
    let d=Math.min(6.2,tEnd-simT);
    if(nextInc)d=Math.min(d,Math.max(0.9,nextInc.t-1.6-simT));
    if(!finDone&&simT<winT-2.2)d=Math.min(d,winT-2.2-simT);
    if(d<0.2){simT+=d;continue;}
    add({dur:d,sim0:simT,rate:1,cam:blockCam(),focus:battleFocus(simT+d/2)});simT+=d;
  }
  // outro: slow orbit around the winner with the results
  add({dur:8,sim0:simT,rate:0.25,cam:'orbit',focus:carAtPos(tEnd,0),label:'result'});
  window.__timelineEnd=tv;
})();
const TOTAL=Math.ceil(shots[shots.length-1].v0*FPS+shots[shots.length-1].dur*FPS);
function shotAt(tv){let lo=0,hi=shots.length-1;while(lo<hi){const m=(lo+hi+1)>>1;if(shots[m].v0<=tv)lo=m;else hi=m-1;}return shots[lo];}

// camera helpers
const V=(x,y,z)=>new THREE.Vector3(x,y,z);
function carFrame(i,t){const p=poseAt(i,t);return {p,f:V(Math.sin(p.th),0,Math.cos(p.th)),r:V(Math.cos(p.th),0,-Math.sin(p.th)),pos:V(p.x,0,p.z)};}
function pickTripod(shot){ // cached: trackside position ahead of the focus car
  if(shot._tp)return shot._tp;
  const t0=shot.sim0+Math.max(0,(shot.dur*shot.rate)*0.5);const p=poseAt(shot.focus,t0);const pr=T.project(p.x,p.z);
  const sAhead=pr.s+30+p.v*1.0;const k=T.at(sAhead).k;const side=k>0?-1:1; // outside of the corner
  const nOff=clamp(side*(ROAD_W/2+CURB_W+3.2),-12,12);const q=T.at(sAhead,nOff);
  shot._tp=V(q.x,1.7+Math.abs(k)*40,q.z);return shot._tp;}
function setCamera(shot,tv,simT){
  const cf=carFrame(shot.focus,simT),p=cf.p;const look=V(p.x,0.8,p.z);let pos,fov=50,shake=0;
  const lag=carFrame(shot.focus,Math.max(0,simT-0.1));
  switch(shot.cam){
    case 'heli0':{const u=(tv-shot.v0)/shot.dur;const g=poseAt(0,0);const ang=-0.9+u*1.7;const rad=130-u*60;pos=V(g.x+Math.cos(ang)*rad+40,38+(1-u)*45,g.z+Math.sin(ang)*rad);look.set(g.x+30,0,g.z);fov=45;break;}
    case 'grid':{const u=(tv-shot.v0)/shot.dur;const g=poseAt(shot.focus,0);const th=g.th;pos=V(g.x-Math.sin(th)*(30-u*12)+Math.cos(th)*(4-u*6),0.8+u*0.4,g.z-Math.cos(th)*(30-u*12)-Math.sin(th)*(4-u*6));look.set(g.x+Math.sin(th)*20,0.9,g.z+Math.cos(th)*20);fov=34;break;}
    case 'startchase':{pos=V(lag.pos.x-lag.f.x*8.5+lag.r.x*2,2.3,lag.pos.z-lag.f.z*8.5+lag.r.z*2);look.copy(cf.pos).addScaledVector(cf.f,4).setY(1.0);fov=58;shake=0.02;break;}
    case 'chase':{const u=Math.sin((tv-shot.v0)*0.7);pos=V(lag.pos.x-lag.f.x*7.6+lag.r.x*u*1.6,2.3,lag.pos.z-lag.f.z*7.6+lag.r.z*u*1.6);look.copy(cf.pos).addScaledVector(cf.f,3.2).setY(0.95);fov=56;shake=0.006+p.v*0.00018;break;}
    case 'onboard':{pos=V(cf.pos.x+cf.f.x*1.1,1.12,cf.pos.z+cf.f.z*1.1);look.copy(cf.pos).addScaledVector(cf.f,40).setY(1.0);fov=72;shake=0.012+p.v*0.0004;break;}
    case 'low':{const u=(tv-shot.v0)/Math.max(1,shot.dur);pos=V(lag.pos.x+lag.f.x*(9-u*3)+lag.r.x*(3.4-u*1.2),0.55,lag.pos.z+lag.f.z*(9-u*3)+lag.r.z*(3.4-u*1.2));look.copy(cf.pos).setY(0.65);fov=42;shake=0.004;break;}
    case 'side':{pos=V(lag.pos.x+lag.r.x*3.6-lag.f.x*0.5,0.42,lag.pos.z+lag.r.z*3.6-lag.f.z*0.5);look.copy(cf.pos).addScaledVector(cf.f,1.2).setY(0.45);fov=48;shake=0.004;break;}
    case 'heli':{const g=cf.pos;const ang=simT*0.12+shot.focus;const rad=60;pos=V(g.x+Math.cos(ang)*rad,42,g.z+Math.sin(ang)*rad);look.set(g.x,0,g.z);fov=36;break;}
    case 'tv':{pos=pickTripod(shot).clone();look.copy(cf.pos).setY(0.7);fov=clamp(8+90/Math.max(8,pos.distanceTo(cf.pos))*5.5,16,48);break;}
    case 'incident':{const ev=shot.ev;const ex=ev.x,ez=ev.z;const pr=T.project(ex,ez);const side=Math.sign(pr.n)||1;const q=T.at(pr.s-17,clamp(-side*7.5,-9,9));pos=V(q.x,1.7,q.z);look.set(ex,0.7,ez);fov=36;shake=0.0;
      // follow the first involved car a bit
      look.lerp(V(cf.pos.x,0.8,cf.pos.z),0.5);break;}
    case 'finish':{const q=T.at(0,ROAD_W/2+4);pos=V(q.x-T.tx[0]*34,2.2,q.z-T.tz[0]*34);look.copy(cf.pos).setY(0.8);fov=30;if(simT>SIM.cars[shot.focus].finT+1.2)look.set(T.x[0]+T.tx[0]*40,0.8,T.z[0]+T.tz[0]*40);break;}
    case 'orbit':{const u=(tv-shot.v0);const ang=u*0.35;const rad=24;pos=V(cf.pos.x+Math.cos(ang)*rad,5.5,cf.pos.z+Math.sin(ang)*rad);look.copy(cf.pos).setY(0.9);fov=38;break;}
  }
  if(shake){const s=shake;pos.x+=Math.sin(tv*47)*s;pos.y+=Math.sin(tv*61+2)*s;pos.z+=Math.sin(tv*53+1)*s;}
  camera.position.copy(pos);camera.fov=fov;camera.updateProjectionMatrix();camera.lookAt(look);
}

// ------------------------------------------------------------------ frame render
const el=id=>document.getElementById(id);
const tower=el('tower');for(let i=0;i<NC;i++){const r=document.createElement('div');r.className='r';r.innerHTML='<div class="p"></div><div class="c"></div><div class="n"></div><div class="g"></div>';tower.appendChild(r);}
const towerRows=[...tower.children];
const fmt=x=>{const m=Math.floor(x/60),s=x-m*60;return m+':'+(s<10?'0':'')+s.toFixed(1);};
function setBanner(txt,op){const b=el('banner');b.textContent=txt;b.style.opacity=op;}
function hud(tv,shot,simT){
  const f=clamp(Math.round(simT/DT),0,NF-1);const rk=SIM.rankAt(f);const lead=poseAt(rk[0],simT);
  const lap=clamp(Math.floor(Math.max(0,lead.D)/T.LEN)+1,1,LAPS);
  const finishedAll=simT>tEnd-8;
  el('lap').textContent=(simT>=SIM.cars.reduce((m,c)=>Math.min(m,c.finT||1e9),1e9))?'META':`VUELTA ${lap} / ${LAPS}`;
  for(let a=0;a<NC;a++){const i=rk[a],row=towerRows[a],sp=CAR_SPECS[i],c=SIM.cars[i];const pi=poseAt(i,simT);
    row.children[0].textContent=a+1;row.children[1].style.background=sp.id==='hoonicorn'?'#e8e8e8':sp.color;row.children[2].textContent=sp.short==='HNC'?'HOONICORN':sp.name.replace('BMW ','');
    let g='';const fin=c.finT!==null&&simT>=c.finT;
    if(fin){g=`P${c.finPos}`;}else if(c.dnf&&pi.mode===2&&pi.dmg>0.8){g='DNF';}
    else if(a===0)g='LÍDER';else{const pj=poseAt(rk[a-1],simT);const gap=(pj.D-pi.D)/Math.max(8,pi.v);g='+'+gap.toFixed(1);}
    row.children[3].textContent=g;row.classList.toggle('out',c.dnf&&pi.dmg>0.8);}
  const fc=shot.focus;const fp=poseAt(fc,simT);el('fname').textContent=CAR_SPECS[fc].name;el('fspd').textContent=Math.round(fp.v*3.6);
  // start lights
  const L=el('lights');if(simT<3.7&&shot.label!=='intro'){L.style.opacity=1;[...L.children].forEach((d,k)=>d.classList.toggle('on',simT<3.0&&simT>=k*0.5+0.2));}else L.style.opacity=0;
  if(shot.label==='intro'){L.style.opacity=0;}
  // banner
  let txt='',op=0;const nm=i=>CAR_SPECS[i].short==='HNC'?'HOONICORN':CAR_SPECS[i].name;
  for(let k=SIM.events.length-1;k>=0;k--){const e=SIM.events[k];if(e.t>simT)continue;const age=simT-e.t;if(age>3.2)break;
    let m=null;
    if(e.type==='contact'&&e.sev>3.5)m=`¡CONTACTO!  ${nm(e.a)} × ${nm(e.b)}`;
    else if(e.type==='wall'&&e.sev>5)m=`¡GOLPE CONTRA LA BARRERA!  ${nm(e.car)}`;
    else if(e.type==='slide'&&e.why==='slip')m=`¡TROMPO!  ${nm(e.car)}`;
    else if(e.type==='mistake'&&age<2)m=`ERROR DE ${nm(e.car)}`;
    else if(e.type==='dnf')m=`${nm(e.car)} ABANDONA`;
    else if(e.type==='fastlap'&&e.lap>=1&&age<3)m=`VUELTA RÁPIDA  ${nm(e.car)}  ${fmt(e.time)}`;
    else if(e.type==='finish'&&age<3.2)m=`¡${nm(e.car)} CRUZA LA META!  P${e.pos}`;
    if(m){txt=m;op=age<0.25?age/0.25:age>2.6?Math.max(0,(3.2-age)/0.6):1;break;}}
  setBanner(txt,op);
  el('replay').style.opacity=shot.replay?1:0;
  // finish / result overlay
  const res=el('result');
  if(shot.label==='result'){const lf=SIM.events.filter(e=>e.type==='fastlap').pop();
    if(!res.dataset.built){res.dataset.built=1;let h='<h2>CLASIFICACIÓN FINAL</h2>';const winner=SIM.results.find(r=>r.pos===1);const wt=winner?winner.time:0;
      SIM.results.forEach((r,k)=>{const sp=CAR_SPECS.find(s=>s.id===r.id);h+=`<div class="row"><div class="p">${r.pos?r.pos:'—'}</div><div class="c" style="background:${sp.id==='hoonicorn'?'#e8e8e8':sp.color}"></div><div class="n">${sp.name}</div><div class="t">${r.pos?(r.pos===1?fmt(r.time-SIM.startT):'+'+(r.time-wt).toFixed(1)+' s'):'NO TERMINÓ'}</div></div>`;});
      if(lf)h+=`<div class="fl">Vuelta rápida: ${CAR_SPECS[lf.car].name} · ${fmt(lf.time)}</div>`;res.innerHTML=h;}
    res.style.opacity=Math.min(1,(tv-shot.v0)/1.2);}
  else res.style.opacity=0;
  el('fade').style.opacity=tv<0.5?1-tv/0.5:(tv>TOTAL/FPS-0.8?(tv-(TOTAL/FPS-0.8))/0.8:0);
  for(const id of ['tower','focus','lap']){el(id).style.opacity=shot.label==='intro'||shot.label==='result'?0:1;}
  if(shot.label==='intro'){el('lap').style.opacity=0;}
}
let LODDIST=45;
function renderFrame(f){
  const tv=f/FPS;const shot=shotAt(tv);let simT=shot.sim0+(tv-shot.v0)*shot.rate;simT=clamp(simT,0,NF*DT-0.05);
  for(let i=0;i<NC;i++){const car=cars[i];const p=poseAt(i,simT);
    car.root.position.set(p.x,0,p.z);car.root.rotation.set(0,p.th,0);car.body.rotation.set(p.pitch,0,p.roll);
    const front=[],rear=[];for(const c of car.corners){if(c.front){c.steer.rotation.y=p.steer;c.spin.rotation.x=p.phF;}else c.spin.rotation.x=p.phR;}
    car.p=p;}
  setCamera(shot,tv,simT);
  // lod + shadows
  const fpos=cars[shot.focus].root.position;
  for(let i=0;i<NC;i++){const car=cars[i];const d=car.root.position.distanceTo(camera.position);const far=d>LODDIST;
    for(const m of car.detail)m.visible=!far;
    const forced=Q.get('lod');const thr=CAR_SPECS[i].id==='hoonicorn'?[11,38]:[15,40];setCarLod(car,forced!==null?+forced:(d<thr[0]?0:d<thr[1]?1:2));
    const sh=car.root.position.distanceTo(fpos)<45;for(const m of car.major)m.castShadow=sh;for(const m of car.detail)m.castShadow=false;
    car.root.visible=d<700&&Q.get('nocars')!=='1';}
  sun.position.set(fpos.x,0,fpos.z).addScaledVector(sunDir,70);sun.target.position.set(fpos.x,0,fpos.z);
  if(Q.get('nosmoke')!=='1')updateParticles(simT);else{pool.forEach(p=>p.visible=false);sparkPool.forEach(p=>p.visible=false);}
  hud(tv,shot,simT);
  renderer.render(scene,camera);
}
window.__cars=cars;window.renderFrame=renderFrame;window.rinfo=()=>({tri:renderer.info.render.triangles,calls:renderer.info.render.calls,carTris:cars.map(c=>{let t=0,td=0;c.major.forEach(m=>t+=(m.geometry.index?m.geometry.index.count:m.geometry.attributes.position.count)/3);c.detail.forEach(m=>td+=(m.geometry.index?m.geometry.index.count:m.geometry.attributes.position.count)/3);return [Math.round(t),Math.round(td)];})});
window.TOTAL=TOTAL;window.FPS=FPS;window.SIMDATA=SIM;
window.shotsInfo=()=>shots.map(s=>({v0:s.v0,dur:s.dur,sim0:s.sim0,rate:s.rate,cam:s.cam,focus:s.focus,replay:!!s.replay,label:s.label||''}));
window.raceSummary=()=>({total:TOTAL,seconds:TOTAL/FPS,results:SIM.results,incidents:incidents.map(e=>({t:e.t,type:e.type,sev:e.sev})),events:SIM.events.length});
// audio descriptors for the offline sound mixer
window.audioFrame=(f)=>{const tv=f/FPS;const shot=shotAt(tv);let simT=clamp(shot.sim0+(tv-shot.v0)*shot.rate,0,NF*DT-0.05);
  setCamera(shot,tv,simT);const cr=camera.position,fwd=new THREE.Vector3();camera.getWorldDirection(fwd);const right=new THREE.Vector3().crossVectors(fwd,V(0,1,0)).normalize();
  const out=[];for(let i=0;i<NC;i++){const p=poseAt(i,simT);const d=V(p.x-cr.x,0.8-cr.y,p.z-cr.z);const dist=d.length();out.push([+p.v.toFixed(2),+dist.toFixed(1),+(d.clone().normalize().dot(right)).toFixed(2),+p.smoke.toFixed(2),p.mode,+p.dmg.toFixed(2)]);}
  const evs=SIM.events.filter(e=>(e.type==='contact'||e.type==='wall')&&e.sev>1.5&&e.t>=simT-0.5/FPS*shot.rate-1e-6&&e.t<simT+0.5/FPS*shot.rate).map(e=>({t:e.type,sev:+e.sev.toFixed(1),dist:+Math.hypot(e.x-cr.x,e.z-cr.z).toFixed(1)}));
  return {simT,rate:shot.rate,cars:out,events:evs,onboard:shot.cam==='onboard',focus:shot.focus,replay:!!shot.replay};};

await loadAll();
document.getElementById('loading').style.display='none';
window.__done=true;
if(!RENDER){
  let tvNow=0,play=true,last=performance.now();const pp=el('pp'),tt=el('tt');
  pp.onclick=()=>{play=!play;pp.textContent=play?'⏸':'▶';last=performance.now();};
  el('rst').onclick=()=>{tvNow=0;};
  (function loop(){requestAnimationFrame(loop);const now=performance.now();if(play)tvNow+=(now-last)/1000;last=now;if(tvNow>=TOTAL/FPS-0.05)tvNow=0;tt.textContent=tvNow.toFixed(1)+' s';renderFrame(Math.floor(tvNow*FPS));})();
}else{renderFrame(0);}
