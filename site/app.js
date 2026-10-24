// Where signups go. Paste a Formspree endpoint here (https://formspree.io/f/xxxx) to receive them by email.
const FORM_ENDPOINT = "";

// Replay the hero conversation once so it feels live. Content is visible without JS.
const chat = document.getElementById("chat");
if (chat && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const items = [...chat.children];
  items.forEach((li, i) => { li.style.animationDelay = `${0.3 + i * 0.9}s`; });
  chat.classList.add("typing");
}

const t = document.getElementById("hud-time");
if (t) t.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// Plan buttons preselect the plan in the form.
document.querySelectorAll("[data-plan]").forEach((a) => {
  a.addEventListener("click", () => {
    const sel = document.getElementById("plan");
    if (sel) sel.value = a.dataset.plan === "Team" ? "Team" : a.dataset.plan;
  });
});

const form = document.getElementById("join-form");
const msg = document.getElementById("form-msg");
form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = form.name.value.trim();
  const email = form.email.value.trim();
  form.name.setAttribute("aria-invalid", String(!name));
  const okEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  form.email.setAttribute("aria-invalid", String(!okEmail));
  if (!name || !okEmail) {
    msg.className = "msg err";
    msg.textContent = !name ? "Please add your name." : "That email doesn't look right.";
    return;
  }
  const btn = form.querySelector("button");
  btn.disabled = true;
  btn.textContent = "Sending…";
  const data = { name, email, plan: form.plan.value };
  try {
    if (FORM_ENDPOINT) {
      const r = await fetch(FORM_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(data) });
      if (!r.ok) throw new Error("send failed");
    } else {
      const list = JSON.parse(localStorage.getItem("friday-signups") || "[]");
      list.push({ ...data, at: new Date().toISOString() });
      localStorage.setItem("friday-signups", JSON.stringify(list));
    }
    form.reset();
    msg.className = "msg ok";
    msg.textContent = `You're on the list, ${name.split(" ")[0]}. We'll be in touch within a day.`;
  } catch {
    msg.className = "msg err";
    msg.textContent = "Something went wrong. Please try again.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Request access";
  }
});
