# JARVIS installable voice app

The PWA is hosted separately from the existing Telegram Worker. It uses the same private JARVIS D1 conversation history, saved facts, reminders, and Calendar tools. The Telegram bot remains available.

## Cloudflare Pages setup

After the feature branch is reviewed and merged into `main`:

1. In Cloudflare, open **Workers & Pages → Create → Pages → Connect to Git**.
2. Select the `deroverben971-wq/jarvis-cloud` repository.
3. Set the production branch to `main`.
4. Set the root directory to `cloud-phase2`.
5. Set the build command to `npm run build`.
6. Set the build output directory to `dist`.
7. Add the Pages environment variable `NODE_VERSION` with value `22`.
8. Deploy the Pages project. Copy its exact production origin, for example `https://your-project.pages.dev` (do not include a trailing slash).

## Worker origin allow-list

In the existing `jarvis-cloud-phase2` Worker, add the plain-text variable `JARVIS_APP_ORIGIN` with the exact Pages origin from the previous step. Do not use a wildcard. The app's login and authenticated voice WebSocket routes reject other browser origins.

Keep all existing Worker variables and secrets. This app does not use or replace `JARVIS_BRIDGE_SECRET`, the Telegram webhook secret, Gmail credentials, or Calendar credentials.

## First-time D1 migration

Before deploying the Worker changes, open the existing `jarvis-reminders` D1 database console and execute the complete contents of:

`migrations/20261107_app_voice_sessions.sql`

Run it once. It creates only `app_pairing_codes` and `app_sessions`; it does not modify or delete existing reminders, conversation history, saved facts, or other integrations. The guarded GitHub deployment workflow checks migrations locally but does not run remote SQL.

## Worker deployment

1. Open the pull request for `feature/jarvis-installable-voice-app` and wait for the validation workflow to pass.
2. Merge the reviewed pull request into `main`.
3. Apply the D1 migration above.
4. Confirm `JARVIS_APP_ORIGIN` is saved on the Worker.
5. In GitHub Actions, manually run **Deploy JARVIS Cloud Phase 2** on `main` and enter the exact confirmation phrase requested by the workflow.
6. Confirm the run succeeds before opening the Pages app.

The Worker deployment adds the `JarvisVoiceAgent` SQLite Durable Object. The upload script preserves the existing D1, Workers AI, variables, secrets, and Cron schedule, and applies the Durable Object migration only when it is not already active.

## Pair a phone or computer

1. Open the Pages URL on the device.
2. In the existing private Telegram chat with JARVIS, send `/appcode`.
3. Enter the one-time code in the app within 10 minutes. The code works once.
4. The app receives a device session token; only its SHA-256 hash is stored in D1. The token is stored locally on that device and can be revoked by signing out.
5. Install the app from the browser's install prompt or browser menu.

Each device can be paired separately by requesting a new code. Pairing a new device replaces any still-unused code, but it does not revoke existing device sessions.

## Current behavior and boundaries

- Continuous microphone audio is sent to the authenticated voice agent while a conversation is active.
- Spoken responses are streamed back; speech interruption is supported by the voice framework.
- Typed messages are available as a fallback and use the same JARVIS voice-agent session.
- Telegram remains a fallback and shares the D1 conversation history and saved facts.
- Calendar changes still require the existing confirmation flow, currently delivered in Telegram.
- Local Ollama is not required for the app to work. It continues to serve as the local Telegram brain when its Windows bridge is online.
- The voice framework is Beta and AI usage is subject to Workers AI account limits. Do not treat the free allocation as unlimited.
- Microphone access requires HTTPS and explicit browser permission. The app does not listen when a voice call is not active.
