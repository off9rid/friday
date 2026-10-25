# Friday

**A done-for-you personal AI assistant for your Mac.** Friday briefs you on your day, tracks deadlines, remembers what matters and runs your apps by voice. This repo is the marketing site, live at **[meetfriday.vercel.app](https://meetfriday.vercel.app)**, plus the tooling that films its demos.

## What's here

- `site/`: the landing page. Plain HTML/CSS/JS with a three.js scene, demo videos, and a 3-step booking flow (details, Calendly, a short brief) that writes each lead to a Google Sheet.
- `tools/leads.gs`: the Google Apps Script web app behind that Sheet.
- `demo/`: scripted, screen-recorded Friday demo clips: a sample vault, a take runner, TTS and an assembler.
- `brand/`: logo and mark.

## Run the site locally

```bash
python3 -m http.server -d site 8000   # then open http://localhost:8000
```

Deploy: `vercel deploy --prod` from `site/`.

Built by [@off9rid](https://github.com/off9rid).
