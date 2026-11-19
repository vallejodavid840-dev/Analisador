// Physical + visual description of each competitor (estimated real-world figures).
// kw: peak power, kg: mass, cda: drag area (m²), mu: tyre grip (g), vmax: km/h limiter,
// L/W/wb: length, width, wheelbase (m), aggr: how hard they attack, err: mistake proneness.
export const CAR_SPECS=[
  {id:'hoonicorn',name:'HOONICORN',short:'HNC',kind:'glb',dir:'models/hoonicorn/',file:'model.glb',color:'#ffffff',
   kw:1044,kg:1450,cda:0.95,mu:1.18,vmax:255,drive:'awd',cyl:8,aggr:0.95,err:1.5,L:4.78,W:2.0,wb:2.75,skill:0.985},
  {id:'z8',name:'BMW Z8',short:'Z8',kind:'fbx',dir:'models/bmw_z8/',color:'#c8d2e0',
   kw:294,kg:1615,cda:0.72,mu:1.05,vmax:250,drive:'rwd',cyl:8,aggr:0.8,err:1.0,L:4.4,W:1.9,wb:2.5,skill:0.975},
  {id:'m5',name:'BMW M5 E34',short:'M5',kind:'fbx',dir:'models/bmw_m5_e34/',color:'#2f5aa8',
   kw:232,kg:1700,cda:0.70,mu:1.0,vmax:250,drive:'rwd',cyl:6,aggr:0.7,err:1.0,L:4.77,W:1.88,wb:2.79,skill:0.975},
  {id:'850',name:'BMW 850 CSi',short:'850',kind:'fbx',dir:'models/bmw_850csi/',color:'#a02424',
   kw:280,kg:1790,cda:0.65,mu:0.98,vmax:250,drive:'rwd',cyl:12,aggr:0.6,err:0.9,L:4.8,W:1.9,wb:2.67,skill:0.97},
  {id:'m3',name:'BMW M3 E36',short:'M3',kind:'fbx',dir:'models/bmw_m3_e36/',color:'#e0b020',
   kw:236,kg:1460,cda:0.62,mu:1.04,vmax:250,drive:'rwd',cyl:6,aggr:0.85,err:1.2,L:4.44,W:1.8,wb:2.71,skill:0.98},
];
