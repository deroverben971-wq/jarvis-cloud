# JARVIS Cloud — Phase 2 (Cloud AI, memory, calendar, reminders)

JARVIS receives Telegram messages through a Cloudflare Worker and uses Workers AI for normal conversations, so the PC can be off. D1 stores cloud chat history, saved facts, reminders, and minimal optional phone-call metadata. The local Ollama setup and SQLite file remain a backup; local memory is not automatically copied to D1.

## Commands

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
- /remind YYYY-MM-DD HH:MM task — free Telegram reminder.
- /remindcall YYYY-MM-DD HH:MM task — create a JARVIS reminder that also requests a phone call when due. Requires optional voice-provider configuration; disabled unless fully configured.
- /callme message — explicitly request an immediate spoken phone call. Disabled unless all optional voice settings are configured.
- /cancel ID — cancel an active JARVIS reminder.
- /remember fact, /memories, /forget ID, /history, /forgetme — manage cloud facts and chat history.

## Before deploying this integration update

The calendar-delete feature adds only the `pending_calendar_deletions` D1 table and its index. After merging, run the new `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` statements at the bottom of `cloud-phase2/schema.sql` in Cloudflare D1 Console before deploying the Worker source. This preserves all existing reminders, chat history, facts, and bridge data. Keep the existing Telegram webhook and all current secret values.

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
