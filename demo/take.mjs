// One recorded take of a Friday demo clip.  node take.mjs <name> "<line 1>" ["<line 2>" ...]
// Hides his windows + desktop icons, records the screen (no audio: the soundtrack is rebuilt from the timeline),
// opens the demo notch, speaks each line through the real pipeline, then restores everything.
// Out: takes/<name>.mov + takes/<name>.json (timeline, wall-clock ms)
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, appendFileSync } from "node:fs";

const [name, ...says] = process.argv.slice(2);
const API = "http://localhost:8957";
const DIR = new URL(".", import.meta.url).pathname;
mkdirSync(DIR + "takes", { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const osa = (s) => { try { return execFileSync("osascript", ["-e", s]).toString().trim(); } catch { return ""; } };
const post = (p, b = {}) => fetch(API + p, { method: "POST", body: JSON.stringify(b) }).then((r) => r.json());
const marks = [];
const mark = (kind, extra = {}) => marks.push({ t: Date.now(), kind, ...extra });
const step = (m) => appendFileSync(`${DIR}takes/${name}.log`, `${new Date().toISOString().slice(11, 23)} ${m}\n`);
step("start");

// ---------- clean stage ----------
osa("tell application \"System Events\" to launch"); await sleep(800);
try { execFileSync("pgrep", ["-x", "FridayNotch"]); } catch { execFileSync("open", [DIR + "notch/FridayNotch.app"]); await sleep(2500); }
const running = osa('tell application "System Events" to get name of every process whose background only is false').split(", ");
const visible = osa('tell application "System Events" to get name of every process whose visible is true and background only is false').split(", ").filter(Boolean);   // Finder too: its windows hide, the desktop stays
const readDefault = (dom, key) => { try { return execFileSync("defaults", ["read", dom, key]).toString().trim(); } catch { return null; } };
const widgetsWas = readDefault("com.apple.WindowManager", "StandardHideWidgets");
const desktopWas = (() => { try { return execFileSync("defaults", ["read", "com.apple.finder", "CreateDesktop"]).toString().trim(); } catch { return null; } })();
let restored = false;
function restore() {
  if (restored) return; restored = true; step("restore");
  try { execFileSync("curl", ["-s", "-XPOST", API + "/api/notch", "-d", '{"cmd":"backdrop-off"}']); } catch {}
  for (const n of visible) osa(`tell application "System Events" to set visible of process "${n}" to true`);
  if (desktopWas === null) execFileSync("defaults", ["delete", "com.apple.finder", "CreateDesktop"]);
  else execFileSync("defaults", ["write", "com.apple.finder", "CreateDesktop", desktopWas]);
  execFileSync("killall", ["Finder"]);
  if (widgetsWas === null) execFileSync("defaults", ["delete", "com.apple.WindowManager", "StandardHideWidgets"]);
  else execFileSync("defaults", ["write", "com.apple.WindowManager", "StandardHideWidgets", "-int", widgetsWas]);
  // quit only the apps this take opened
  const now = osa('tell application "System Events" to get name of every process whose background only is false').split(", ");
  for (const n of now) if (n && !running.includes(n) && n !== "FridayNotch") try { execFileSync("killall", [n]); } catch {}
}
process.on("SIGINT", () => { restore(); process.exit(1); });
process.on("SIGTERM", () => { restore(); process.exit(1); });
process.on("uncaughtException", (e) => { step("CRASH " + e.stack); restore(); process.exit(1); });
process.on("unhandledRejection", (e) => { step("CRASH " + (e && e.stack)); restore(); process.exit(1); });
process.on("exit", (c) => { step("exit " + c); restore(); });

execFileSync("defaults", ["write", "com.apple.finder", "CreateDesktop", "-bool", "false"]);
execFileSync("killall", ["Finder"]);
execFileSync("defaults", ["write", "com.apple.WindowManager", "StandardHideWidgets", "-int", "1"]);
for (const n of visible) osa(`tell application "System Events" to set visible of process "${n}" to false`);
await sleep(1500);

// ---------- stage the apps the line will open (not recorded) ----------
// Safari: answer Google's one-time location prompt now ("Don't Allow", remembered for a day), and set a window
// size that leaves room for Calculator. Calculator: park it on the right. Both quit again, macOS keeps the frames.
await post("/api/notch", { cmd: "backdrop-on" });
step("hidden");
// quit an app the way cmd-Q does (a killall makes Safari restore its old tabs next launch)
const quit = async (app) => {
  osa(`tell application "System Events" to tell process "${app}" to set frontmost to true`);
  await sleep(400);
  const front = osa('tell application "System Events" to get name of first process whose frontmost is true');
  if (front === app) osa('tell application "System Events" to keystroke "q" using command down');   // never cmd-Q anything else
  await sleep(1200);
  try { execFileSync("killall", [app]); } catch {}
};
if (says.join(" ").toLowerCase().includes("safari")) {
  execFileSync("open", ["-a", "Safari"]);
  await sleep(3000);
  osa('tell application "System Events" to tell process "Safari" to set position of front window to {70, 105}');
  osa('tell application "System Events" to tell process "Safari" to set size of front window to {940, 755}');
  await quit("Safari");
}
step("stage calculator");
if (says.join(" ").toLowerCase().includes("calculator")) {
  execFileSync("open", ["-a", "Calculator"]);
  await sleep(1500);
  osa('tell application "System Events" to tell process "Calculator" to set position of front window to {1090, 330}');
  await quit("Calculator");
}
await sleep(1000);

step("staged");
// ---------- record ----------
const out = `${DIR}takes/${name}.mov`;
const rec = spawn("/opt/homebrew/bin/ffmpeg", ["-loglevel", "error", "-y", "-f", "avfoundation", "-capture_cursor", "0", "-framerate", "30",
  "-i", "Capture screen 0:none", "-c:v", "h264_videotoolbox", "-b:v", "24M", "-pix_fmt", "yuv420p", out], { stdio: ["pipe", "inherit", "inherit"] });
mark("rec-start"); step("recording");
await sleep(2500);

try {
  await post("/api/clear");   // the vault + model session are reset before the take (batch.sh)
  await post("/api/notch", { cmd: "open" });
  mark("notch-open");
  await sleep(3500);   // a beat on the dashboard
  for (const line of says) {
    mark("say", { text: line });
    const r = await post("/api/say", { text: line });
    mark("heard", r);
    for (let i = 0; i < 90; i++) {   // wait until Friday is done talking
      const s = await (await fetch(API + "/api/status")).json();
      if (s.state === "idle" && !s.pending && !s.speaking) break;
      await sleep(500);
    }
    await sleep(+(process.env.HOLD || 6500));   // the answer lingers 4 s, then the dashboard returns
  }
  await post("/api/notch", { cmd: "close" });
  mark("notch-close");
  await sleep(2000);
} finally {
  rec.stdin.write("q");
  await new Promise((r) => rec.on("close", r));
  mark("rec-stop");
  const timeline = await (await fetch(API + "/api/timeline")).json();
  writeFileSync(`${DIR}takes/${name}.json`, JSON.stringify({ marks, timeline }, null, 1));
  restore();
}
console.log("take saved:", out);
