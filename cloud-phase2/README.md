# JARVIS Cloud — Phase 2 (Telegram reminders)

This is a **single-Telegram-bot** setup. Cloudflare receives all messages through a webhook, handles reminders even while the PC is off, and queues ordinary chat messages for `local_bridge.py` to process with local Ollama and the existing SQLite memory database when the PC is online. The bridge does not use Telegram polling, so it can share the same bot identity. Your existing `jarvis.py` is preserved, but do not run its polling process at the same time as the webhook.

## Features in this first version

- `/schedule` or “What's my schedule today?”
- `/reminders` to list future reminders
- `/remind YYYY-MM-DD HH:MM task` to create a reminder
- `/cancel ID` to cancel a pending reminder
- `/help`
- Times are interpreted as Asia/Manila (UTC+8).
- The bot only responds to the configured Telegram chat ID.
- Telegram webhook requests must contain the configured webhook secret.
- Update IDs are deduplicated.
- Ordinary chat uses your local Ollama model through `local_bridge.py`; no paid AI API is used. When your PC is off, cloud reminders work, but local Ollama replies wait until the PC/bridge is online.

## Cost and limits

Cloudflare Workers and D1 have free plans, but not unlimited service. Current published Workers Free limits include 100,000 requests/day and 10 ms CPU per invocation; D1 also has daily read/write limits. Limits and plan terms can change. This code is designed to be lightweight. Do not enable a paid plan if your requirement is strictly ₱0. If a limit is reached, requests or database operations may fail until the quota resets. See:
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/d1/

## Deploy (one-time setup)

1. Use your **existing Telegram JARVIS bot**. Do not create another bot. Save its token privately; never send it in chat or commit it to GitHub. Stop the currently running `jarvis.py` polling process before switching to webhook mode.
2. Sign in to Cloudflare and open **Workers & Pages**.
3. Create a D1 database named `jarvis-reminders`.
4. In that D1 database, open **Console** and run the SQL in `cloud-phase2/schema.sql`.
5. Create a Worker named `jarvis-cloud-phase2`. Copy the contents of `cloud-phase2/src/index.js` into its editor and deploy.
6. Open the Worker settings and add these **secrets** (do not put values in GitHub files):
   - `TELEGRAM_BOT_TOKEN`: your existing JARVIS bot token. The webhook replaces Telegram polling for that bot; local AI replies are handled by `local_bridge.py`.
   - `TELEGRAM_CHAT_ID`: your private chat ID (text)
   - `TELEGRAM_WEBHOOK_SECRET`: a newly created random value made only of letters, numbers, underscores, or hyphens, between 1 and 256 characters. Keep it private.
   - `JARVIS_BRIDGE_SECRET`: a second strong random secret, used only between your Windows bridge and Worker. Keep it private and set the same value as the `JARVIS_BRIDGE_SECRET` environment variable on Windows.
7. Add a D1 binding in Worker settings: variable name `DB`, select the `jarvis-reminders` database.
8. Add a Cron Trigger with expression `* * * * *` (every minute), then save/deploy. This checks reminders even when your PC is off.
9. Copy `cloud-phase2/register-webhook.ps1` to your Windows computer. In PowerShell, run it from its folder with:
   `powershell -ExecutionPolicy Bypass -File .\register-webhook.ps1`
   It asks for your token and webhook secret using hidden input. Do not send either value to anyone or paste them into chat. Enter the Worker URL followed by `/telegram`, for example `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/telegram`.
10. Download `cloud-phase2/local_bridge.py` into `C:\Users\noeld\JARVIS\local_bridge.py` (the same folder as `jarvis_memory.db`). Open PowerShell and run these commands, replacing the Worker URL and bridge secret with your own values. Do not paste the secret into chat:
   ```powershell
   cd C:\Users\noeld\JARVIS
   $env:JARVIS_CLOUD_URL = "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev"
   $env:JARVIS_BRIDGE_SECRET = "YOUR_SAME_JARVIS_BRIDGE_SECRET"
   $env:JARVIS_MEMORY_DB = "C:\Users\noeld\JARVIS\jarvis_memory.db"
   py .\local_bridge.py
   ```
   Keep this window open when you want local Ollama replies. The bridge uses your existing SQLite database; it does not delete it. Make sure Ollama is running.
11. Test `/help`, send a normal message to confirm local Ollama responds, then test `/remind YYYY-MM-DD HH:MM Test reminder` with a future Manila time, `/reminders`, `/schedule`, and `/cancel ID`.

## Important

- This repository's source code is public, so never commit tokens, webhook secrets, personal schedules, or reminder contents here. Actual reminder records live in D1.
- The existing morning briefing workflow is unchanged.
- Do not create or enable a paid Cloudflare plan for this project.
- This uses one bot and one chat. Do not run the old `jarvis.py` polling process while the webhook is active; run `local_bridge.py` instead. The existing `jarvis.py` file and SQLite memory remain available as a backup.
- A one-minute Cron Trigger is designed for reminders with about one-minute granularity, but cloud scheduling and network delivery are not guaranteed to arrive at the exact second.
- This version handles reminders/schedule commands only. It does not expose the full local Ollama model in the cloud.
