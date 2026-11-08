# JARVIS Standalone — multi-agent app foundation

This standalone application track is separate from the legacy Telegram Worker and its PWA prototype. The code lives under standalone/ and is being developed on feature/standalone-multi-agent-core.

## What is built
- Cloudflare Worker API with invite-only accounts, PBKDF2 password derivation, hashed bearer sessions, and login throttling.
- D1 schema for users, sessions, conversations, messages, memories, tasks, agent runs, approvals, tool calls, scheduled jobs, usage, and notification inbox items.
- Multi-agent chat: Planner → Researcher + Analyst (parallel, max two) → Verifier.
- Explicit user memory with account-scoped retrieval, listing, and deletion.
- React + TypeScript app interface for chat, tasks, agent activity, memory, reminders, notification inbox, approvals placeholder, settings, and account-synced recent conversations.
- Tauri 2 native shell configured for Windows and Android.
- Push-to-talk speech recognition through Cloudflare Whisper, plus device-native spoken replies.
- One-time reminder creation/cancellation, one-minute Cron processing, and account-scoped inbox notifications.
- Windows x64 .exe and .msi installers built successfully by GitHub Actions.
- Android universal debug APK built successfully by GitHub Actions.

## What is not built or connected yet
- The standalone Worker has not been deployed and the D1 database has not been created. The app cannot sign in to a live JARVIS backend yet.
- Researcher is context-only; it does not perform live web search.
- Approval requests are not connected to a real tool execution layer; the Approvals screen is a placeholder.
- Reminder scheduling is one-time only. Recurring reminders, natural-language reminder parsing, and calendar integration are not implemented.
- Cron creates notification inbox entries in D1. Native phone/desktop push notifications while the app is closed are not implemented; the app refreshes its inbox while open and loads saved notifications when reopened.
- Developer and Personal Assistant tool agents remain disabled.
- Native secure storage for session tokens and full account recovery/email verification are not implemented.
- Android microphone permission configuration is included in the test build, but microphone operation still needs physical-device testing.
- These are unsigned development/test packages, not public app-store releases.

## App folders
- worker/ — Cloudflare Worker API, D1 migrations, agent workflow, Cron reminder engine, and tests.
- app/ — React/TypeScript interface and Tauri native shell.

## Free-only guardrails
- Default LLM: @cf/zai-org/glm-4.7-flash.
- Free-plan candidate allowlist: @cf/zai-org/glm-4.7-flash and @cf/google/gemma-4-26b-a4b-it; re-check model eligibility before deployment.
- App-level LLM cap: 24 model calls per UTC day across this Worker deployment.
- Speech recognition uses @cf/openai/whisper-large-v3-turbo with a hard cap of 180 recorded audio seconds per UTC day across this Worker deployment and 60 seconds per recording.
- Speech output uses voices already installed on the device; no cloud TTS service is called.
- There is no paid-provider fallback in the application. Keep the Cloudflare account on Workers Free and do not enable paid billing or upgrade.

Cloudflare currently documents a 10,000-neuron/day Workers AI free allocation, resetting at 00:00 UTC. Its pricing page lists Whisper-large-v3-turbo at 46.63 neurons per audio minute; JARVIS's 180-second daily app cap therefore stays well below that allocation on its own, although LLM calls also consume the shared allocation. Provider quotas and model eligibility can change.

Official references:
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/
- https://developers.cloudflare.com/workers/platform/limits/
- https://v2.tauri.app/start/prerequisites/
- https://v2.tauri.app/distribute/android/

## Local checks
Requires Node.js 22 or later.

```bash
cd standalone/worker
npm test

cd ../app
npm install
npm run check
npm run build
```

## Reminder API
- GET /v1/reminders — list the account's scheduled reminders.
- POST /v1/reminders — create a one-time reminder with a timezone-aware runAt timestamp.
- DELETE /v1/reminders/:id — cancel a reminder that has not yet been claimed.
- GET /v1/notifications — list the account's notification inbox.
- POST /v1/notifications/:id/read — mark an inbox item as read.

The Worker Cron trigger runs every minute. It claims due jobs in small batches, creates one notification per reminder, and marks the reminder complete. The database uses a unique scheduled-job reference to make delivery idempotent. Reminders must be 30 seconds to one year ahead. The app converts the device's local date/time to UTC before sending it to the Worker.

## Cloudflare deployment is still pending
The deployment guide is in worker/README.md. It requires creating a separate D1 database, configuring its ID in wrangler.jsonc, and setting REGISTRATION_INVITE_CODE as a secret from the user's terminal. No credential should be pasted into chat or committed.

Do not merge or deploy the feature branch until the security review, free-plan configuration, D1 migrations, and API integration tests have been completed.

## Build artifacts
The current Windows and Android test installers are produced as GitHub Actions artifacts with five-day retention. The exact successful workflow runs are linked in PR #19. Newer commits trigger rebuilds.