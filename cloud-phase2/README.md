# JARVIS Cloud — Phase 2 (Telegram reminders)

This is a serverless cloud companion for the existing Windows/Ollama JARVIS. It does not modify the local bot. Telegram messages are processed by a Cloudflare Worker, reminders are stored in Cloudflare D1, and a Cron Trigger checks due reminders every minute. Routine Telegram questions do not start GitHub Actions.

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
- No AI API or paid model is used; this is a command/reminder service, not full cloud Ollama.

## Cost and limits

Cloudflare Workers and D1 have free plans, but not unlimited service. Current published Workers Free limits include 100,000 requests/day and 10 ms CPU per invocation; D1 also has daily read/write limits. Limits and plan terms can change. This code is designed to be lightweight. Do not enable a paid plan if your requirement is strictly ₱0. If a limit is reached, requests or database operations may fail until the quota resets. See:
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/d1/

## Deploy (one-time setup)

1. **Create a separate Telegram bot first** using Telegram's official `@BotFather` (`/newbot`). Give it a name such as `JARVIS Cloud Reminders`, then save its token privately. Do not share the token in chat or commit it to GitHub. Open the new bot and press **Start** so it can message you. Keep your existing Windows/Ollama JARVIS bot and its token unchanged.
2. Sign in to Cloudflare and open **Workers & Pages**.
3. Create a D1 database named `jarvis-reminders`.
4. In that D1 database, open **Console** and run the SQL in `cloud-phase2/schema.sql`.
5. Create a Worker named `jarvis-cloud-phase2`. Copy the contents of `cloud-phase2/src/index.js` into its editor and deploy.
6. Open the Worker settings and add these **secrets** (do not put values in GitHub files):
   - `TELEGRAM_BOT_TOKEN`: the token for a **separate Telegram bot dedicated to Cloud Phase 2**. Do not reuse the token for your working Windows/Ollama bot, because Telegram only supports one update delivery method (polling or webhook) per bot and setting the cloud webhook can break local polling.
   - `TELEGRAM_CHAT_ID`: your private chat ID (text)
   - `TELEGRAM_WEBHOOK_SECRET`: a newly created random value made only of letters, numbers, underscores, or hyphens, between 1 and 256 characters. Keep it private.
7. Add a D1 binding in Worker settings: variable name `DB`, select the `jarvis-reminders` database.
8. Add a Cron Trigger with expression `* * * * *` (every minute), then save/deploy. This checks reminders even when your PC is off.
9. Copy `cloud-phase2/register-webhook.ps1` to your Windows computer. In PowerShell, run it from its folder with:
   `powershell -ExecutionPolicy Bypass -File .\register-webhook.ps1`
   It asks for your token and webhook secret using hidden input. Do not send either value to anyone or paste them into chat. Enter the Worker URL followed by `/telegram`, for example `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/telegram`.
10. Test in the **new Cloud Reminders bot** with `/help`, then `/remind YYYY-MM-DD HH:MM Test reminder` using a future Manila date/time. Confirm `/reminders` lists it, and wait for the due notification.
11. Test `/schedule` or “What's my schedule today?” and `/cancel ID`.

## Important

- This repository's source code is public, so never commit tokens, webhook secrets, personal schedules, or reminder contents here. Actual reminder records live in D1.
- The existing morning briefing workflow is unchanged.
- Do not create or enable a paid Cloudflare plan for this project.
- Telegram bots can only reply after you start them. Keep the Cloud Phase 2 bot separate from the existing local bot: do not register a webhook on the local bot's token.
- A one-minute Cron Trigger is designed for reminders with about one-minute granularity, but cloud scheduling and network delivery are not guaranteed to arrive at the exact second.
- This version handles reminders/schedule commands only. It does not expose the full local Ollama model in the cloud.
