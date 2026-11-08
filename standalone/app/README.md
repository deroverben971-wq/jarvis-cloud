# JARVIS Standalone App

Shared React + TypeScript interface wrapped by Tauri 2 for Windows and Android app targets.

## Current UI
- Invite-only sign-in and account creation.
- Backend health check and API URL settings.
- Multi-agent chat with execution status.
- Task history and agent activity overview.
- Explicit memory add/list/delete.
- Approval-center placeholder that clearly reports that the workflow is not connected yet.
- Push-to-talk transcription and device-native spoken replies.

The API URL can be configured in Settings or through VITE_JARVIS_API_URL. Session tokens are held in sessionStorage in this prototype. Before public release, replace this with a native secure-storage integration and complete a security review.

## Web UI validation
Requires Node.js 22 or later.

~~~bash
npm install
npm run check
npm run build
~~~

To preview the interface before a backend exists, leave the API URL empty and run npm run dev. Sign-in requires a configured backend.

## Windows development
Install the Rust toolchain and Microsoft C++ Build Tools, then:

~~~bash
npm install
npm run tauri:dev
~~~

Build a Windows installer on Windows:

~~~bash
npm run tauri:build
~~~

## Android development
Install Android Studio, Android SDK, NDK, Java, and the Rust Android targets required by the official Tauri 2 documentation.

~~~bash
npm install
npm run android:init
npm run android:prepare
npm run android:build
~~~

The android:prepare step adds microphone permissions required for voice capture. The Rust WebView permission handler grants microphone capture requests only; all other WebView permission requests retain Tauri's default behavior. Android must still show its operating-system permission prompt to the user.

The Android project is generated locally by Tauri. The CI workflow runs these steps before compiling a debug APK.

Official documentation:
- https://v2.tauri.app/start/create-project/
- https://v2.tauri.app/start/prerequisites/
- https://v2.tauri.app/distribute/android/
