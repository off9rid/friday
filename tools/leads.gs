// Friday leads -> Google Sheet. One row per person (matched by email), updated at each step:
// details (step 1), booked (step 2, Calendly), brief (step 3, the personalization answers).
// Setup: paste into Extensions > Apps Script of a new Google Sheet, run setup() once and allow everything,
// then Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone.
// Put the web app URL in site/app.js LEADS_URL. After edits: Manage deployments > edit > New version (keeps the URL).

const COLS = ["Updated", "Status", "Name", "Email", "Plan", "Role", "Drops / wastes time on", "One thing off their plate",
  "Notes live in", "Calendar + email", "Mac", "Voice", "Timing", "Heard from", "Anything else", "Calendly event", "Agreed to terms at"];
const KEYS = { Name: "name", Email: "email", Plan: "plan", Role: "role", "Drops / wastes time on": "pains",
  "One thing off their plate": "onething", "Notes live in": "notes", "Calendar + email": "calendar", Mac: "mac",
  Voice: "voice", Timing: "timing", "Heard from": "heard", "Anything else": "extra", "Calendly event": "eventUri" };
const STATUS = { details: "1 Details only", booked: "2 Booked", brief: "3 Booked + brief" };

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const d = JSON.parse(e.postData.contents);
    const email = String(d.email || "").trim().toLowerCase();
    if (!email || !STATUS[d.type]) return out({ ok: false });
    const sh = sheet();
    const emails = sh.getRange(2, 4, Math.max(sh.getLastRow() - 1, 1), 1).getValues().map((r) => String(r[0]).toLowerCase());
    let row = emails.indexOf(email) + 2;
    const isNew = row < 2;
    if (isNew) row = sh.getLastRow() + 1;
    const cur = isNew ? COLS.map(() => "") : sh.getRange(row, 1, 1, COLS.length).getValues()[0];
    COLS.forEach((c, i) => { const k = KEYS[c]; if (k && d[k]) cur[i] = String(d[k]).slice(0, 2000); });
    cur[0] = new Date();
    // status only moves forward (a late "details" never downgrades a booked lead)
    if (!cur[1] || STATUS[d.type] > cur[1]) cur[1] = STATUS[d.type];
    if (d.type === "details" && d.agreedToTermsAndPrivacy) cur[16] = d.at || new Date().toISOString();
    sh.getRange(row, 1, 1, COLS.length).setValues([cur]);
    // a failed alert must never cost a lead, the row is already saved
    if (d.type !== "booked") try { notify(d.type, cur); } catch (err) { console.error(err); }
    return out({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// Run once from the editor: creates the Leads tab and asks for the sheet + email permissions.
function setup() {
  sheet();
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), "Friday leads are connected", "New demo leads will land in this sheet:\n" + SpreadsheetApp.getActiveSpreadsheet().getUrl());
}

function sheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName("Leads");
  if (!sh) {
    sh = ss.insertSheet("Leads", 0);
    sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight("bold");
    sh.setFrozenRows(1);
  }
  return sh;
}

function notify(type, row) {
  const me = Session.getEffectiveUser().getEmail();
  const name = row[2] || "Someone";
  const subject = type === "brief" ? `Friday brief: ${name} (${row[12] || "no timing"})` : `Friday lead: ${name} is picking a demo time`;
  const body = COLS.map((c, i) => (row[i] ? `${c}: ${row[i]}` : "")).filter(Boolean).join("\n");
  MailApp.sendEmail(me, subject, body + "\n\nSheet: " + SpreadsheetApp.getActiveSpreadsheet().getUrl());
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
