#!/usr/bin/env node
// Friday demo server (10-24): the real Cortex engine with a demo life, for screen-recorded product clips.
//   node server.js   then the demo notch (FridayNotch.app) loads http://localhost:8957/mini.html
// Differences from ~/Cortex/hud/server.js (which stays untouched):
//   - brain: `claude -p` in ~/Friday/demo/vault (Alex's sample notes), no user settings/hooks/MCP, so nothing personal leaks
//   - voices: tts.py on :8958 (Friday = af_heart, the user = am_michael). Nothing plays out loud, so the real Cortex mic
//     never hears it; every clip is logged to the timeline and the soundtrack is rebuilt in the edit.
//   - input: POST /api/say {text} speaks the line in the user's voice and streams it through the same live-intents
//     engine (Cortex's live.js) and whisper-server as a real push-to-talk, frame by frame in real time.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const PORT = 8957;
const DIR = __dirname;
const HOME = os.homedir();
const VAULT = path.join(DIR, 'vault');
const CLIPS = path.join(DIR, 'clips');
const TTS = 'http://127.0.0.1:8958';
const WHISPER = 'http://127.0.0.1:8936';
const CLAUDE = path.join(HOME, '.local/bin/claude');
const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const RATE = 16000, FRAME = 480, FRAME_S = FRAME / RATE;
fs.mkdirSync(CLIPS, { recursive: true });

// the demo day is a Thursday that starts at 9:41 AM whenever the server starts, and runs in real time from there
const T0 = Date.now(), SIM0 = (() => { const d = new Date(); d.setDate(d.getDate() + ((4 - d.getDay() + 7) % 7)); d.setHours(9, 41, 0, 0); return +d; })();   // a Thursday
let simShift = 0;
const simNow = () => SIM0 + (Date.now() - T0) + simShift;
const log = (m) => fs.appendFileSync(path.join(DIR, 'demo.log'), new Date().toISOString().slice(11, 19) + ' ' + m + '\n');

// ---------- page events + timeline ----------
const clients = new Set();
let state = 'idle', timeline = [], notchCmd = '';
function send(type, data = {}) { const msg = `data: ${JSON.stringify({ type, ...data })}\n\n`; for (const r of clients) r.write(msg); }
function setState(s) { state = s; send('state', { state: s }); }
const mark = (kind, data) => timeline.push({ t: Date.now(), kind, ...data });

// ---------- dashboard data ----------
let weather = null;
async function refreshWeather() {
  try {
    const d = await (await fetch('https://wttr.in/Toronto?format=j1', { signal: AbortSignal.timeout(6000) })).json();
    const c = d.current_condition[0], w = d.weather[0];
    weather = { temp: +c.temp_C, desc: c.weatherDesc[0].value.trim().toLowerCase(), high: +w.maxtempC, rain: Math.max(...w.hourly.map((h) => +h.chanceofrain)) };
  } catch (e) { weather = weather || { temp: 11, desc: 'partly cloudy', high: 13, rain: 30 }; }
}
refreshWeather(); setInterval(refreshWeather, 30 * 60000).unref();
function today() {
  const now = new Date(simNow()), day = (h, m) => { const d = new Date(now); d.setHours(h, m, 0, 0); return +d; };
  const cal = fs.readFileSync(path.join(VAULT, 'Daily/Today.md'), 'utf8').split('\n')
    .map((l) => l.match(/^- (\d\d):(\d\d) (.+)$/)).filter(Boolean).map((m) => ({ at: day(+m[1], +m[2]), label: m[3] }));
  let dl = [];
  try { dl = JSON.parse(fs.readFileSync(path.join(VAULT, 'deadlines.json'), 'utf8')); } catch (e) {}
  const t0 = new Date(now); t0.setHours(0, 0, 0, 0);
  const deadlines = dl.map((d) => {
    const date = d.date === 'TODAY' ? new Date(t0) : new Date(d.date + 'T00:00');
    return { label: d.label, days: Math.round((date - t0) / 864e5), time: d.time || '', done: !!d.done };
  }).filter((d) => d.days >= 0);
  const proposalDone = deadlines.some((d) => /northwind/i.test(d.label) && d.done);
  const open = deadlines.filter((d) => !d.done).sort((a, b) => a.days - b.days || a.time.localeCompare(b.time));
  return { now: simNow(), cal, weather, deadlines: open, tasks: [
    { name: 'Proposal', done: proposalDone }, { name: 'Pricing', done: false }, { name: 'Prototype', done: true }, { name: 'Inbox', done: true }, { name: 'Gym', done: false }] };
}
const pushToday = () => send('today', { today: today() });
fs.watchFile(path.join(VAULT, 'deadlines.json'), { interval: 300 }, pushToday);

// ---------- voices ----------
async function synth(text, voice = 'af_heart') {
  const r = await fetch(`${TTS}/wav?voice=${voice}&text=${encodeURIComponent(text)}`);
  if (!r.ok) throw new Error('tts ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}
function pcm16(wav) {   // 16-bit mono data chunk + sample rate
  let off = 12, sr = 24000, data = null;
  while (off + 8 <= wav.length) {
    const id = wav.toString('ascii', off, off + 4), size = wav.readUInt32LE(off + 4);
    if (id === 'fmt ') sr = wav.readUInt32LE(off + 12);
    if (id === 'data') { data = wav.subarray(off + 8, Math.min(wav.length, off + 8 + size)); break; }
    off += 8 + size + (size & 1);
  }
  return { sr, data };
}
function envelope(wav) {   // one loudness value per 33 ms, 0..1, for the orb
  const { sr, data } = pcm16(wav), n = data.length / 2, win = Math.round(sr * 0.033), env = [];
  for (let s = 0; s < n; s += win) {
    let sum = 0, k = 0;
    for (let i = s; i < Math.min(n, s + win); i++) { const v = data.readInt16LE(i * 2) / 32768; sum += v * v; k++; }
    env.push(Math.min(1, Math.sqrt(sum / k) * 4.5));
  }
  return { env, dur: n / sr };
}
function saveClip(wav, kind) { const f = path.join(CLIPS, `${Date.now()}-${kind}.wav`); fs.writeFileSync(f, wav); return f; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Friday's spoken lines: synthesized as they stream in, "played" in order (silently, timed by their length)
let lines = [], speaking = false;
function speakLine(text) {
  text = text.replace(/[*#`_>|]+/g, '').trim();
  if (!text) return;
  const item = { text, wav: synth(text) };
  item.wav.catch(() => {});
  lines.push(item);
  if (!speaking) playQueue();
}
async function playQueue() {
  speaking = true;
  while (lines.length) {
    const it = lines[0];
    let wav; try { wav = await it.wav; } catch (e) { log('tts failed ' + e.message); lines.shift(); continue; }
    const { env, dur } = envelope(wav);
    setState('speaking');
    mark('friday', { file: saveClip(wav, 'friday'), text: it.text, dur });
    send('speak', { text: it.text, env, dur });
    await sleep(dur * 1000 + 120);
    lines.shift();
  }
  speaking = false;
  if (!pending) setState('idle');
}

// ---------- brain ----------
const SYSTEM = [
  'You are Friday, a personal AI assistant that lives in the notch of Alex Rivera\'s Mac. Alex is a freelance product designer in Toronto who also takes an evening UX course.',
  'Your knowledge of Alex comes from the notes vault in the current folder. Every user message was spoken aloud and transcribed, so go by the intent.',
  'Your reply is read aloud the moment you write it. So: 1 to 3 short spoken sentences, warm and natural, no markdown, no lists, no file paths, numbers the way they are spoken. Never use an em dash.',
  'Each message starts with a [live context] block holding the time, today\'s calendar and deadlines. If it answers the question, answer straight from it with no tools.',
  'For anything about a client, project or promise, read the matching note first (one quick Read), then answer with specifics. Offer one useful next step.',
  'When Alex mentions a new deadline, add it to deadlines.json (same format, ISO date, optional "time" as HH:MM) and confirm it in one sentence. When Alex says something on that list is finished or sent, set "done": true on it. Always write one short spoken line before your first tool call.',
].join(' ');
let claude = null, pending = 0, said = '', turnText = false;
function startClaude() {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--model', 'claude-sonnet-5-5', '--effort', 'low', '--setting-sources', 'project', '--strict-mcp-config',
    '--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Grep,Glob,Edit,Write', '--disallowedTools', 'Bash,WebSearch,WebFetch,Agent',
    '--append-system-prompt', SYSTEM];
  claude = spawn(CLAUDE, args, { cwd: VAULT, env: { ...process.env, CORTEX_HUD: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
  log('claude started ' + claude.pid);
  let rest = '';
  claude.stdout.on('data', (d) => {
    rest += d; const ls = rest.split('\n'); rest = ls.pop();
    for (const l of ls) if (l.trim()) try { onClaude(JSON.parse(l)); } catch (e) {}
  });
  claude.stderr.on('data', (d) => log('claude: ' + String(d).trim().slice(0, 200)));
  claude.on('exit', (c) => { log('claude exited ' + c); claude = null; if (pending) { pending = 0; setState('idle'); } });
}
function liveContext() {
  const t = today(), now = new Date(simNow());
  const time = now.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const cal = t.cal.map((c) => `${new Date(c.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} ${c.label}`).join('; ');
  const dl = t.deadlines.map((d) => `${d.label} (${d.days === 0 ? 'today' + (d.time ? ' at ' + d.time : '') : 'in ' + d.days + ' days'})`).join('; ');
  const w = t.weather ? `Toronto ${t.weather.temp}C, ${t.weather.desc}, high ${t.weather.high}, rain chance ${t.weather.rain}%` : '';
  return `[live context] ${time}. Calendar today: ${cal}. Deadlines: ${dl}. Weather: ${w}. [/live context]\n\n`;
}
function ask(text, shown = text) {
  if (!claude) startClaude();
  pending++; said = ''; turnText = false;
  send('you', { text: shown });
  setState('thinking');
  mark('ask', { text });
  claude.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: liveContext() + text } }) + '\n');
}
function flush(final) {
  const re = /^(.+?[.!?])(\s+|$)/s;
  let m;
  while ((m = said.match(re)) && (final || m[2])) { speakLine(m[1]); said = said.slice(m[0].length); }
  if (final && said.trim()) { speakLine(said); said = ''; }
}
function onClaude(m) {
  if (m.type === 'stream_event') {
    const e = m.event || {};
    if (e.type === 'content_block_start' && e.content_block?.type === 'text' && turnText) send('delta', { text: ' ' });   // a new text block after a tool call: keep a space between them
    if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') { turnText = true; send('delta', { text: e.delta.text }); said += e.delta.text; flush(false); }
    if (e.type === 'content_block_stop') flush(true);
    if (e.type === 'content_block_start' && e.content_block?.type === 'tool_use') mark('tool', { name: e.content_block.name });
    return;
  }
  if (m.type === 'result') {
    pending = Math.max(0, pending - 1);
    flush(true);
    if (!pending && !speaking && !lines.length) setState('idle');
    pushToday();
  }
}

// ---------- the user speaking: a real push-to-talk, fed from a synthesized line ----------
async function transcribe(pcm) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  const form = new FormData();
  form.append('file', new Blob([Buffer.concat([h, pcm])], { type: 'audio/wav' }), 'demo.wav');
  form.append('response_format', 'text');
  const t = await (await fetch(WHISPER + '/inference', { method: 'POST', body: form, signal: AbortSignal.timeout(15000) })).text();
  return t.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}
const live = require(path.join(HOME, 'Cortex/hud/live.js'));
live.setup({ transcribe, log, send, sfx: (n) => mark('sfx', { name: n }), keepAwake() {}, isAwake: () => true, wakeRe: /friday/, frameS: FRAME_S });
const to16k = (file) => new Promise((ok, fail) => execFile(FFMPEG, ['-loglevel', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 's16le', '-'],
  { encoding: 'buffer', maxBuffer: 64e6 }, (err, out) => (err ? fail(err) : ok(out))));
async function userSays(text) {
  const wav = await synth(text, 'am_michael');
  const file = saveClip(wav, 'user');
  const pcm = await to16k(file);
  const frames = [];
  for (let o = 0; o + FRAME * 2 <= pcm.length; o += FRAME * 2) frames.push(pcm.subarray(o, o + FRAME * 2));
  const sess = live.begin(true);
  notchCmd = 'open';
  send('ptt', { on: true }); setState('hearing');
  mark('user', { file, text, dur: frames.length * FRAME_S });
  const t0 = Date.now();
  for (let i = 0; i < frames.length; i++) {   // real time, like a mic
    const buf = frames.slice(0, i + 1);
    live.tick(sess, buf);
    if (i % 2 === 0) { let s = 0; for (let k = 0; k < FRAME; k++) { const v = frames[i].readInt16LE(k * 2); s += v * v; } send('lvl', { v: Math.min(1, Math.sqrt(s / FRAME) / 3000) }); }
    const wait = t0 + (i + 1) * FRAME_S * 1000 - Date.now();
    if (wait > 0) await sleep(wait);
  }
  await sleep(250);
  send('ptt', { on: false });
  live.cancel(sess);
  setState('transcribing');
  const heard = await transcribe(Buffer.concat(frames));
  log('heard: ' + heard);
  const done = await live.finish(sess, heard);
  if (done.fired.length) {
    send('you', { text: heard });
    send('live', { text: done.fired.join(' · '), all: true });
    if (!done.leftover) { setState('idle'); return { heard, fired: done.fired }; }
    ask(`(Already done on the Mac while I was talking: ${done.fired.join('; ')}. Don't redo those.) ${done.leftover}`, heard);
  } else ask(heard);
  return { heard, fired: done.fired };
}

// ---------- http ----------
const json = (res, o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/ping') return json(res, { ok: true });
  if (url === '/mini.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(fs.readFileSync(path.join(DIR, 'mini.html'))); }
  if (url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    clients.add(res); req.on('close', () => clients.delete(res));
    res.write(`data: ${JSON.stringify({ type: 'hello', state })}\n\n`);
    return res.write(`data: ${JSON.stringify({ type: 'today', today: today() })}\n\n`);
  }
  if (url === '/api/notch' && req.method === 'GET') { const c = notchCmd; notchCmd = ''; return json(res, { cmd: c }); }
  if (url === '/api/status') return json(res, { state, pending, speaking, lines: lines.length });
  if (url === '/api/timeline') return json(res, timeline);
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', async () => {
    let b = {}; try { b = JSON.parse(body || '{}'); } catch (e) {}
    if (url === '/api/ask') { ask(String(b.text || '')); return json(res, { ok: true }); }
    if (url === '/api/say') { try { return json(res, await userSays(String(b.text || ''))); } catch (e) { log('say failed ' + e.stack); return json(res, { error: e.message }); } }
    if (url === '/api/notch') { notchCmd = String(b.cmd || ''); return json(res, { ok: true }); }
    if (url === '/api/clock') { const [h, m] = String(b.at || '9:41').split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); simShift = +d - simNow(); pushToday(); return json(res, { ok: true }); }
    if (url === '/api/clear') { timeline = []; return json(res, { ok: true }); }
    if (url === '/api/reset') { fs.copyFileSync(path.join(DIR, 'deadlines.template.json'), path.join(VAULT, 'deadlines.json')); if (claude) claude.kill(); pushToday(); timeline = []; return json(res, { ok: true }); }
    if (url === '/api/warm') { if (!claude) startClaude(); return json(res, { ok: true }); }
    res.writeHead(404); res.end();
  });
}).listen(PORT, '127.0.0.1', () => log('demo server on ' + PORT));
