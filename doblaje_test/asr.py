import json, time
from faster_whisper import WhisperModel
t0=time.time()
m=WhisperModel("medium",device="cpu",compute_type="int8",cpu_threads=2)
import soundfile as sf
aud,_=sf.read("/tmp/dub/a16.wav",dtype="float32")
segs,info=m.transcribe(aud,language="ja",vad_filter=True,word_timestamps=False,beam_size=3)
out=[]
for s in segs:
    out.append({"start":round(s.start,2),"end":round(s.end,2),"text":s.text.strip()})
    if len(out)%20==0: print(len(out),round(s.end),round(time.time()-t0),flush=True); json.dump(out,open("/tmp/dub/jp.json","w"),ensure_ascii=False)
json.dump(out,open("/tmp/dub/jp.json","w"),ensure_ascii=False); print("DONE",len(out),time.time()-t0,flush=True)
