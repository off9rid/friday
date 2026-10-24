// Scrolls a headless Chrome to each Y and screenshots the viewport. node tools/shoot.mjs URL W H out-prefix y1 y2 ...
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const [url, W, H, prefix, ...ys] = process.argv.slice(2);
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--remote-debugging-port=9333", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars", `--window-size=${W},${H}`, "--user-data-dir=/tmp/friday-cdp", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch("http://127.0.0.1:9333/json")).json(); break; } catch { await sleep(250); } }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = {};
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending[d.id]) { pending[d.id](d.result); delete pending[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { pending[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
await send("Emulation.setDeviceMetricsOverride", { width: +W, height: +H, deviceScaleFactor: 1, mobile: +W < 500 });
await send("Page.navigate", { url });
await sleep(3500);
for (const y of ys) {
  await send("Runtime.evaluate", { expression: String(y).startsWith('#') ? `document.documentElement.style.scrollBehavior='auto';document.querySelector('${y}').scrollIntoView({block:'center'})` : `document.documentElement.style.scrollBehavior='auto';scrollTo(0,${y})` });
  await sleep(+(process.env.DELAY||1800));
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${prefix}-${y}.png`, Buffer.from(r.data, "base64"));
}
const logs = await send("Runtime.evaluate", { expression: "document.body.scrollHeight" });
console.log("height", logs.result.value);
ws.close(); chrome.kill();
