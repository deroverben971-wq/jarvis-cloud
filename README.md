# JARVIS Cloud

A zero-cost-first Telegram assistant project. The existing Phase 1 morning briefing workflow is preserved. Phase 2 supports Cloudflare-hosted AI conversations and reminders, with local Ollama as an optional fallback.

## Phase 1 — Morning briefing
The GitHub Actions workflow `.github/workflows/jarvis-morning.yml` sends the daily weather/news briefing.

## Phase 2 — Cloud AI, memory, and reminders
Phase 2 source and setup instructions are in [`cloud-phase2/README.md`](cloud-phase2/README.md). A Cloudflare Worker receives Telegram messages, uses Workers AI for ordinary chat, stores cloud chat history and saved facts in D1, and manages reminders while the Windows PC is off. If the cloud AI binding is missing or inference fails, ordinary messages can be queued for the local Ollama bridge when the PC is online.

Keep using one Telegram bot. The webhook replaces Telegram polling, so do not run the old `jarvis.py` polling process while the webhook is active. The existing local `jarvis.py`, Ollama model, and SQLite memory stay available as a backup. Local SQLite memory is not automatically copied into D1.

**Important:** The changes are not live until the updated Worker source is deployed, the D1 schema is updated, and a Workers AI binding named `AI` is added. Never commit tokens, webhook secrets, personal conversation contents, or reminder data to this public repository. Do not enable a paid plan if you require ₱0.

Cloudflare Workers AI currently offers a limited free daily allocation. Requests may fail after the free quota is exhausted; see the official pricing and binding documentation in the Phase 2 guide.
