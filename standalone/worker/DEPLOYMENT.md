# JARVIS Standalone Worker — Deployment Readiness

This project is deliberately NOT deployed yet. The standalone Worker is separate from the legacy Telegram Worker. Do not replace, rename, or deploy over the Telegram service.

## Safety and free-only requirements

- On the Workers Free plan, current D1 limits include up to 10 databases, 500 MB per database, 5 GB total account storage, 5 million rows read/day and 100,000 rows written/day. Free-tier daily query-limit overruns cause D1 queries to fail until the daily reset; do not upgrade or enable billing to work around a limit.

- Keep the Cloudflare account on its free plan. Do not add a paid plan, enable paid billing, or accept an upgrade prompt. Stop if Cloudflare requires payment for a step.
- The code has an application-level AI call cap and an allowlist of two model IDs, and it has no paid API fallback. Those safeguards do not control the Cloudflare account's plan or guarantee provider quota availability.
- Create the D1 database and deploy the Worker only when you have reviewed the target account and are ready to make those external changes.
- Never put REGISTRATION_INVITE_CODE in Git, wrangler.jsonc, a chat message, issue, or screenshot. Add it through the Wrangler secret prompt. Do not paste the value into ChatGPT.
- Do not reuse any Telegram token or legacy bridge secret.

## 1. Local preflight

From PowerShell, get the current feature branch and open the standalone Worker folder. If you do not already have the repository locally:

    cd $HOME
    git clone --branch feature/standalone-multi-agent-core https://github.com/deroverben971-wq/jarvis-cloud.git
    cd .\jarvis-cloud\standalone\worker

Then run:

    npm install
    npm test
    npm run deploy:check

The preflight checks the Worker name and entry point, AI binding, D1 ID, migrations, Cron, model allowlist, daily AI cap, and that the invitation code is not stored in plain variables. It does not contact Cloudflare, create resources, check remote secrets, or deploy. It is expected to report NOT READY while the D1 ID is still the placeholder.

## 2. Authenticate Wrangler

Install Node.js 22 or later, then authenticate Wrangler from this terminal:

    npx wrangler@4 login

Use the intended Cloudflare account. Before creating anything, check the Cloudflare dashboard and confirm the account is still on the free plan.

## 3. Create and bind the standalone D1 database

First check whether the separate database already exists in the selected Cloudflare account:

    npx wrangler@4 d1 list

If jarvis-standalone-db is already listed, do not create a duplicate; use that database's UUID. If it is not listed, create the standalone database in the Asia-Pacific location hint:

    npx wrangler@4 d1 create jarvis-standalone-db --location apac

This command creates a remote D1 resource. The location is a hint, not a guaranteed region. Copy the resulting database UUID into the existing database_id field in wrangler.jsonc. The DB binding already exists in this file, so do not add a second binding or let the CLI create a duplicate one. Do not replace the old Telegram Worker or its D1 bindings.

Run the local preflight again:

    npm run deploy:check

The D1 database ID check should now pass.

## 4. Apply the D1 migrations

Check the database name and ID in wrangler.jsonc one more time, then apply the standalone migrations:

    npx wrangler d1 migrations apply jarvis-standalone-db --remote

Review Wrangler's confirmation so the target is the new jarvis-standalone-db, not a legacy database.

## 5. Set the private registration invitation secret

Create a strong, unique invitation code locally. Then run:

    npx wrangler secret put REGISTRATION_INVITE_CODE

Enter the value in the Wrangler prompt. Keep it in your own password manager or other private storage. Do not put it in a source file or share it in chat. Verify only the secret name is present:

    npx wrangler secret list

Do not copy the secret value into logs or screenshots.

## 6. Final manual checks before deployment

- Confirm the Cloudflare dashboard still shows the free plan and no paid upgrade or billing was enabled.
- Confirm wrangler.jsonc points to the new standalone D1 ID.
- Confirm REGISTRATION_INVITE_CODE appears in wrangler secret list (name only).
- Run npm test and npm run deploy:check again.
- Review the target Worker name jarvis-standalone-api.

## 7. Deploy only after the checks are complete

    npx wrangler deploy

Use the URL Wrangler prints. Open the /health path and confirm ok, aiAvailable, and databaseAvailable. The app can then be connected by entering that URL on its sign-in screen or through Settings.

## Not ready for public release

The approval workflow records decisions but does not execute tools. Agent-created approval requests are not connected. Native push notifications, recurring reminders, live web research, calendar integration, device secure token storage, account recovery, and physical Android/Windows testing still need work. The APK is a debug build and is not a store release.
