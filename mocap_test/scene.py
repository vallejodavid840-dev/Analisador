import bpy, json, sys, math
from mathutils import Vector, Quaternion
argv = sys.argv[sys.argv.index('--')+1:]
start, end, step, res_pct, samples, out = int(argv[0]), int(argv[1]), int(argv[2]), int(argv[3]), int(argv[4]), argv[5]
A = json.load(open('/tmp/w/anim.json')); W = A['world']; R = A['root']; fps = A['fps']
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'; sc.cycles.samples = samples; sc.cycles.device='CPU'
sc.cycles.use_denoising = False
sc.render.resolution_x = 1280; sc.render.resolution_y = 720; sc.render.resolution_percentage = res_pct
sc.render.fps = 30
def mat(name, rgb, rough=0.5):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (*rgb,1); b.inputs['Roughness'].default_value = rough
    return m
skin = mat('skin',(0.95,0.7,0.55)); shirt = mat('shirt',(0.1,0.55,0.9)); pants=mat('pants',(0.12,0.12,0.2)); shoe=mat('shoe',(0.95,0.95,0.95)); dark=mat('dark',(0.02,0.02,0.02))
floor = mat('floor',(0.35,0.4,0.5),0.8)
def sphere(r, m, name):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=24, ring_count=16); o = bpy.context.object; o.name=name
    o.data.materials.append(m); bpy.ops.object.shade_smooth(); return o
def cyl(r, m, name):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=1, vertices=20); o = bpy.context.object; o.name=name
    o.data.materials.append(m); bpy.ops.object.shade_smooth(); o.rotation_mode='QUATERNION'; return o
ZMIN = min(-W[k][j][1] for k in range(len(W)) for j in (27,28,29,30,31,32))
def P(k,j):
    x,y,z = W[k][j]; return Vector((x+R[k][0], z+R[k][1], -y-ZMIN))
# limbs: (a,b,radius,material)
LIMBS = {'uarm_l':(11,13,0.055,shirt),'larm_l':(13,15,0.045,skin),'uarm_r':(12,14,0.055,shirt),'larm_r':(14,16,0.045,skin),
 'uleg_l':(23,25,0.075,pants),'lleg_l':(25,27,0.06,pants),'uleg_r':(24,26,0.075,pants),'lleg_r':(26,28,0.06,pants),
 'foot_l':(27,31,0.05,shoe),'foot_r':(28,32,0.05,shoe)}
objs = {n:cyl(r,m,n) for n,(a,b,r,m) in LIMBS.items()}
joints = {}
for j,(r,m) in {11:(0.07,shirt),12:(0.07,shirt),13:(0.055,shirt),14:(0.055,shirt),15:(0.055,skin),16:(0.055,skin),23:(0.085,pants),24:(0.085,pants),25:(0.07,pants),26:(0.07,pants),27:(0.06,shoe),28:(0.06,shoe)}.items():
    joints[j] = sphere(r,m,'j%d'%j)
torso = sphere(1.0, shirt, 'torso')
head = sphere(0.11, skin, 'head')
eyeL = sphere(0.018, dark, 'eyeL'); eyeR = sphere(0.018, dark, 'eyeR')
hair = sphere(0.12, dark, 'hair')
def look(o, d):
    d = d.normalized(); o.rotation_quaternion = Vector((0,0,1)).rotation_difference(d)
# scene env
bpy.ops.mesh.primitive_plane_add(size=20, location=(0,0,0)); fl = bpy.context.object; fl.data.materials.append(floor)
bpy.ops.object.light_add(type='SUN', location=(2,-3,5)); sun = bpy.context.object; sun.data.energy = 4; sun.rotation_euler=(math.radians(50),0,math.radians(25))
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55,0.75,0.95,1); w.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
bpy.ops.object.camera_add(location=(0,-3.6,1.0)); cam = bpy.context.object; sc.camera = cam
cam.rotation_euler = (math.radians(88),0,0); cam.data.lens = 30
for k in range(start, end+1, step):
    f = (k - start)//step + 1
    sc.frame_set(f)
    for n,(a,b,r,m) in LIMBS.items():
        pa, pb = P(k,a), P(k,b); o = objs[n]
        o.location = (pa+pb)/2; look(o, pb-pa); o.scale = (1,1,(pb-pa).length)
        o.keyframe_insert('location',frame=f); o.keyframe_insert('rotation_quaternion',frame=f); o.keyframe_insert('scale',frame=f)
    for j,o in joints.items():
        o.location = P(k,j); o.keyframe_insert('location',frame=f)
    sh = (P(k,11)+P(k,12))/2; hp = (P(k,23)+P(k,24))/2
    torso.location = (sh+hp)/2 + Vector((0,0,0.0)); 
    torso.scale = ((P(k,11)-P(k,12)).length/2+0.04, 0.10, (sh-hp).length/2+0.04)
    # orient torso: x along shoulder line, z along spine
    xa = (P(k,11)-P(k,12)).normalized() ; za = (sh-hp).normalized(); ya = za.cross(xa).normalized(); xa = ya.cross(za).normalized()
    from mathutils import Matrix
    torso.rotation_mode='QUATERNION'; torso.rotation_quaternion = Matrix((xa,ya,za)).transposed().to_quaternion()
    for key in ('location','rotation_quaternion','scale'): torso.keyframe_insert(key, frame=f)
    ear = (P(k,7)+P(k,8))/2; nose = P(k,0)
    hc = ear + Vector((0,0,0.02)); head.location = hc; head.keyframe_insert('location',frame=f)
    fw = (nose-ear).normalized(); side = (P(k,8)-P(k,7)).normalized()
    up = side.cross(fw).normalized() if False else Vector((0,0,1))
    for e,sgn in ((eyeL,1),(eyeR,-1)):
        e.location = hc + fw*0.095 + side*0.035*sgn + Vector((0,0,0.02)); e.keyframe_insert('location',frame=f)
    hair.location = hc + Vector((0,0,0.035)) - fw*0.015; hair.scale=(1,1,0.9); hair.keyframe_insert('location',frame=f); hair.keyframe_insert('scale',frame=f)
sc.frame_start = 1; sc.frame_end = (end-start)//step + 1
sc.render.image_settings.file_format = 'PNG'
sc.render.filepath = out
bpy.ops.render.render(animation=True)
