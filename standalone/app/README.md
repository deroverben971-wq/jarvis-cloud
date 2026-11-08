# JARVIS Standalone App

Shared React + TypeScript interface wrapped by Tauri 2 for Windows and Android app targets.

## Current UI and capabilities
- Invite-only sign-in and account creation.
- Backend health check and API URL settings.
- Multi-agent chat with execution status.
- Account-synced recent conversations; the latest chat resumes after sign-in.
- Task history and agent activity overview.
- Explicit memory add/list/delete.
- One-time reminder scheduling and cancellation, plus a notification inbox.
- Approval request center with create/list/approve/reject lifecycle; decisions are recorded only and never execute external actions.
- Push-to-talk transcription through the standalone Worker and device-native spoken replies.

The API URL can be configured in Settings or through VITE_JARVIS_API_URL. Session tokens currently use sessionStorage in this development prototype; replace this with native secure storage before public release and complete a security review.

## Reminders and notifications
Reminders are one-time schedules. The app converts the device's local date/time to an ISO UTC value and sends it to the Worker. Cloudflare Cron checks due jobs every minute and creates a persistent inbox entry. The app polls the inbox while open and reloads saved inbox items after sign-in. Native push notifications while the app is closed and recurring reminders are not implemented yet.

## Web UI validation
Requires Node.js 22 or later.

```bash
npm install
npm run check
npm run build
```

To preview the interface before a backend exists, leave the API URL empty and run npm run dev. Sign-in requires a configured, deployed backend and invitation code for registration.

## Windows development
Install the Rust toolchain and Microsoft C++ Build Tools, then:

```bash
npm install
npm run tauri:dev
npm run tauri:build
```

The repository's GitHub Actions workflow has successfully generated x64 NSIS .exe and MSI development installers.

## Android development
Install Android Studio, Android SDK, NDK, Java, and the Rust Android targets required by the official Tauri 2 documentation.

```bash
npm install
npm run android:init
npm run android:prepare
npm run android:build
```

The android:prepare step adds microphone permissions required for voice capture. The Rust WebView permission handler grants microphone capture requests only; other WebView permission requests retain Tauri's default behavior. Android must still show its operating-system permission prompt to the user.

The CI workflow has successfully generated a universal debug APK. It is unsigned and intended for testing, not an app-store release. Microphone and speech output behavior still need physical-device validation.

Official documentation:
- https://v2.tauri.app/start/create-project/
- https://v2.tauri.app/start/prerequisites/
- https://v2.tauri.app/distribute/android/
## Approval workflow
Authenticated clients can create and review approval requests through `/v1/approvals`. Each request includes an allowlisted action type, a short summary, a complete description, and an optional target and structured details. Approve/reject decisions are conditional on the request still being pending and are scoped to the signed-in account. This stage records the decision only: there is no external tool executor, and approval does not send email, modify calendars, deploy, or delete files. JARVIS agent-generated approval requests are a later integration step; the app form currently exists to test the lifecycle.
