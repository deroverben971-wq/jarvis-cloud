# JARVIS Cloud

A zero-cost-first Telegram assistant project. The existing Phase 1 morning briefing workflow is preserved.

## Phase 1 — Morning briefing
The GitHub Actions workflow `.github/workflows/jarvis-morning.yml` sends the daily weather/news briefing.

## Phase 2 — Cloud reminders
Phase 2 source and step-by-step deployment instructions are in [`cloud-phase2/README.md`](cloud-phase2/README.md). It uses a Cloudflare Worker + D1 database to answer Telegram schedule/reminder commands while your PC is off, without launching GitHub Actions for each Telegram message.

**Important:** Phase 2 source has been added but is not live until you deploy the Worker, create the D1 database, configure Worker secrets/binding, add the Cron Trigger, and register the Telegram webhook. Never commit tokens, webhook secrets, or personal reminder data to this public repository. Do not enable a paid plan if you require ₱0.

Cloud provider free plans have limits and may change; see the official Cloudflare Workers and D1 pricing documentation linked in the Phase 2 guide.
