# JARVIS Cloud — Phase 2 (Cloud AI, memory, calendar, reminders)

JARVIS receives Telegram messages through a Cloudflare Worker and uses Workers AI for normal conversations, so the PC can be off. D1 stores cloud chat history, saved facts, reminders, and minimal optional phone-call metadata. The local Ollama setup and SQLite file remain a backup; local memory is not automatically copied to D1.

## Commands

Reminder requests are parsed before normal AI chat so a scheduling request cannot be answered as though JARVIS has no reminder tool. The free Telegram reminder is distinct from a native Android Clock alarm; delivery depends on the production Worker Cron Trigger and Telegram being configured. `/status` runs read-only checks for D1, Calendar, Gmail profile, and configuration flags without sending email or changing events.

- /help — show commands.
- /calendar — list events for the next 7 days from your Google Calendar default calendar.
- /event YYYY-MM-DD HH:MM duration title — create a Google Calendar event; duration 15–480 minutes. All times are Asia/Manila.
- /alarm YYYY-MM-DD HH:MM title — create a Google Calendar event with a popup alert 5 minutes before it. This is not a native Android Clock alarm. Google Calendar must be signed in and synced on Android, with notifications allowed.
- /deleteevent title — search matching calendar events from the past year through the next year; JARVIS displays each match and a short-lived confirmation code. No event is deleted by this command alone.
- /confirmdelete CODE — delete only the exact event saved for that code after checking the title and start time again. Codes expire after 10 minutes.
- /canceldelete CODE — cancel a pending confirmation without deleting the event.
- Food-ordering commands are intentionally disabled in this deployment. `/food` returns a disabled notice and does not create or place an order.
- /schedule — reminders due today.
- /reminders — list upcoming JARVIS reminders.
- /remind YYYY-MM-DD HH:MM task — free Telegram reminder (Manila time).
- /reminder tomorrow 8:00 am task — natural-language reminder alias; also supports “remind me tomorrow at 8 AM to ...” and “remind me in 15 minutes to ...”. JARVIS confirms only after the D1 insert succeeds.
- A daily schedule summary is sent around 7:00 AM Manila time by the Cloudflare Worker when its Cron Trigger is active; it includes outstanding reminders scheduled for that day and Calendar events for today if the Calendar bridge is connected. Delivery state is tracked once per chat/date in D1.
- `/status` — check the live Worker, D1 reminders query, Calendar read access, Gmail sender identity, and local-bridge secret configuration. It cannot prove the PC is online or inspect whether a production Cron Trigger is enabled.
- /remindcall YYYY-MM-DD HH:MM task — create a JARVIS reminder that also requests a phone call when due. Requires optional voice-provider configuration; disabled unless fully configured.
- /callme message — explicitly request an immediate spoken phone call. Disabled unless all optional voice settings are configured.
- /cancel ID — cancel an active JARVIS reminder.
- /remember fact, /memories, /forget ID, /history, /forgetme — manage cloud facts and chat history.

## Before deploying this integration update

Before deploying the daily schedule-summary change, run the SQL from `cloud-phase2/migrations/20261029_daily_schedule_briefings.sql` once in Cloudflare D1 Console against the existing `jarvis-reminders` database. The migration creates one idempotency/status table only; it does not delete or alter reminder rows. Do not deploy this code until the migration succeeds.

The calendar-delete feature adds only the `pending_calendar_deletions` D1 table and its index. After merging, run the new `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` statements at the bottom of `cloud-phase2/schema.sql` in Cloudflare D1 Console before deploying the Worker source. This preserves all existing reminders, chat history, facts, and bridge data. Keep the existing Telegram webhook and all current secret values.

## Manual Cloudflare deployment from GitHub Actions

The repository includes a manual, guarded deployment workflow at `.github/workflows/deploy-cloud-phase2.yml`. It does not deploy on pushes or pull requests. To enable it:

1. In Cloudflare, create a narrowly scoped API token for editing **only the existing** `jarvis-cloud-phase2` Worker, following Cloudflare's current token permissions guidance: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/ and https://developers.cloudflare.com/workers/authorization/.
2. In GitHub repository Settings → Secrets and variables → Actions, add repository secret `CLOUDFLARE_API_TOKEN` and repository variable `CLOUDFLARE_ACCOUNT_ID`. Never put the token in a repository file, issue, or chat message.
3. From Actions, choose **Deploy JARVIS Cloud Phase 2**, select branch `main`, and enter the exact confirmation phrase requested by the workflow. The workflow validates the code, Wrangler configuration, and schema before deployment.
4. After deployment, confirm the production Cron Trigger in the Cloudflare dashboard.

This deployment workflow preserves dashboard variables via `keep_vars: true`, and Wrangler does not delete existing encrypted Worker secrets unless explicitly instructed. It does not configure the Gmail connector automatically: after the Apps Script Web App is reviewed and deployed, configure Worker variable `GMAIL_WEBAPP_URL` and secret `GMAIL_SHARED_SECRET` in Cloudflare, ensuring the secret matches the Apps Script Script Property. Keep that secret private.

The workflow only deploys the Worker; it does not deploy Apps Script, authorize Gmail, create prospects, or send email. The Gmail Web App and Gmail authorization remain separate setup steps.

## Google Calendar connector (free)

This connector uses the Advanced Google Calendar API from Google Apps Script and an event-only OAuth scope. Google documents explicit scope configuration at:
https://developers.google.com/apps-script/concepts/scopes
https://developers.google.com/apps-script/guides/services/advanced
https://developers.google.com/apps-script/guides/web

1. Open https://script.google.com/ and create a project called JARVIS Calendar Bridge.
2. In Code.gs, replace the starter code with the complete contents of google-calendar-apps-script.js from this repository's main branch.
3. In the left sidebar, click Services + and add Calendar API (Advanced Google Service, version v3).
4. Open Project Settings and enable Show "appsscript.json" manifest file in editor. Open appsscript.json and replace its contents with the complete contents of cloud-phase2/appsscript.json from this repository's main branch. This explicitly requests https://www.googleapis.com/auth/calendar.events.owned, which permits event operations on calendars you own without requesting permission to share or permanently delete entire calendars.
5. Save both files. Set the project time zone to Asia/Manila.
6. Generate a strong random secret locally on Windows. In PowerShell, paste:

    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] 32
    $rng.GetBytes($bytes)
    $secret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
    Set-Clipboard $secret
    Write-Host "Secret generated and copied. Keep it private."

7. In Project Settings → Script properties, add or retain property JARVIS_SHARED_SECRET and paste the generated secret as its value. Never put the secret into code, GitHub, or this chat. If you already generated a secret, you may keep using that same value.
8. Choose Deploy → New deployment → Web app. Set Execute as to your account. For Who has access, select the broadest available option that permits HTTPS requests from Cloudflare without interactive Google sign-in (usually Anyone). The endpoint is protected by the random shared secret; keep the URL and secret private.
9. Review the Google permission screen carefully. After replacing both Code.gs and appsscript.json and enabling the Advanced Calendar API, consent should request event-level access to calendars you own. If it still says “See, edit, share, and permanently delete all the calendars,” cancel and check that the old CalendarApp code and broad manifest scope are gone. Do not approve the broad permission request.
10. Copy the deployed web app URL ending in /exec.
11. In Cloudflare → Workers & Pages → jarvis-cloud-phase2 → Settings → Variables and Secrets, add:
   - GOOGLE_CALENDAR_WEBAPP_URL — the deployed /exec URL.
   - GOOGLE_CALENDAR_SHARED_SECRET — the same secret used in Script properties. Store it as a Cloudflare secret.
12. Save/deploy the Worker. Keep existing DB, AI, and Telegram/bridge secrets unchanged. Update the Worker source with cloud-phase2/src/index.js after this feature branch is merged and reviewed.
13. Test /calendar in Telegram, then create a low-stakes future event with /event YYYY-MM-DD HH:MM 30 JARVIS calendar test. Check it appears on your Android Google Calendar app; delete the test event if desired.

The connector can list the next 7 days, create events, and search event titles across the past year and next year. Deletion is a two-step process: `/deleteevent title` finds matches and issues a 10-minute code; `/confirmdelete CODE` deletes only the matching event after the connector verifies its title and start time have not changed; `/canceldelete CODE` cancels it. Use explicit commands rather than natural-language deletion requests to avoid accidental calendar changes.

## Sales Intelligence — Phase 1 document intake

Sales Intelligence is being added to the existing JARVIS Telegram bot. This first phase only receives and registers product documents; it does not yet extract document text, analyze products, research companies, build scripts, or send Sales Intelligence emails.

Available commands:
- `/sales` — show the current Sales Intelligence capabilities.
- `/sales files` — list the latest received product documents.
- `/sales file ID` — inspect one document's metadata.
- `/sales status` — show document-intake status.

Send a product document in the existing Telegram chat using the attachment button's **File** option (not Photo). Accepted filename extensions are PDF, DOCX, PPTX, TXT, MD, and CSV. Telegram's current bot download ceiling is 20 MB; the intake rejects declared files over that limit. The webhook validates the extension, MIME type, identifiers, and size metadata, and deduplicates repeated uploads.

For this initial phase, D1 stores only the private Telegram `file_id`, unique file ID, file name, MIME type, size, optional caption, and status. It does not download or copy file bytes into Cloudflare, and never prints the Telegram file ID into chat. Telegram documents that file IDs can be treated as persistent and that a fresh download URL can be requested later using `getFile`. The next phase will add controlled file retrieval and text extraction. No R2 bucket or new Cloudflare binding is required for this metadata-only intake phase.

### One-time D1 migration before deploying Phase 1

The existing production database needs the additive migration `cloud-phase2/migrations/20261101_sales_documents.sql` before the new Worker code is deployed:

1. Open Cloudflare Dashboard → Workers & Pages → D1 → the existing `jarvis-reminders` database → Console.
2. Paste the complete contents of `cloud-phase2/migrations/20261101_sales_documents.sql`.
3. Execute it once. It uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`; it does not alter or delete existing JARVIS tables or rows.
4. Only after the migration succeeds, use the guarded GitHub Actions deployment workflow to publish the Worker update.

The GitHub deployment workflow validates the migration locally but deliberately does not run remote D1 schema changes. Do not deploy the new Worker code before the migration is applied. After deployment, test `/sales`, upload a small supported document, then test `/sales files` and `/sales file ID`.

**Current limitation:** a successful upload means that the file reference and metadata were saved. It does not mean the file contents have been read or analyzed. Product extraction and analysis are separate later phases. This phase does not change Gmail sending, reply monitoring, existing outreach campaigns, reminders, Calendar, or the Telegram webhook.

## Sales Intelligence — Phase 3 product-market research and permission-first email automation

Use the existing Telegram chat:

- `/sales research PRODUCT_FILE_ID | Prospect Name | https://professional-or-organization-site.example` — queue research for an individual professional, team, business, nonprofit, or other prospect against one already-analyzed product.
- `/sales research list` — list recent product-linked prospect research.
- `/sales research ID` — view a completed research report.
- `/sales script PRODUCT_FILE_ID` — generate or refresh a product sales script.
- `/sales script show PRODUCT_FILE_ID` — view the saved script.
- `/sales prospect RESEARCH_ID | email | contact name` — add one public role inbox from a research report to the active outreach campaign (unverified by default).

**Product first, market second, prospect third.** The selected analyzed product profile determines its target customer types, problem, and use case. Each prospect is assessed against that product; the report classifies the prospect as an individual professional, team, business, nonprofit, or other and provides an evidence-based fit estimate. Uploading another product changes the target-market criteria. A fit score is a research estimate, not proof of interest.

The script generator creates a beginner-friendly opening, 30-second pitch, discovery questions, value points, objection responses, a low-pressure next step, and claims to avoid. It uses only the analyzed product profile and never invents prices or customer results.

The researcher checks the supplied public HTTPS homepage and up to two same-origin Contact/About/Services/Portfolio/Profile pages. It does not run a general search engine or crawl the wider web: a prospect name and public website must be supplied. It extracts only generic role-based addresses listed on those pages; it does not collect named personal email addresses. This is a limitation for individual professionals who do not publish a role-based contact address. Every report includes the pages used as sources and distinguishes possible product fit from verified facts.

A publicly listed email address is a contact channel, **not permission to send marketing**. Publicly found addresses are stored as `public_contact_only` and cannot be sent to unless the recipient separately opts in and that evidence is recorded.

### Permission, parent/guardian review, and sending gates

- `/outreach permission ID | evidence` records the actual opt-in source (for example, a dated sign-up or a message where the recipient explicitly asked to receive product updates). Do not use a public website listing as evidence.
- `/outreach guardian-approve CAMPAIGN_ID | adult name` records campaign-level parent/guardian review.
- `/outreach guardian-review ID | adult name` records review of the exact recipient and exact email preview.
- `/outreach send ID` is blocked unless the campaign is active, the prospect has documented opt-in, the campaign has guardian approval, the exact draft has guardian review, and the address is not suppressed.
- `/outreach auto-on` only enables scheduled sends for eligible, pre-reviewed opt-in drafts. Automatic sending starts OFF.
- Scheduled follow-ups are limited, checked for replies, and stopped after a reply or opt-out. Use `/outreach auto-off`, `/outreach pause`, `/outreach stop ID`, `/outreach optout EMAIL`, or `/outreach close` to stop automation.

Guardian review commands are user-declared audit records, not identity verification. The parent/guardian must personally review the campaign and exact recipient/message and personally enter the review commands; do not enter their name on their behalf. Recipient opt-in must be genuine and separately evidenced. No broad scraped lists or unsolicited bulk email are supported.

Before deployment, apply the one-time additive migration `cloud-phase2/migrations/20261103_sales_research_permission_gates.sql` to the existing `jarvis-reminders` D1 database. The deploy workflow validates migrations but does not execute remote D1 changes. Do not run the migration twice. Product analysis, prospect research, and sales-script generation do not send email by themselves.
## Sales Intelligence — Phase 2 product document analysis

Sales Intelligence is being added to the existing JARVIS Telegram bot. Upload a product document in the existing authorized chat using Telegram's attachment button → **File** (not Photo).

Available commands:
- `/sales` — show capabilities and commands.
- `/sales files` — list the latest uploaded documents.
- `/sales file ID` — inspect status and any last processing error.
- `/sales analyze ID` — queue or retry a failed analysis (up to three attempts).
- `/sales product ID` — show the saved product analysis.
- `/sales status` — show queue totals.

Accepted intake extensions: PDF, DOCX, PPTX, XLSX, TXT, MD, and CSV. Telegram bot downloads are limited to 20 MB. PDF, DOCX, XLSX, and CSV use the Workers AI Markdown Conversion binding (up to 20 MB). TXT and MD are decoded as UTF-8 and capped at 512 KB to keep local Worker CPU use bounded. PPTX can be registered as a document, but the current converter does not list it as a supported format; export it as PDF before analysis.

A new upload is queued automatically. The existing minute Cron Trigger processes at most one product document per scheduled run. Product analysis extracts at most 60,000 characters and stores the bounded extracted text, a SHA-256 digest, and a structured profile in D1. The report distinguishes document facts, potential benefits, unsupported claims that need verification, and missing information. Document contents are untrusted data; instructions embedded in a product file are not followed.

This phase does not perform online company research, create a sales script, activate an email campaign, or send email. Product analysis never sends email. No R2 binding or new Cloudflare secret is required.

### D1 migrations required before deploying Phase 2

The existing production D1 database needs two additive migrations, in this order:

1. `cloud-phase2/migrations/20261101_sales_documents.sql` — creates the `sales_documents` table and indexes.
2. `cloud-phase2/migrations/20261102_sales_document_analysis.sql` — creates the extracted-text and product-profile storage table. It requires migration 1.

In Cloudflare Dashboard → Workers & Pages → D1 → existing `jarvis-reminders` database → Console, apply migration 1, then migration 2. The first migration uses `CREATE TABLE IF NOT EXISTS` and is safe to rerun. The second also uses `CREATE TABLE IF NOT EXISTS`. Keep a copy of the success results. These migrations do not delete or modify existing reminder, chat-history, Calendar, or Gmail rows.

The GitHub workflows validate the SQL locally but do not run remote D1 migrations. Do not deploy the new Worker code until both D1 migrations have succeeded. After deployment, test `/sales`, upload a small PDF or TXT file, check `/sales files`, and then use `/sales product ID` after the analysis notification arrives.

## Gmail outreach (approval-first, low volume)

The separate Apps Script connector in `gmail-outreach-apps-script.js` uses Gmail Advanced Service with the narrow `gmail.send` and `gmail.metadata` scopes. It sends only after `/outreach send ID`, checks reply headers only, and never forwards email bodies to Telegram. Configure Script Property `JARVIS_GMAIL_SHARED_SECRET`; set Cloudflare Worker variable `GMAIL_WEBAPP_URL` and secret `GMAIL_SHARED_SECRET`. Deploy this separate Apps Script Web App before using `/outreach start`.

Campaign setup is conversational: JARVIS asks what product/service is offered, who it helps, the truthful benefit, and the sender name. Add one appropriate business contact at a time using `/outreach add email@business.com | name | company | why relevant`; no bulk list import or scraping. Use `/outreach draft ID` to preview an AI-written message; only `/outreach send ID` sends it. One follow-up is scheduled after four days only if the campaign remains active and reply polling has succeeded. Any detected reply stops follow-ups and triggers a Telegram notification. Polling runs about every five minutes; schedules are approximate. This first version caps sending attempts at three per rolling 24 hours and 25 prospects per campaign. Use `/outreach pause`, `/outreach stop ID`, `/outreach optout EMAIL`, and `/outreach close` to stop automation. Uncertain send outcomes require manual review; no automatic resend occurs.

Before deploying with Wrangler, replace the placeholder D1 `database_id` in `cloud-phase2/wrangler.jsonc` with the existing `jarvis-reminders` database ID from the Cloudflare dashboard. Do not run a Wrangler deployment while the placeholder remains, since this configuration must bind to the existing production database rather than a new database. The config declares the existing `AI` binding, preserves dashboard-managed variables with `keep_vars: true`, and includes the minute cron trigger; still verify the production binding and Cron Trigger after deployment.

Only contact appropriate business prospects you have a legitimate reason to contact. Do not scrape or bulk-import addresses. The email asks recipients to reply "No thanks" if they don't want further follow-up, and any detected reply stops follow-ups. Review applicable privacy/marketing requirements and have a parent/guardian review the campaign and connected email account before sending. Google Apps Script quotas vary and can change; this internal cap is intentionally much lower than published quotas: https://developers.google.com/apps-script/guides/services/quotas

## Food-order preparation (disabled in current deployment)

Food-ordering code is retained in the repository for possible future review, but the active Worker command route is intentionally disabled. In this deployment, `/food` returns a disabled notice and does not access or change food drafts, connect to ordering accounts, or place an order. Do not re-enable it as part of Gmail outreach deployment without a separate explicit review.

## Actual phone calls (optional; not free to run reliably)

The optional code uses an external voice provider to request outbound calls and speak reminder text. It is disabled by default. Calls can incur provider charges, and trial accounts may have restrictions. The call feature has a maximum of 3 attempts per rolling 24 hours and a minimum 10-minute cooldown.

Current Twilio prices for Philippine mobile calls and phone numbers vary by route/account and must be checked directly before any adult-approved configuration:
https://www.twilio.com/en-us/voice/pricing/ph
https://www.twilio.com/docs/voice/api/call-resource

There is no reliable permanently free cloud service for ordinary cellular phone calls. If under 18, have a parent/guardian review and manage any phone-provider account or billing. Do not share phone numbers or provider credentials in chat or commit them to GitHub.

Call settings remain disabled until deliberately configured in Worker Settings → Variables and Secrets:
- JARVIS_CALLS_ENABLED — text variable true.
- TWILIO_ACCOUNT_SID — secret.
- TWILIO_AUTH_TOKEN — secret.
- TWILIO_FROM_NUMBER — secret, international + format.
- JARVIS_CALL_TO_NUMBER — secret, international + format.

If any setting is missing, no call is placed. /callme message requests an immediate call; /remindcall YYYY-MM-DD HH:MM task creates a regular Telegram reminder plus an optional phone-call attempt at the due time. Provider errors are reported to Telegram.

## Android alarms

/alarm creates a Google Calendar event with a 5-minute popup alert. It is not guaranteed to behave like a native Clock alarm and depends on Calendar sync, notification settings, and Android power/DND settings. Direct control of Android Clock requires a separate phone-side integration; a cloud Worker cannot directly run Android's ACTION_SET_ALARM intent. Android API reference:
https://developer.android.com/reference/android/provider/AlarmClock

## Cloud AI and free limits

Workers AI has a limited free allocation of 10,000 Neurons per day under current published terms. Usage beyond the allowance can fail on the Free plan; do not enable paid billing if your goal is ₱0. Verify current terms here:
https://developers.cloudflare.com/workers-ai/platform/pricing/

## Memory and privacy

Cloud AI stores conversation messages and saved facts in D1. /forgetme removes cloud chat history and cloud facts for the configured Telegram chat, but does not erase local C:\Users\noeld\JARVIS\jarvis_memory.db. Avoid saving passwords or other secrets as facts. Reminder tasks, conversation contents, event titles, prospect contact details, email drafts, and reply metadata are personal data; never commit them to this public repository.

Keep the existing Telegram webhook, DB binding, AI binding, and secrets. Updating Worker code does not require re-registering the webhook. The scheduled trigger * * * * * should remain enabled for reminders.
