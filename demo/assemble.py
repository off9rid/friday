# Turns a recorded take into a finished clip.  python3 assemble.py <take-name> [--think 1.2]
# - syncs the silent screen recording to the timeline by finding the frame where the notch drops open
# - rebuilds the soundtrack: the user's line, Friday's lines, Cortex's tick on each live action
# - crops off the menu bar (his real clock and icons) and the dock
# - shortens the model's thinking pause to --think seconds (the only cut; everything else is real time)
# Out: out/<take>.mp4 (1920x1060) + out/<take>.wav
import json, subprocess, sys, os, numpy as np

FF = "/opt/homebrew/bin/ffmpeg"
D = os.path.dirname(os.path.abspath(__file__))
name = sys.argv[1]
think = float(sys.argv[sys.argv.index("--think") + 1]) if "--think" in sys.argv else 1.2
tight = "--tight" in sys.argv   # clips with no app windows: frame just the notch (also readable on phones)
mov, meta = f"{D}/takes/{name}.mov", json.load(open(f"{D}/takes/{name}.json"))
os.makedirs(f"{D}/out", exist_ok=True)
SR = 48000

def mark(kind): return next(m["t"] for m in meta["marks"] if m["kind"] == kind)
rec0 = mark("rec-start")

# ---- sync: the strip just under the notch, per frame; it changes when the panel drops over it
W, H = 2940, 1912
strip = subprocess.run([FF, "-loglevel", "error", "-i", mov, "-vf", f"crop=600:60:{W//2-300}:120,scale=60:6,format=gray", "-f", "rawvideo", "-"],
                       capture_output=True).stdout
px = np.frombuffer(strip, np.uint8).reshape(-1, 360).astype(np.float32)
dev = np.abs(px - np.median(px[:20], 0)).mean(1)          # how far each frame is from the empty strip
first = int(np.argmax(dev > max(4.0, dev.max() * 0.35)))
open_v = first / 30.0                      # video time the panel shows
offset = open_v - (mark("notch-open") - rec0) / 1000 - 0.12   # panel needs ~0.12 s to reach the strip
vt = lambda t_ms: (t_ms - rec0) / 1000 + offset
print(f"sync: notch visible at {open_v:.2f}s, offset {offset:+.2f}s")

# ---- the cut: shorten the gap between the end of the question and Friday's first word
tl = meta["timeline"]
user = next(e for e in tl if e["kind"] == "user")
fri = [e for e in tl if e["kind"] == "friday"]
user_end = vt(user["t"]) + user["dur"]
cut = None
if fri:
    gap0, gap1 = user_end + 0.6, vt(fri[0]["t"]) - 0.25     # keep the transcribe beat, then skip to just before she talks
    if gap1 - gap0 > think: cut = (gap0 + think / 2, gap1 - think / 2)
start = max(0, vt(mark("notch-open")) - 0.35)
end = vt(mark("notch-close")) + 0.8
def out_t(v):   # source video time -> clip time
    if cut and v >= cut[1]: v -= cut[1] - cut[0]
    return v - start

# ---- soundtrack
def load(f):
    a = subprocess.run([FF, "-loglevel", "error", "-i", f, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True).stdout
    return np.frombuffer(a, np.float32)
total = out_t(end) + 0.5
mix = np.zeros(int(total * SR) + SR, np.float32)
def place(sig, t, gain):
    i = int(t * SR)
    if i < 0: return
    mix[i:i + len(sig)] += sig[: max(0, len(mix) - i)] * gain
place(load(user["file"]), out_t(vt(user["t"])), 0.85)
for e in fri: place(load(e["file"]), out_t(vt(e["t"])), 1.0)
tick = load(os.path.expanduser("~/Cortex/hud/sfx/tick.wav"))
for e in tl:
    if e["kind"] == "sfx": place(tick, out_t(vt(e["t"])), 0.5)
mix /= max(1.0, np.abs(mix).max() / 0.95)
wav = f"{D}/out/{name}.wav"
subprocess.run([FF, "-loglevel", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-", wav], input=mix.tobytes(), check=True)

# ---- picture
MB, NL, NR = 76, W // 2 - 490, W // 2 + 490            # menu bar height, notch panel span (px)
look = (f"crop=1740:960:{(W-1740)//2}:{MB}" if tight else f"crop={W}:{1700-MB}:0:{MB}") + ",scale=1920:1060:flags=lanczos"   # the menu bar is cropped off: the panel drops in from the top edge
if cut:
    trim = (f"[0:v]trim={start}:{cut[0]},setpts=PTS-STARTPTS[a];[0:v]trim={cut[1]}:{end},setpts=PTS-STARTPTS[b];"
            f"[a][b]concat=n=2:v=1[c];[c]{look}[v]")
else:
    trim = f"[0:v]trim={start}:{end},setpts=PTS-STARTPTS,{look}[v]"
out = f"{D}/out/{name}.mp4"
subprocess.run([FF, "-loglevel", "error", "-y", "-i", mov, "-i", wav, "-filter_complex", trim, "-map", "[v]", "-map", "1:a",
                "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest",
                "-movflags", "+faststart", out], check=True)
print(f"cut: {'%.1fs of thinking removed' % (cut[1]-cut[0]) if cut else 'none'}; clip {out_t(end):.1f}s -> {out}")
