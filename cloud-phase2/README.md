# JARVIS Cloud — Phase 2 (Cloud AI, memory, calendar, reminders)

JARVIS receives messages through a Cloudflare Worker and uses Workers AI for normal conversations, so the PC can be off. D1 stores cloud chat history, saved facts, reminders, and minimal phone-call request metadata. The local Ollama setup and SQLite file remain a backup; local memory is not automatically copied to D1.

## Commands

- /help — show commands.
- /calendar — list events for the next 7 days from your Google Calendar default calendar.
- /event YYYY-MM-DD HH:MM duration title — create a Google Calendar event; duration 15–480 minutes. All times are Asia/Manila.
- /alarm YYYY-MM-DD HH:MM title — create a Google Calendar event with a popup alert 5 minutes before it. This is not a native Android Clock alarm. Google Calendar must be installed/signed in on Android, event sync enabled, and notifications allowed.
- /schedule — reminders due today.
- /reminders — list upcoming JARVIS reminders.
- /remind YYYY-MM-DD HH:MM task — free Telegram reminder.
- /remindcall YYYY-MM-DD HH:MM task — create a JARVIS reminder that also requests an actual phone call when due. Requires optional voice provider configuration; it is disabled unless that configuration is complete.
- /callme message — explicitly request an immediate spoken phone call. Disabled unless all optional voice settings are configured.
- /cancel ID — cancel an active JARVIS reminder.
- /remember fact, /memories, /forget ID, /history, /forgetme — manage cloud facts and chat history.

## Configure Google Calendar (free)

This connector uses Google Apps Script's Calendar service. The user authorizes the script to access their default Google Calendar. Apps Script deployment and CalendarApp are documented by Google:
https://developers.google.com/apps-script/guides/web
https://developers.google.com/apps-script/reference/calendar/calendar-app

1. Open https://script.google.com/ and create a new project called JARVIS Calendar Bridge.
2. Replace the default code in Code.gs with the complete contents of google-calendar-apps-script.js from this repository's main branch.
3. In the Apps Script project settings, set the time zone to Asia/Manila.
4. Generate a strong random secret locally on Windows. In PowerShell, paste:
   
       $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
       $bytes = New-Object byte[] 32
       $rng.GetBytes($bytes)
       $secret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
       Set-Clipboard $secret
       Write-Host "Secret generated and copied. Keep it private."

5. In Project Settings → Script properties, add property JARVIS_SHARED_SECRET and paste the generated secret as its value. Do not put the secret into code or GitHub.
6. Choose Deploy → New deployment → Web app. Set Execute as to your account. For Who has access, select the broadest available option that permits unauthenticated HTTPS requests to the web app (usually Anyone). The endpoint is protected by the random shared secret; keep the URL and secret private. Click Deploy and approve the Google Calendar permission prompt.
7. Copy the deployed web app URL ending in /exec.
8. In Cloudflare → Workers & Pages → jarvis-cloud-phase2 → Settings → Variables and Secrets, add:
   - GOOGLE_CALENDAR_WEBAPP_URL — the deployed /exec URL.
   - GOOGLE_CALENDAR_SHARED_SECRET — the same secret used in Script properties. Store it as a secret, not a GitHub file.
9. Save/deploy the Worker. Do not remove existing DB, AI, or Telegram/bridge secrets.
10. Test in Telegram with /calendar, then create a low-stakes future test event such as /event 2026-10-27 15:00 30 JARVIS calendar test. Check that it appears in the Google Calendar app on your Android phone and delete it afterward if desired.

The bridge supports listing the next 7 days and creating events in the default Google Calendar. It does not yet parse arbitrary natural-language requests into events; use the explicit /event command to avoid accidental calendar writes.

## Actual phone calls (optional; not free to run reliably)

The optional code uses Twilio Programmable Voice to request an outbound call and speak the reminder text. A call uses the configured destination number and a Twilio number or verified outgoing caller ID. The code is disabled by default and has a rolling safety cap of 3 calls per 24 hours and at least 10 minutes between calls.

Current Twilio pricing for calls to Philippine mobile numbers is listed at about US$0.2938/minute, and a rented Philippines local number is listed at US$15/month; actual charges depend on account, route, taxes, and provider terms. Check the current price before enabling:
https://www.twilio.com/en-us/voice/pricing/ph
https://www.twilio.com/docs/voice/api/call-resource

Trial accounts may have restrictions, and caller ID must be valid/verified. There is no reliable, permanently free way for a cloud app to place normal cellular calls. If under 18, do not sign up for or add billing to a telephony service yourself; have a parent/guardian review and manage any account or charges. Do not share any phone number or provider credentials in chat or commit them to GitHub.

Only configure these in Cloudflare Worker Settings → Variables and Secrets after an adult-approved account is ready:
- JARVIS_CALLS_ENABLED — text variable true (only enable after reading charges and testing).
- TWILIO_ACCOUNT_SID — secret.
- TWILIO_AUTH_TOKEN — secret.
- TWILIO_FROM_NUMBER — secret; a Twilio number or verified outbound caller ID in international + format.
- JARVIS_CALL_TO_NUMBER — secret; your target mobile in international + format.

If any setting is missing, no call is placed. /callme Hello JARVIS requests an immediate call. /remindcall YYYY-MM-DD HH:MM task sends the regular Telegram reminder and attempts one phone call when due. Requests are logged without saving the phone number or spoken content; max 3 attempts per rolling 24 hours and at least 10 minutes between attempts. Provider failures are reported to Telegram.

## Android alarms

/alarm creates a Google Calendar event with a 5-minute popup notification. It depends on the Google Calendar app being signed in, synced, and allowed to notify; it is not guaranteed to sound like a native Clock alarm and may respect Android's notification/DND settings. To set alarms directly in the Android Clock app, a separate phone-side companion/automation integration is required; a cloud Worker cannot directly execute Android's ACTION_SET_ALARM intent. See Android's official API docs:
https://developer.android.com/reference/android/provider/AlarmClock

## Cloud AI and free limits

Workers AI has a limited free allocation of 10,000 Neurons per day. Usage beyond the allowance can fail on the Free plan; don't enable paid Workers or AI billing if your requirement is ₱0. Check https://developers.cloudflare.com/workers-ai/platform/pricing/ for current terms.

## Memory and privacy

Cloud AI stores conversation messages and saved facts in D1. /forgetme removes cloud chat history and cloud facts for the configured Telegram chat, but does not erase local C:\Users\noeld\JARVIS\jarvis_memory.db. Do not save passwords or other secrets as memory facts. Reminder tasks, cloud chat content, and personal event titles are private user data; never commit them to this public repository.

Keep the existing Telegram webhook and the existing Worker DB/AI bindings. Updating Worker source does not require re-registering the Telegram webhook. The scheduled trigger * * * * * should remain enabled for reminders.
