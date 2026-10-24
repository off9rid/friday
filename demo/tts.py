# Demo voices on 127.0.0.1:8958. GET /wav?voice=af_heart&text=... -> 24 kHz mono wav.
# Friday = af_heart (American, same as the site clips). The demo user ("Alex") = am_michael.
import os, io, numpy as np, soundfile as sf
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from kokoro_onnx import Kokoro
M = os.path.expanduser("~/Cortex/models")
k = Kokoro(os.path.join(M, "kokoro-v1.0.onnx"), os.path.join(M, "voices-v1.0.bin"))

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        u = urlparse(self.path); q = parse_qs(u.query)
        if u.path == "/ping": self.send_response(200); self.end_headers(); self.wfile.write(b"ok"); return
        text = q.get("text", [""])[0]; voice = q.get("voice", ["af_heart"])[0]; speed = float(q.get("speed", ["1.05"])[0])
        a, sr = k.create(text, voice=voice, speed=speed, lang="en-us")
        a = a / (np.abs(a).max() + 1e-6) * 0.89
        b = io.BytesIO(); sf.write(b, a, sr, format="WAV", subtype="PCM_16")
        self.send_response(200); self.send_header("Content-Type", "audio/wav"); self.end_headers(); self.wfile.write(b.getvalue())

ThreadingHTTPServer(("127.0.0.1", 8958), H).serve_forever()
