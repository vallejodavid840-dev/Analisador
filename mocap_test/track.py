import sys, json, cv2, numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision
video, model, out = sys.argv[1:4]
opts = vision.PoseLandmarkerOptions(
    base_options=mpt.BaseOptions(model_asset_path=model),
    running_mode=vision.RunningMode.VIDEO, num_poses=1,
    min_pose_detection_confidence=0.3, min_tracking_confidence=0.3)
det = vision.PoseLandmarker.create_from_options(opts)
cap = cv2.VideoCapture(video)
n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)); dur = 10.863789
fps = n / dur
frames = []; i = 0
while True:
    ok, f = cap.read()
    if not ok: break
    img = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(f, cv2.COLOR_BGR2RGB))
    r = det.detect_for_video(img, int(i * 1000 / fps))
    if r.pose_world_landmarks:
        w = [[l.x, l.y, l.z, l.visibility] for l in r.pose_world_landmarks[0]]
        s = [[l.x, l.y, l.visibility] for l in r.pose_landmarks[0]]
        frames.append({"i": i, "world": w, "screen": s})
    else:
        frames.append({"i": i, "world": None, "screen": None})
    i += 1
json.dump({"fps": fps, "frames": frames}, open(out, "w"))
print("frames", i, "fps", round(fps, 2), "detected", sum(1 for x in frames if x["world"]))
