# JARVIS Cloud

A zero-cost-first Telegram assistant project. The existing Phase 1 morning briefing workflow is preserved. Phase 2 supports Cloudflare-hosted AI conversations, persistent cloud memory, Google Calendar commands, reminders, and an optional paid phone-call provider integration.

## Phase 1 — Morning briefing
The GitHub Actions workflow .github/workflows/jarvis-morning.yml sends the daily weather/news briefing.

## Phase 2 — Cloud AI, memory, calendar, and reminders
See cloud-phase2/README.md for setup. The Cloudflare Worker receives Telegram messages, uses Workers AI for ordinary chat, stores cloud history and saved facts in D1, and manages reminders. The Google Calendar connector uses a Google Apps Script web app. An optional phone-call feature can request outbound calls through a voice provider but is disabled by default and may incur charges.

Keep using one Telegram bot. The webhook replaces Telegram polling, so do not run the old jarvis.py polling process while the webhook is active. The existing local jarvis.py, Ollama model, and SQLite memory stay available as a backup. Local SQLite memory is not automatically copied into D1.

The active Cloudflare Worker is not changed merely by merging repository code. Deploy the updated Worker source and configure bindings/secrets in Cloudflare manually. Never commit tokens, webhook secrets, provider credentials, personal conversation contents, or reminder data to this public repository. Do not enable paid plans if the goal is to keep service at ₱0.

Workers AI and other free services have limits. Ordinary cloud chats can stop responding after the free AI allowance is exhausted. Actual cellular phone calls are not permanently free; the optional code requires an external voice provider and account charges may apply. Native Android Clock alarms require a phone-side integration; the /alarm command currently creates a Google Calendar popup alert instead.
