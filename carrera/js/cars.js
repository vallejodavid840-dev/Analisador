import * as THREE from 'three';
import {FBXLoader} from '../lib/FBXLoader.js';
import {GLTFLoader} from '../lib/GLTFLoader.js';
import {mergeVertices} from '../lib/BufferGeometryUtils.js';
import {MeshoptSimplifier} from '../lib/meshopt_simplifier.js';
await MeshoptSimplifier.ready;

import {CAR_SPECS} from './specs.js';
export const CAR_DEFS=CAR_SPECS;

// split a merged two-wheel mesh into +x / -x halves (keeps material groups)
function splitByX(mesh){
  const g=mesh.geometry, pos=g.attributes.position;
  const idx=g.index?Array.from(g.index.array):Array.from({length:pos.count},(_,i)=>i);
  const groups=g.groups.length?g.groups:[{start:0,count:idx.length,materialIndex:0}];
  mesh.updateWorldMatrix(true,false);
  const v=new THREE.Vector3(); const wx=i=>{v.fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld);return v.x;};
  const out=[];
  for(const side of [1,-1]){
    const arr=[],ng=[];
    for(const gr of groups){const s0=arr.length;
      for(let t=gr.start;t<gr.start+gr.count;t+=3){const cx=(wx(idx[t])+wx(idx[t+1])+wx(idx[t+2]))/3; if(Math.sign(cx)===side){arr.push(idx[t],idx[t+1],idx[t+2]);}}
      if(arr.length>s0)ng.push({start:s0,count:arr.length-s0,materialIndex:gr.materialIndex});}
    const geo=new THREE.BufferGeometry();for(const k in g.attributes)geo.setAttribute(k,g.attributes[k]);
    geo.setIndex(arr);geo.clearGroups();
    if(Array.isArray(mesh.material))ng.forEach(x=>geo.addGroup(x.start,x.count,x.materialIndex));
    const m=new THREE.Mesh(geo,mesh.material);m.position.copy(mesh.position);m.quaternion.copy(mesh.quaternion);m.scale.copy(mesh.scale);m.name=mesh.name+(side>0?'_L':'_R');
    mesh.parent.add(m);m.castShadow=m.receiveShadow=true;out.push(m);}
  mesh.parent.remove(mesh);return out;
}
function convertMaterials(obj,def){
  const cache=new Map();
  const conv=(m)=>{ if(cache.has(m))return cache.get(m); const n=m.name||'';let r;
    const glass=/window|glass/i.test(n)&&!/light|lights/i.test(n);
    if(/^(body|body_2)$/i.test(n)){ r=new (new URLSearchParams(location.search).get('pbr')==='0'?THREE.MeshStandardMaterial:THREE.MeshPhysicalMaterial)({map:m.map,color:new THREE.Color(def.color),metalness:0.45,roughness:0.32,clearcoat:1,clearcoatRoughness:0.08,envMapIntensity:1.1}); }
    else if(glass){ r=new THREE.MeshStandardMaterial({color:0x0a0f14,metalness:0.9,roughness:0.06,transparent:true,opacity:0.62,envMapIntensity:1.4}); }
    else if(/chrome|metal|mirror|rim|hub/i.test(n)){ r=new THREE.MeshStandardMaterial({map:m.map,color:m.map?0xffffff:(m.color?m.color.getHex():0xcccccc),metalness:0.9,roughness:0.25,envMapIntensity:1.2}); }
    else { r=new THREE.MeshStandardMaterial({map:m.map,color:m.color?m.color.clone():new THREE.Color(0xffffff),roughness:Math.max(0.35,1-(m.shininess||4)/110),metalness:0.05,transparent:m.transparent,opacity:m.opacity,envMapIntensity:0.7}); if(m.map&&m.color&&m.color.getHex()===0)r.color.set(0xffffff);}
    if(m.map){m.map.colorSpace=THREE.SRGBColorSpace;m.map.anisotropy=4;}
    if(r.transparent&&!glass)r.depthWrite=false;
    r.side=THREE.FrontSide;cache.set(m,r);return r;};
  obj.traverse(o=>{if(!o.isMesh)return;o.material=Array.isArray(o.material)?o.material.map(conv):conv(o.material);});
}
const worldBox=o=>new THREE.Box3().setFromObject(o);
function usedBox(mesh){ // bbox of only the vertices referenced by the index (world space)
  mesh.updateWorldMatrix(true,false);const pos=mesh.geometry.attributes.position,idx=mesh.geometry.index.array;
  const b=new THREE.Box3(),v=new THREE.Vector3(),seen=new Uint8Array(pos.count);
  for(let i=0;i<idx.length;i++){const k=idx[i];if(seen[k])continue;seen[k]=1;v.fromBufferAttribute(pos,k).applyMatrix4(mesh.matrixWorld);b.expandByPoint(v);}
  return b;}

function makeCorner(body,center,r,front,side){
  const piv=new THREE.Group();piv.position.copy(center);body.add(piv);
  const steer=new THREE.Group(),spin=new THREE.Group();piv.add(steer);steer.add(spin);
  return {piv,steer,spin,c:center.clone(),r,front,side};
}

// Build lower-poly versions of every mesh (meshoptimizer) so far-away cars are cheap to draw.
export const LOD_RATIOS=[1,0.32,0.1];
function buildLods(mesh){
  const g=mesh.geometry;const pos=g.attributes.position;
  const lods=[g];
  if(!g.index||pos.isInterleavedBufferAttribute||!(pos.array instanceof Float32Array)||g.index.count<900){mesh.userData.lods=[g,g,g];return;}
  const idx=g.index.array;const groups=g.groups.length?g.groups.map(x=>({start:x.start,count:x.count,materialIndex:x.materialIndex})):[{start:0,count:idx.length,materialIndex:0}];
  for(let l=1;l<LOD_RATIOS.length;l++){
    const out=[],ng=[];
    for(const gr of groups){const sub=new Uint32Array(idx.buffer?idx.subarray?idx.subarray(gr.start,gr.start+gr.count):idx.slice(gr.start,gr.start+gr.count):idx.slice(gr.start,gr.start+gr.count));
      let res=sub;
      if(sub.length>=300){let target=Math.max(150,Math.floor(sub.length*LOD_RATIOS[l]/3)*3);
        try{res=MeshoptSimplifier.simplify(sub,pos.array,3,target,l===1?0.03:0.12,['LockBorder'])[0];}catch(e){res=sub;}}
      ng.push({start:out.length,count:res.length,materialIndex:gr.materialIndex});for(let i=0;i<res.length;i++)out.push(res[i]);}
    const geo=new THREE.BufferGeometry();for(const k in g.attributes)geo.setAttribute(k,g.attributes[k]);
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(out),1));geo.clearGroups();
    if(Array.isArray(mesh.material))ng.forEach(x=>geo.addGroup(x.start,x.count,x.materialIndex));
    lods.push(geo);}
  mesh.userData.lods=lods;
}
export function setCarLod(car,level){
  if(car._lod===level)return;car._lod=level;
  for(const m of car.meshes){const l=m.userData.lods;if(l)m.geometry=l[Math.min(level,l.length-1)];}
}

export async function loadCar(def,opts={}){
  const root=new THREE.Group(), body=new THREE.Group(); root.add(body);
  let corners=[]; let scale=1;
  if(def.kind==='glb'){
    const gltf=await new GLTFLoader().loadAsync(def.dir+def.file);
    const m=gltf.scene; scale=0.37; root.scale.setScalar(scale); m.position.z=-3.73; body.add(m);
    root.updateMatrixWorld(true);
    const names={FL:'DEF-WheelFtL',FR:'DEF-WheelFtR',BL:'DEF-WheelBkL',BR:'DEF-WheelBkR'};
    for(const [k,pre] of Object.entries(names)){
      let node=null;m.traverse(o=>{if(!node&&o.name.startsWith(pre))node=o;});
      const wb=worldBox(node);const c=body.worldToLocal(wb.getCenter(new THREE.Vector3()));
      const co=makeCorner(body,c,0.92,k[0]==='F',k[1]==='L'?1:-1);root.updateMatrixWorld(true);co.spin.attach(node);corners.push(co);}
    // body of the hoonicorn: ground offset (model's wheels already touch y=0)
    def._lod=(o)=>false;
  }else{
    const mgr=new THREE.LoadingManager();const texDone=new Promise(r=>{mgr.onLoad=r;});
    const ld=new FBXLoader(mgr);ld.setResourcePath(def.dir+'textures/');
    const obj=await ld.loadAsync(def.dir+'model.fbx'); await Promise.race([texDone,new Promise(r=>setTimeout(r,20000))]);
    convertMaterials(obj,def);
    obj.traverse(o=>{if(o.isMesh&&!o.geometry.index){const g=o.geometry;const groups=g.groups.map(x=>({...x}));const ng=mergeVertices(g,1e-5);if(groups.length){ng.clearGroups();groups.forEach(x=>ng.addGroup(x.start,x.count,x.materialIndex));}o.geometry=ng;}});
    body.add(obj); root.updateMatrixWorld(true);
    const meshes=[];obj.traverse(o=>{if(o.isMesh)meshes.push(o);});
    const rims=meshes.filter(m=>/wheel_rim/i.test(m.name)&&!/steering/i.test(m.name));
    const parts={}; // corner key -> {rim,rotors:[],calipers:[]}
    for(const rim of rims){
      const wb=worldBox(rim);const cz=wb.getCenter(new THREE.Vector3()).z;const front=cz>0;
      const halves=splitByX(rim);
      for(const h of halves){const b=usedBox(h);const c=body.worldToLocal(b.getCenter(new THREE.Vector3()));const sz=b.getSize(new THREE.Vector3());
        const side=c.x>0?1:-1;const key=(front?'F':'B')+(side>0?'L':'R');
        parts[key]={rim:h,c,r:sz.y/2,front,side,rotors:[],calipers:[]};}
    }
    for(const m of meshes){
      const nm=m.name.toLowerCase();let mm;
      if((mm=nm.match(/_rotor(l|r)(f|r)_/))){const key=(mm[2]==='f'?'F':'B')+(mm[1]==='l'?'L':'R');parts[key]&&parts[key].rotors.push(m);}
      else if((mm=nm.match(/_caliper(l|r)(f|r)_/))){const key=(mm[2]==='f'?'F':'B')+(mm[1]==='l'?'L':'R');parts[key]&&parts[key].calipers.push(m);}
    }
    root.updateMatrixWorld(true);
    for(const key of Object.keys(parts)){const p=parts[key];
      const co=makeCorner(body,p.c,p.r,p.front,p.side);root.updateMatrixWorld(true);
      co.spin.attach(p.rim);p.rotors.forEach(r=>co.spin.attach(r));p.calipers.forEach(c=>co.steer.attach(c));corners.push(co);}
    // lift so tyres touch y=0
    const bottom=Math.min(...corners.map(c=>c.c.y-c.r));body.position.y=-bottom;
    for(const c of corners)c.piv.position.y=c.c.y; // pivots are in body space already
  }
  root.updateMatrixWorld(true);
  const bb=worldBox(root);const size=bb.getSize(new THREE.Vector3());
  const front=corners.filter(c=>c.front),back=corners.filter(c=>!c.front);
  const wheelbase=front[0].c.z-back[0].c.z, track=Math.abs(front[0].c.x-front[1].c.x);
  const meshes=[];root.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=true;meshes.push(o);}});
  for(const m of meshes)buildLods(m);
  return {root,body,corners,meshes,def,_lod:0,dims:{L:size.z,W:size.x,H:size.y,wheelbase:wheelbase*scale,track:track*scale,scale,zc:(bb.min.z+bb.max.z)/2}};
}
