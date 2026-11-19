import torch, torchaudio as ta, sys, time
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
t0=time.time()
m=ChatterboxMultilingualTTS.from_pretrained(device="cpu"); print("loaded",time.time()-t0,flush=True)
T="Soy el héroe más débil del barrio, pero hoy no me voy a rendir. Si quieren pelear, aquí los espero."
w=m.generate(T,language_id="es"); ta.save("/tmp/v/chatterbox_default.wav",w,m.sr); print("default",time.time()-t0,flush=True)
if len(sys.argv)>1:
    w=m.generate(T,language_id="es",audio_prompt_path=sys.argv[1]); ta.save("/tmp/v/chatterbox_clon_tuvoz.wav",w,m.sr); print("clon",time.time()-t0,flush=True)
