# Blender: posições no mundo das juntas (mesma ordem do mixamo-bake.mjs), em cm e Y para cima, a 60 Hz.
import bpy, sys, json
args = sys.argv[sys.argv.index('--') + 1:]
out = args[0]
J = ['Hips','Spine','Spine1','Spine2','Neck','Head','HeadTop_End','LeftArm','LeftForeArm','LeftHand','LeftHandMiddle1',
     'RightArm','RightForeArm','RightHand','RightHandMiddle1','LeftUpLeg','LeftLeg','LeftFoot','LeftToeBase','LeftToe_End',
     'RightUpLeg','RightLeg','RightFoot','RightToeBase','RightToe_End']
res = {}
for spec in args[1:]:
    src, name = spec.rsplit('=', 1)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=src)
    arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
    act = bpy.data.actions[0]
    f0, f1 = act.frame_range
    sc = bpy.context.scene
    fps = sc.render.fps / sc.render.fps_base
    dur = (f1 - f0) / fps
    n = int(round(dur * 60)) + 1
    bones = {b.name.split(':')[-1]: b for b in arm.pose.bones}
    frames = []
    for i in range(n):
        t = f0 + i / 60 * fps
        sc.frame_set(int(t), subframe=t - int(t))
        row = []
        for j in J:
            pb = bones[j]
            p = arm.matrix_world @ pb.head
            row.append([round(p.x * 100, 4), round(p.z * 100, 4), round(-p.y * 100, 4)])
        frames.append(row)
    res[name] = {'duracao': dur, 'quadros': frames, 'fps_origem': fps}
    print('OK', name, n, dur, fps)
json.dump(res, open(out, 'w'))
