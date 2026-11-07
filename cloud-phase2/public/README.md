# JARVIS Voice PWA

This is the first installable voice-app MVP for the existing JARVIS Cloud Worker.

## Current features
- Responsive installable PWA for Android and Windows browsers.
- Browser microphone speech recognition (where supported).
- Browser speech synthesis with an English male-sounding voice preference (voice availability varies by device).
- Text chat fallback.
- Authenticated Cloudflare Worker chat endpoint.
- Shared recent conversation history from the existing JARVIS D1 conversation store.
- Offline cached app shell; AI conversations still require internet.

## Current limitations
- The PWA chat endpoint is conversational only. It does not yet invoke reminder, Google Calendar, Gmail, or other agent tools. Use the existing Telegram bot for those actions until the voice app tool integration is added.
- Speech recognition is browser-provided and may not be available in every browser/device. Chrome on Android and desktop is the preferred first test.
- Speech synthesis is device-provided. The app prefers English voice names commonly associated with male voices, but cannot guarantee gender or identical voice quality across devices.
- This is turn-based voice input/output, not a full-duplex live voice stream. Interrupting audio playback is supported; continuous barge-in is not yet implemented.

## Cloudflare setup
1. Add a Worker **Secret** named `JARVIS_APP_ACCESS_KEY` to Worker `jarvis-cloud-phase2`. Generate a long random value privately; do not put it in GitHub code.
2. Keep the existing Worker bindings and secrets unchanged.
3. Deploy the Worker and static assets using the existing manual deployment workflow after validation passes.
4. Enter the app access key in the app's Voice & connection settings.

The app uses same-origin `POST /app/chat` and `GET /app/history` endpoints. Both require `Authorization: Bearer <JARVIS_APP_ACCESS_KEY>`. The key is stored in the browser's local storage when the user selects Save on this device. Do not share it or put it in a screenshot.

## Install
After deployment, open the Worker URL in Chrome:
- Android: Chrome menu → **Install app** / **Add to Home screen**.
- Windows: Chrome or Edge address-bar install icon → **Install JARVIS**.

## Local validation
From `cloud-phase2`:
```bash
node --check public/app.js
node --check src/index.js
npx wrangler@4 deploy --dry-run --config wrangler.jsonc
```
