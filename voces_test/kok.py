import json, subprocess, numpy as np, onnxruntime as ort, soundfile as sf, sys, re
tok=json.load(open('/tmp/v/k_tokenizer.json'))['model']['vocab']
sess=ort.InferenceSession('/tmp/v/k_onnx/model_quantized.onnx',providers=['CPUExecutionProvider'])
print([i.name for i in sess.get_inputs()])
def ph(text):
    out=subprocess.run(['espeak-ng','-v','es-419','--ipa','-q','--sep=',text],capture_output=True,text=True).stdout
    return re.sub(r'\s+',' ',out.replace('\n',' ')).strip()
def say(text,voice,speed,out):
    p=ph(text); ids=[tok[c] for c in p if c in tok][:500]
    vo=np.fromfile(f'/tmp/v/k_voices/{voice}.bin',dtype=np.float32).reshape(-1,1,256)
    style=vo[min(len(ids),vo.shape[0]-1)]
    names=[i.name for i in sess.get_inputs()]
    feed={names[0]:np.array([[0]+ids+[0]],dtype=np.int64),'style':style,'speed':np.array([speed],dtype=np.float32)}
    wav=sess.run(None,feed)[0].squeeze()
    sf.write(out,wav,24000); print(out,len(wav)/24000,'s')
T="Soy el héroe más débil del barrio, pero hoy no me voy a rendir. Si quieren pelear, aquí los espero."
say(T,'em_alex',1.0,'/tmp/v/kokoro_alex.wav')
say(T,'em_santa',0.92,'/tmp/v/kokoro_santa.wav')
say(T,'ef_dora',1.0,'/tmp/v/kokoro_dora.wav')
