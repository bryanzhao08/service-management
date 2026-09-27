# Transient on iPhone and Android

Current checkout status: both native projects are generated, and
`mobile/artifacts/Transient-Android-setup.apk` is compiled and its signature
verified. It is configured to open the bundled setup screen because no working backend origin
has been configured. The Vercel project and local signing/authentication
secrets are prepared, but deployment awaits the existing PostgreSQL and
S3-compatible storage settings in `.env.local`. No database was provisioned
or migrated. Full Xcode is absent, so the iPhone binary has not been built.

Validation passed: 230 unit tests, ESLint, TypeScript, and the final production
web build. The build used a placeholder PostgreSQL URL to verify compilation;
it did not test a database connection. The Android APK installed on an emulator,
but the emulator launch check did not succeed, so device workflow testing is
still pending. All changed files pass formatting; the repository-wide format
check reports three existing unrelated files (`src/lib/reports/theme.ts`,
`tests/unit/report-line-boxes.test.ts`, and `tests/unit/runtime-timezone.test.ts`).

The repository now contains Capacitor 8 native projects in `ios/` and
`android/`. They reuse the hosted Next.js interface, database, reports, and
offline write queue. These are **device-testing builds**, not App Store or
Google Play releases. Capacitor's `server.url` mode is intended for testing
and live reload. A store release needs a bundled mobile frontend and API
integration, or a separately reviewed native architecture.

## Connect the apps to the backend

Use the HTTPS origin of a working Transient deployment:

```sh
export MOBILE_APP_URL="https://your-project.vercel.app"
pnpm mobile:sync
```

This copies the bundled connection-error screen, updates both native
configurations, and updates iOS app-bound domains. Run it whenever the URL
changes. Without the variable, the app opens a setup screen and cannot sign in.
The variable is exported in your shell; `.env.local` alone does not configure
Capacitor.

For an Android emulator connected to a development server:

```sh
MOBILE_APP_URL=http://10.0.2.2:3000 MOBILE_ALLOW_HTTP=1 pnpm mobile:sync
```

Physical devices need the computer's reachable LAN address. The backend's
`AUTH_URL` and `NEXT_PUBLIC_APP_URL` must match the address used for testing.
Plain HTTP needs extra iOS transport configuration; use HTTPS for iPhone
testing.

## Android

Install JDK 21 and Android SDK 36. Set `JAVA_HOME` and configure the SDK path
in the ignored `android/local.properties`, or use Android Studio.

```sh
pnpm mobile:apk
# Output: android/app/build/outputs/apk/debug/app-debug.apk
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

The debug APK is installable for testing, signed with the development key,
and unsuitable for Play Store distribution. Its application ID is
`com.transientapp.guard`.

## iPhone

Install full Xcode 26 or newer (Command Line Tools alone cannot build an iOS
app). Then:

```sh
pnpm mobile:sync
pnpm mobile:ios
```

Open `ios/App/App.xcodeproj`. Choose the App target, select your Apple signing
team under Signing & Capabilities, connect an iPhone, select it as the run
destination, and run. Enable Developer Mode on the device when Xcode requests
it. A personal Apple account supports limited on-device development; TestFlight
requires Apple Developer Program enrollment and App Store Connect setup.

## Sign-in and device checks

Set `MOBILE_EMAIL_LINKS=1` on the backend to add an “Open in the iPhone / Android
app” link to sign-in emails. It opens the installed app and redeems the same
one-time Auth.js token inside its WebView; the normal browser sign-in button
remains available. Incoming callbacks must match the configured backend origin
and Auth.js callback path. Test this handoff with your email client; universal
links are not configured. Email + PIN is another option for existing accounts
when `PIN_SIGN_IN_ENABLED=1`. The sample seed does not assign PINs.

Check each device with an existing test account:

1. Sign in, clock in, and open the shift timeline while connected.
2. Take/select a photo, verify upload, and check the derived thumbnail.
3. Disconnect, add a note on the already-open timeline, reconnect, and verify
   it syncs exactly once.
4. Background and resume the app; verify pending entries sync when connected.
5. End the shift, verify PDF generation, and verify email delivery with the
   configured email provider.
6. Test Android back navigation, the keyboard, safe areas, external links,
   denied camera/microphone permissions, and a cold launch without network.

The write queue uses IndexedDB and flushes in the foreground. Native push
notifications, native dictation, and guaranteed offline cold launch are not
implemented; web push is generally unavailable in embedded WebViews. Existing
browser dictation remains dependent on WebView support. The bundled error
screen lets users reconnect and does not delete queued entries. iOS app-bound
domains are configured to support the trusted backend's service worker, but
offline behavior still needs physical-device verification.

## Deployment requirements

The configured Vercel project is `hiihih/transient`. Vercel login is established
on this computer. Git deployment needs a separate GitHub login connection;
direct CLI deployments work independently.

The backend needs an existing PostgreSQL database, Auth.js and link-signing
secrets, the HTTPS application origin, and persistent S3-compatible storage.
Set storage credentials before building so the Content Security Policy
includes the storage origin. A serverless deployment cannot use the local
filesystem storage driver for real uploads. Configure Resend for real email.
The current once-a-minute cron requires Vercel Pro or an external scheduler;
Hobby permits only daily cron jobs. Do not silently downgrade the queue
schedule for a production deployment.

For this Hobby **test deployment**, `vercel.testing.json` explicitly uses a
daily retry sweep. Normal processing still starts immediately through
Next.js `after()`, but failed jobs can wait until the daily sweep. Deploy this
test configuration with `npx vercel --local-config vercel.testing.json --prod`.
Production must retain the minute schedule or use an external scheduler.

Put existing credentials in the ignored `.env.local`, pull/push the appropriate
Vercel environment, apply migrations with the direct database connection, and
deploy before building connected native packages. Never put database or S3
credentials in Capacitor configuration or native assets.
