# Renders Friday's demo lines with Kokoro (local). Run: ~/Cortex/venv/bin/python tools/voice.py
import os, sys, json, numpy as np, soundfile as sf
import onnxruntime as ort
from kokoro_onnx import Kokoro
M = os.path.expanduser("~/Cortex/models")
k = Kokoro(os.path.join(M, "kokoro-v1.0.onnx"), os.path.join(M, "voices-v1.0.bin"))
VOICE = sys.argv[1] if len(sys.argv) > 1 else "bf_emma"
LINES = json.load(open(os.path.join(os.path.dirname(__file__), "lines.json")))
out = os.path.join(os.path.dirname(__file__), "..", "site", "audio")
for key, text in LINES.items():
    a, sr = k.create(text, voice=VOICE, speed=1.02, lang="en-gb")
    a = a / (np.abs(a).max() + 1e-6) * 0.89
    sf.write(f"/tmp/friday_{key}.wav", a, sr)
    os.system(f'/opt/homebrew/bin/ffmpeg -loglevel error -y -i /tmp/friday_{key}.wav -af "aecho=0.8:0.5:40:0.12,highpass=f=80" -b:a 96k "{out}/{key}.mp3"')
    print(key, round(len(a) / sr, 1), "s")
