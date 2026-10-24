// Demo bookings: step 1 details -> step 2 Calendly inline (prefilled) -> step 3 optional brief.
// Every step is posted to LEADS_URL, a Google Apps Script web app that writes to your Google Sheet (tools/leads.gs).
const BOOKING_URL = "https://calendly.com/amirali-zhn9/30min";
const LEADS_URL = "https://script.google.com/macros/s/AKfycbyil3bWPPMxoDDt8PjiqVYq9P1BYa2cjxMHZ-RlbQCYug9XlaCgJhaa16b-sMPBgxGx/exec";

// Shared state read by the 3D scene (scene.js).
const F = (window.FRIDAY = { amp: 0, stage: 0, x: 0, dim: 1 });
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

const LINES = {
  "intro": "Good evening. I'm Friday. I know your notes, your schedule and how you like to work, and I'm ready when you are.",
  "today": "You have a meeting at ten, your report is due at five, and a test on Thursday. I'd start the report now, while you're fresh.",
  "focus": "Done. Focus music is on, notifications are off, and I'll check in at the top of the hour.",
  "promise": "Last week you told Sarah you'd send the revised numbers by Friday. That's tomorrow. Want me to draft it?"
};

// ---------- audio: real voice clips + a synthesized wake chime, analysed for the visuals
let ctx, analyser, data, current;
const buffers = {};
function audio() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.7;
  analyser.connect(ctx.destination);
  data = new Uint8Array(analyser.frequencyBinCount);
  return ctx;
}
async function load(key) {
  if (!buffers[key]) {
    const r = await fetch(`audio/${key}.mp3`);
    buffers[key] = await ctx.decodeAudioData(await r.arrayBuffer());
  }
  return buffers[key];
}
function chime(at) {
  // Two soft rising tones and an airy shimmer: Friday waking up.
  [[523.25, 0], [783.99, 0.09]].forEach(([f, d]) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(f * 0.94, at + d);
    o.frequency.exponentialRampToValueAtTime(f, at + d + 0.12);
    g.gain.setValueAtTime(0, at + d);
    g.gain.linearRampToValueAtTime(0.16, at + d + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, at + d + 0.7);
    o.connect(g).connect(analyser);
    o.start(at + d); o.stop(at + d + 0.75);
  });
  const n = ctx.createBufferSource(), b = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate), ch = b.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length) ** 3;
  const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 6000;
  const g = ctx.createGain(); g.gain.value = 0.05;
  n.buffer = b; n.connect(hp).connect(g).connect(analyser); n.start(at);
}

const qEl = document.getElementById("q"), aEl = document.getElementById("a"), statusEl = document.getElementById("status");
let wordTimer;
async function say(key, question, btn) {
  audio();
  if (ctx.state === "suspended") await ctx.resume();
  if (current) { try { current.stop(); } catch {} }
  clearInterval(wordTimer);
  document.querySelectorAll("[data-say]").forEach((b) => { b.classList.remove("playing"); b.removeAttribute("aria-pressed"); });
  btn?.classList.add("playing");
  if (btn?.classList.contains("chip")) btn.setAttribute("aria-pressed", "true");
  if (qEl) qEl.textContent = `“${question}”`;
  if (statusEl) statusEl.textContent = "FRIDAY · THINKING";
  const buf = await load(key);
  const t0 = ctx.currentTime + 0.05;
  chime(t0);
  const src = ctx.createBufferSource();
  src.buffer = buf; src.connect(analyser);
  const start = t0 + 0.55;
  src.start(start);
  current = src;
  // Reveal the transcript word by word in time with the voice.
  if (aEl) {
    const words = LINES[key].split(" ");
    aEl.innerHTML = words.map((w) => `<span class="w">${w}</span>`).join(" ");
    const spans = aEl.querySelectorAll(".w");
    const per = (buf.duration * 1000) / words.length;
    setTimeout(() => {
      if (statusEl) statusEl.textContent = "FRIDAY · SPEAKING";
      let i = 0;
      wordTimer = setInterval(() => { spans[i++]?.classList.add("on"); if (i >= spans.length) clearInterval(wordTimer); }, per);
    }, 550);
  }
  src.onended = () => {
    if (current !== src) return;
    btn?.classList.remove("playing");
    if (statusEl) statusEl.textContent = "FRIDAY · READY";
    current = null;
  };
}
document.querySelectorAll("[data-say]").forEach((b) => b.addEventListener("click", () => say(b.dataset.say, b.dataset.q || "Who are you?", b)));

// ---------- per-frame: audio level, voice bars, scroll stage
const bars = document.getElementById("bars");
const N_BARS = 48;
if (bars) bars.innerHTML = "<i></i>".repeat(N_BARS);
const barEls = bars ? [...bars.children] : [];
const consoleEl = document.querySelector(".console");
const sections = [...document.querySelectorAll("[data-stage]")];
const lab = document.querySelector(".lab");
const nav = document.querySelector(".nav");
const wide = () => innerWidth > 900;

let stageFromScroll = function () {
  // Each section's stage applies when its middle crosses the middle of the screen; blend between neighbours.
  const mid = innerHeight / 2;
  const pts = sections.map((s) => {
    const r = s.getBoundingClientRect();
    return { y: r.top + Math.min(r.height, innerHeight) / 2, st: +s.dataset.stage, x: +(s.dataset.x || 0), dim: +(s.dataset.dim || 1) };
  });
  let a = pts[0], b = pts[pts.length - 1];
  for (let i = 0; i < pts.length - 1; i++) if (pts[i].y <= mid && pts[i + 1].y >= mid) { a = pts[i]; b = pts[i + 1]; break; }
  if (mid < pts[0].y) b = a = pts[0];
  if (mid > pts[pts.length - 1].y) a = b = pts[pts.length - 1];
  const raw = a === b ? 0 : (mid - a.y) / (b.y - a.y);
  const t = Math.min(1, Math.max(0, (raw - 0.3) / 0.4)); // hold each shape, morph in the middle of the gap
  const s = t * t * (3 - 2 * t);
  F.stage = a.st + (b.st - a.st) * s;
  F.x = wide() ? a.x + (b.x - a.x) * s : 0;
  F.dim = (a.dim + (b.dim - a.dim) * s) * (wide() ? 1 : 0.7);
}

function frame() {
  let level = 0;
  if (analyser) {
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 2; i < 60; i++) sum += data[i];
    level = sum / (58 * 255);
    barEls.forEach((el, i) => {
      const v = data[2 + Math.floor((i / N_BARS) * 70)] / 255;
      el.style.height = `${6 + v * 94}%`;
    });
  } else {
    const t = performance.now() / 1000;
    barEls.forEach((el, i) => { el.style.height = `${8 + (Math.sin(t * 2 + i * 0.4) * 0.5 + 0.5) * 10}%`; });
  }
  F.amp += (Math.min(level * 2.2, 1) - F.amp) * 0.25;
  consoleEl?.style.setProperty("--amp", F.amp.toFixed(3));
  stageFromScroll();
  if (lab) {
    const r = lab.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, -r.top / (r.height - innerHeight) * 1.6));
    lab.style.setProperty("--p", reduce ? 1 : p.toFixed(4));
  }
  nav?.classList.toggle("solid", scrollY > 40);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

const clock = document.getElementById("clock");
if (clock) clock.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// ---------- plan buttons preselect the plan
document.querySelectorAll("[data-plan]").forEach((a) => a.addEventListener("click", () => {
  const sel = document.getElementById("plan");
  if (sel) sel.value = a.dataset.plan;
}));

// ---------- booking flow
const form = document.getElementById("join-form");
const msg = document.getElementById("form-msg");
const calStep = document.getElementById("cal-step");
const brief = document.getElementById("brief-form");
const done = document.getElementById("done");
let lead = null;

function save(data) {
  if (!LEADS_URL) { console.warn("LEADS_URL not set, not saved:", data); return Promise.resolve(); }
  // text/plain + no-cors keeps it a simple request, which Apps Script accepts without a preflight
  return fetch(LEADS_URL, { method: "POST", mode: "no-cors", body: JSON.stringify({ ...data, at: new Date().toISOString() }) }).catch(() => {});
}
function step(n) {
  document.querySelectorAll(".stepbar li").forEach((li) => {
    const k = +li.dataset.step;
    li.classList.toggle("on", k === n);
    li.classList.toggle("past", k < n);
  });
  form.hidden = n !== 1;
  calStep.hidden = n !== 2;
  brief.hidden = n !== 3;
  done.hidden = n !== 4;
  const show = [form, calStep, brief, done][n - 1];
  show.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

let calLoaded;
function loadCalendly() {
  return (calLoaded ||= new Promise((ok, fail) => {
    const sc = document.createElement("script");
    sc.src = "https://assets.calendly.com/assets/external/widget.js";
    sc.async = true;
    sc.onload = ok;
    sc.onerror = fail;
    document.head.appendChild(sc);
  }));
}
async function showCalendar() {
  step(2);
  const box = document.getElementById("cal-embed");
  try {
    await loadCalendly();
    box.innerHTML = "";
    window.Calendly.initInlineWidget({
      url: `${BOOKING_URL}?hide_gdpr_banner=1&background_color=121016&text_color=f4efe4&primary_color=ffb547`,
      parentElement: box,
      prefill: { name: lead.name, email: lead.email, customAnswers: { a1: `Plan: ${lead.plan}` } },
    });
  } catch {
    box.innerHTML = `<p class="cal-loading">The calendar didn't load. <a href="${BOOKING_URL}" target="_blank" rel="noopener">Open it in a new tab</a>.</p>`;
  }
}
addEventListener("message", (e) => {
  if (e.origin !== "https://calendly.com" || e.data?.event !== "calendly.event_scheduled" || !lead) return;
  save({ type: "booked", email: lead.email, name: lead.name, eventUri: e.data.payload?.event?.uri || "" });
  step(3);
});
document.getElementById("cal-back")?.addEventListener("click", () => step(1));

form?.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = form.name.value.trim();
  const email = form.email.value.trim();
  const okEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  form.name.setAttribute("aria-invalid", String(!name));
  form.email.setAttribute("aria-invalid", String(!okEmail));
  const agreed = form.agree.checked;
  form.agree.setAttribute("aria-invalid", String(!agreed));
  if (name && okEmail && !agreed) {
    msg.className = "msg err";
    msg.textContent = "Please read and agree to the Terms and Privacy Policy to continue.";
    form.agree.focus();
    return;
  }
  if (!name || !okEmail) {
    msg.className = "msg err";
    msg.textContent = !name ? "Please add your name." : "That email doesn't look right.";
    (!name ? form.name : form.email).focus();
    return;
  }
  msg.textContent = "";
  lead = { name, email, plan: form.plan.value };
  // bots fill the hidden field; let them through the UI but don't save them
  if (!form.website.value) save({ type: "details", ...lead, agreedToTermsAndPrivacy: true });
  showCalendar();
});

brief?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(brief);
  const answers = {};
  for (const k of ["role", "onething", "calendar", "mac", "voice", "timing", "heard", "extra"]) answers[k] = (fd.get(k) || "").toString().trim();
  for (const k of ["pains", "notes"]) answers[k] = fd.getAll(k).join(", ");
  const btn = brief.querySelector("button[type=submit]");
  btn.disabled = true;
  btn.textContent = "Sending…";
  await save({ type: "brief", email: lead?.email || "", name: lead?.name || "", ...answers });
  btn.disabled = false;
  btn.textContent = "Send my answers";
  done.querySelector("p").textContent = "Thanks. Your invite is in your inbox, and your Friday will be set up around your answers before the call.";
  step(4);
});
document.getElementById("brief-skip")?.addEventListener("click", () => step(4));


// ---------- real screen recordings: play muted while on screen, "Sound on" restarts with her voice, tabs switch clips
(() => {
  const v = document.getElementById("film"), b = document.getElementById("film-sound");
  if (!v || !b) return;
  const label = b.querySelector("span"), lede = document.getElementById("film-lede");
  let seen = false;
  if (reduce) v.controls = true;
  else new IntersectionObserver(([e]) => { seen = e.isIntersecting; if (seen) v.play().catch(() => {}); else v.pause(); }, { threshold: 0.5 }).observe(v);
  b.addEventListener("click", () => {
    const on = v.muted;
    v.muted = !on;
    if (on) { v.currentTime = 0; v.play().catch(() => {}); }
    b.setAttribute("aria-pressed", String(on));
    label.textContent = on ? "Sound off" : "Sound on";
  });
  const tabs = document.querySelectorAll(".film-tabs [data-clip]");
  tabs.forEach((t) => t.addEventListener("click", () => {
    tabs.forEach((x) => x.setAttribute("aria-selected", String(x === t)));
    lede.textContent = t.dataset.lede;
    v.src = `video/friday-${t.dataset.clip}.mp4`;
    v.poster = `video/friday-${t.dataset.clip}.jpg`;
    if (!reduce) v.play().catch(() => {});
  }));
})();

// ---------- notch demo: a looping scripted animation, starts when scrolled into view
(() => {
  const mac = document.getElementById("mac");
  if (!mac) return;
  const shape = document.getElementById("nshape"), cur = document.getElementById("cursor"), key = document.getElementById("keycap");
  const nq = document.getElementById("nq"), na = document.getElementById("na"), nstat = document.getElementById("nstat"), cap = document.getElementById("ncap");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let running = false, alive = true;
  const type = async (el, text, per) => { el.textContent = ""; for (const ch of text) { if (!alive) return; el.textContent += ch; await wait(per); } };
  const setW = () => mac.style.setProperty("--mw", mac.clientWidth + "px");
  setW(); addEventListener("resize", setW);
  const still = reduce;
  async function round(question, answer, how) {
    nstat.textContent = "LISTENING"; nq.textContent = ""; na.textContent = "";
    shape.classList.add("open"); shape.classList.remove("speaking");
    await wait(700);
    await type(nq, "“" + question + "”", 38);
    nstat.textContent = "THINKING"; await wait(700);
    nstat.textContent = "SPEAKING"; shape.classList.add("speaking");
    await type(na, answer, 28);
    await wait(2600);
    shape.classList.remove("open", "speaking");
    await wait(700);
  }
  async function loop() {
    while (alive) {
      cap.textContent = "Move to the notch";
      cur.classList.remove("at-notch"); key.classList.remove("show", "down");
      await wait(900); cur.classList.add("at-notch"); await wait(1500);
      cap.textContent = "…and just talk";
      await round("What's on my plate today?", "Meeting at ten, report due at five. Start the report now.");
      cur.classList.remove("at-notch"); await wait(900);
      cap.textContent = "Or hold Option, anywhere";
      key.classList.add("show"); await wait(900); key.classList.add("down"); await wait(400);
      await round("Remind me to send the invoice Friday.", "Done. Reminder set for Friday at nine.");
      key.classList.remove("down"); await wait(500); key.classList.remove("show"); await wait(900);
    }
  }
  if (still) { cap.textContent = "Hover the notch, or hold Option"; shape.classList.add("open"); nstat.textContent = "SPEAKING"; nq.textContent = "“What's on my plate today?”"; na.textContent = "Meeting at ten, report due at five. Start the report now."; return; }
  new IntersectionObserver((es) => { if (es[0].isIntersecting && !running) { running = true; loop(); } }, { threshold: 0.4 }).observe(mac);
})();

// ---------- boot screen: a calm start-up shown once per visit; click or any key skips
(() => {
  const boot = document.getElementById("boot"), root = document.documentElement;
  if (!boot || !root.classList.contains("booting")) return;
  const lis = [...boot.querySelectorAll(".boot-log li")], bar = boot.querySelector(".boot-bar i");
  let finished = false;
  const finish = () => {
    if (finished) return; finished = true;
    try { sessionStorage.setItem("friday-booted", "1"); } catch {}
    boot.classList.add("done");
    setTimeout(() => root.classList.remove("booting"), 250);
  };
  boot.addEventListener("click", finish);
  addEventListener("keydown", finish, { once: true });
  lis.forEach((li, i) => {
    setTimeout(() => li.classList.add("on"), 700 + i * 520);
    setTimeout(() => { li.classList.add("ok"); bar.style.width = ((i + 1) / lis.length) * 100 + "%"; }, 1000 + i * 520);
  });
  setTimeout(finish, 700 + lis.length * 520 + 650);
})();

// ---------- custom cursor (mouse only): a dot that follows instantly and a ring that trails, grows on links, labels the play buttons
(() => {
  if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  const root = document.documentElement;
  const dot = Object.assign(document.createElement("div"), { id: "cur-dot" });
  const ring = Object.assign(document.createElement("div"), { id: "cur-ring" });
  dot.setAttribute("aria-hidden", "true"); ring.setAttribute("aria-hidden", "true");
  document.body.append(ring, dot);
  root.classList.add("has-cursor");
  let x = innerWidth / 2, y = innerHeight / 2, rx = x, ry = y;
  addEventListener("pointermove", (e) => { x = e.clientX; y = e.clientY; });
  (function tick() {
    rx += (x - rx) * 0.2; ry += (y - ry) * 0.2;
    dot.style.transform = `translate(${x}px, ${y}px)`;
    ring.style.transform = `translate(${rx}px, ${ry}px)`;
    requestAnimationFrame(tick);
  })();
  const LINK = "a, button, summary, label, select, .chip, [role='button']";
  addEventListener("pointerover", (e) => {
    const t = e.target.closest ? e.target : e.target.parentElement;
    const field = t.closest("input, textarea, select, iframe, .cal-embed");
    root.classList.toggle("native-cursor", !!field);
    const link = t.closest(LINK) && !field;
    const lab = t.closest("[data-say]");
    ring.classList.toggle("label", !!lab && !t.closest(".chip"));
    ring.classList.toggle("link", !!link && !(lab && !t.closest(".chip")));
    ring.textContent = lab && !t.closest(".chip") ? "Play" : "";
    root.classList.toggle("cur-link", !!link);
    root.classList.toggle("cur-label", !!lab && !t.closest(".chip"));
  });
  addEventListener("pointerdown", () => ring.classList.add("down"));
  addEventListener("pointerup", () => ring.classList.remove("down"));
  document.addEventListener("pointerleave", () => root.classList.add("native-cursor"));
  document.addEventListener("pointerenter", () => root.classList.remove("native-cursor"));
})();
