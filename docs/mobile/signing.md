# Signing, certificates, and push credentials

Everything here happens on your Mac with Xcode / Android Studio. None of it can
be done from Lovable.

## iOS

### 1. App identity

1. Apple Developer portal → Identifiers → new App ID `training.gradus.app`.
2. Enable capabilities: **Push Notifications**, **Associated Domains** (for
   universal links), **Sign in with Apple** only if you add it later.
3. App Store Connect → new app, bundle ID `training.gradus.app`, name `Gradus`.

### 2. Signing

Use Xcode's automatic signing first (Signing & Capabilities → your team,
"Automatically manage signing"). Switch to manual profiles only if you set up
CI later. Distribution requires an Apple Distribution certificate; Xcode will
create it on request.

### 3. APNs (push)

1. Developer portal → Keys → new key with **Apple Push Notifications service**.
2. Download the `.p8` **once** — it cannot be re-downloaded. Note the Key ID
   and your Team ID.
3. Store the `.p8`, Key ID, and Team ID in the push provider you choose
   (Firebase Cloud Messaging can relay APNs; that keeps one server-side path
   for both platforms).
4. In Xcode: Signing & Capabilities → add **Push Notifications** and
   **Background Modes → Remote notifications**.

### 4. Universal links (so emailed links open the app)

1. Add the Associated Domains capability with `applinks:gradus.training`.
2. Serve `/.well-known/apple-app-site-association` from `gradus.training` as
   `application/json`, listing team ID + `training.gradus.app` and the paths
   the app should own (`/i/*`, `/claim/*`, `/coach/*`, `/parent/*`,
   `/athlete/*`).

## Android

### 1. Keystore

```bash
keytool -genkey -v -keystore gradus-upload.jks -keyalg RSA -keysize 2048 \
  -validity 10000 -alias gradus-upload
```

Back this file and its passwords up somewhere durable (1Password). Losing it
means you can never update the listing without Google's key-reset process.

Reference it from `android/keystore.properties` (gitignored) and wire it into
`android/app/build.gradle` `signingConfigs.release`.

### 2. FCM (push)

1. Firebase console → add an Android app with package `training.gradus.app`.
2. Download `google-services.json` into `android/app/`.
3. Add the iOS app too and upload the APNs `.p8` from above, so one FCM
   server key covers both platforms.

### 3. App links

Add an intent filter for `https://gradus.training` with
`android:autoVerify="true"` and serve
`/.well-known/assetlinks.json` with the SHA-256 fingerprint of the upload key
(`keytool -list -v -keystore gradus-upload.jks`).

## Server side

Device tokens already land in the `device_tokens` table (`user_id`, `token`,
`platform`) via `registerDeviceToken`. To actually send a push, add a server
function or cron route that reads those rows and calls FCM with a service
account credential stored as a project secret. Nothing in the shell needs to
change for that.
