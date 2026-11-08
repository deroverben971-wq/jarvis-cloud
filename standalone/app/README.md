# JARVIS Standalone App

Shared React + TypeScript interface wrapped by Tauri 2 for Windows and Android app targets.

## Current UI and capabilities
- Invite-only sign-in and account creation.
- Backend health check and API URL settings.
- Multi-agent chat with execution status.
- Account-synced recent conversations; the latest chat resumes after sign-in.
- Task history and agent activity overview.
- Explicit memory add/list/delete.
- Approval-center placeholder that clearly reports the workflow is not connected yet.
- Push-to-talk transcription through the standalone Worker and device-native spoken replies.

The API URL can be configured in Settings or through VITE_JARVIS_API_URL. Session tokens currently use sessionStorage in this development prototype; replace this with native secure storage before public release and complete a security review.

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