# JARVIS Cloud — Phase 2 (Cloud AI, reminders, and memory)

This is a **single-Telegram-bot** setup. Telegram delivers messages to a Cloudflare Worker. With a Workers AI binding named `AI`, ordinary conversations run on Cloudflare so they can work while the Windows PC is off. Cloudflare D1 stores cloud conversation history and saved facts. Reminders are managed by the same Worker.

Your local `jarvis.py`, `local_bridge.py`, Ollama model, and SQLite file remain available as a backup/fallback. Do not run the old `jarvis.py` Telegram polling process while the webhook is active.

## Features

- Cloud AI chat using Workers AI model `@cf/zai-org/glm-4.7-flash` when the `AI` binding is enabled.
- Cloud conversation history stored in D1; `/history` shows recent messages.
- Saved cloud facts: `/remember fact`, `/memories`, and `/forget ID`.
- `/forgetme` erases cloud conversation history and cloud facts for the configured chat. It does **not** erase the separate local SQLite database on Windows.
- `/schedule` and “What's my schedule today?”
- `/reminders`, `/remind YYYY-MM-DD HH:MM task`, and `/cancel ID`.
- Reminder times use Asia/Manila (UTC+8).
- The Worker only responds to the configured Telegram chat ID; webhook requests are protected by the Telegram webhook secret.
- If the Workers AI binding is missing, normal chat is queued for the local Ollama bridge. If a cloud inference request fails, the message is queued for the local bridge as a fallback.

## Cost and limits

Workers AI has a free allocation of **10,000 Neurons per day**. If the free allowance is exhausted, inference requests fail until the daily reset unless you choose a paid plan. Do not enable a paid plan if you require ₱0. Workers, D1, and AI have usage limits that can change. Check current official documentation:
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/workers-ai/configuration/bindings/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/

## Deploy the cloud AI update to your existing setup

1. **Update the D1 schema.** Open Cloudflare Dashboard → Workers & Pages → D1 database `jarvis-reminders` → Console. Run the complete contents of `cloud-phase2/schema.sql`. These statements use `IF NOT EXISTS`, so the existing reminder and bridge tables are preserved while the two cloud-memory tables are added.
2. **Update the Worker source.** Open Worker `jarvis-cloud-phase2` → Edit Code. Replace the Worker source with the contents of `cloud-phase2/src/index.js` from this repository branch after reviewing/merging the pull request, then save/deploy.
3. **Add the Workers AI binding.** On the Worker's Settings/Bindings page, choose Add binding → Workers AI. Set the variable name to exactly `AI`. Save and deploy the Worker. The code uses `env.AI`.
4. **Keep existing bindings and secrets.** Do not delete or rename D1 binding `DB` or the existing `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`, or `JARVIS_BRIDGE_SECRET`. This code requires the same existing names and values.
5. **Keep the existing Telegram webhook.** You do not need to register it again just to update Worker code or add the AI binding.
6. **Test from Telegram.** Send `/help`, then a normal message such as “JARVIS, introduce yourself.” Try `/remember I prefer concise answers`, then `/memories`, then `/history`. Test reminders with a future Manila time.
7. **PC-off test.** After the cloud AI binding and code are deployed and normal messages receive cloud AI answers, you can stop the local bridge and shut down the PC for a test. Cloud AI chats and reminders should continue. Local Ollama is no longer needed for normal replies when Workers AI is active.
8. **Optional local fallback.** If Cloudflare AI is missing or temporarily unavailable, the Worker queues a fallback job for `local_bridge.py`. The bridge can only process that job while the PC, Ollama, and bridge are online.

## Cloud memory versus the old local memory

Cloud memory starts separately. Existing facts and messages in `C:\Users\noeld\JARVIS\jarvis_memory.db` are **not automatically uploaded** to D1. Your local database is left untouched as a backup. Re-save any facts you want available to the cloud assistant with `/remember fact`. Do not upload your database to this public repository.

## Security and reliability notes

- Never commit Telegram tokens, webhook secrets, bridge secrets, conversation contents, or personal reminder data to GitHub.
- Keep the existing morning-briefing workflow unchanged.
- The webhook checks Telegram's configured secret and only acts on the configured chat ID.
- D1 stores cloud chat history and saved facts until they are deleted with `/forgetme` or an individual fact is removed with `/forget ID`. Avoid saving passwords or other secrets as facts.
- The one-minute Cron Trigger checks due reminders about once per minute; exact delivery time cannot be guaranteed.
