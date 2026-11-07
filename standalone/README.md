# JARVIS Standalone — Backend Core

This clean standalone application track is separate from the legacy cloud-phase2 Telegram Worker and its PWA prototype.

## Included in this first build
- Cloudflare Worker API for the standalone app.
- Invite-only account registration and bearer-token sessions.
- D1 schema for accounts, conversations, messages, memories, tasks, agent runs, approvals, tool calls, scheduled jobs, and usage.
- Multi-agent workflow: Planner → Researcher + Analyst (parallel, max two) → Verifier.
- Deterministic Memory Agent for account-scoped retrieval of user-approved memories.
- Shared daily AI-call circuit breaker with no paid model fallback.
- Node.js tests for the agent registry, plan validation, and memory ranking.

The Researcher is context-only in this milestone. It does not claim to have searched the live web. Live web search, calendar integrations, code execution, notifications, voice, and native Android/Windows clients are later milestones.

## Free-only guardrails
- Default Workers AI model: @cf/zai-org/glm-4.7-flash.
- The model adapter only permits the model IDs currently listed as free-plan candidates in src/agents/engine.js. Re-check Cloudflare model and pricing documentation before deployment.
- The app defaults to 24 AI-call reservations per UTC day across this Worker deployment. This is an application circuit breaker, not a neuron estimate; model usage varies with input and output size.
- When the app cap or provider free allocation is reached, JARVIS pauses AI work. There is no paid-provider fallback.
- Keep the Cloudflare account on Workers Free. Do not enable billing or upgrade.

Official limits to re-check:
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/

## Local checks
Requires Node.js 22 or later.

~~~bash
cd standalone/worker
npm test
~~~

## Cloudflare setup (not yet performed)
1. Create a separate D1 database named jarvis-standalone-db.
2. Replace REPLACE_WITH_D1_DATABASE_ID in wrangler.jsonc with the new database ID.
3. Keep the AI binding named AI and D1 binding named DB.
4. Apply the migration with: npx wrangler d1 migrations apply jarvis-standalone-db --remote
5. Set a private invitation secret from your terminal: npx wrangler secret put REGISTRATION_INVITE_CODE. Never paste the value into chat or commit it.
6. Deploy this Worker as a new service with: npx wrangler deploy

This does not deploy or modify the old Telegram Worker. Do not point the app at production until the database, invite-only registration, and API checks have been validated.

## First API routes
- GET /health — public service and binding status.
- POST /v1/auth/register — requires the private invitation code.
- POST /v1/auth/login — returns a session token once.
- POST /v1/auth/logout — revokes the current session.
- GET /v1/me — current account.
- POST /v1/chat — multi-agent collaboration workflow.
- GET /v1/conversations and GET /v1/conversations/:id/messages.
- GET /v1/tasks — task history.
- GET /v1/memories, POST /v1/memories, DELETE /v1/memories/:id.

Private routes require Authorization: Bearer <session-token>. Passwords are salted and derived with PBKDF2; only a SHA-256 hash of each session token is stored in D1.

## Current status
Backend source scaffold and the first multi-agent chat path are on the feature/standalone-multi-agent-core branch. No Worker has been deployed, no D1 database has been created, and no installable APK or Windows installer exists yet.
