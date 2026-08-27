# Gradus mobile (Capacitor shell)

Gradus ships to the App Store and Play Store as a **Capacitor shell** around
the hosted web app at `https://gradus.training`. There is no second codebase:
the native projects are thin containers, all product code stays in this
TypeScript/React repo and continues to be deployed the way it is today.

- App ID (bundle identifier / applicationId): `training.gradus.app`
- App name: `Gradus`
- Hosted URL: `https://gradus.training`
- Config: `capacitor.config.ts`
- Offline fallback page: `native/fallback/index.html`

## What lives where

| Concern | Where |
| --- | --- |
| UI, routing, server functions, Stripe, database | this repo, deployed as today |
| Native detection & helpers | `src/lib/native.ts` |
| Push registration (device side) | `src/lib/native-push.ts` |
| Push token storage (server side) | `src/lib/push.functions.ts`, table `device_tokens` |
| Biometric unlock | `src/lib/native-biometric.ts`, `src/components/native/biometric-gate.tsx` |
| Device settings UI | `src/components/settings/native-app-section.tsx` |
| iOS/Android projects | `ios/`, `android/` — generated on your Mac, not in Lovable |

Anything gated on `isNativeApp()` is inert on the web, so the browser
experience is unchanged.

## One-time setup on your Mac

Prerequisites: Xcode (latest), Xcode command line tools, CocoaPods, Android
Studio + JDK 17, Bun (or npm), and an Apple Developer + Google Play developer
account.

```bash
git clone <repo> && cd gradus
bun install

# Generate the native projects (only needed once; they are gitignored-by-choice
# or committed, see below)
bunx cap add ios
bunx cap add android

# Copy web config + plugins into the native projects
bunx cap sync
```

`native/fallback` is the configured `webDir`. It only holds the offline page —
the app loads the hosted site, so there is no web bundle to build for the
shell.

## Day-to-day loop

You almost never need to rebuild the native app when you ship product changes:
they go live the moment the web app deploys. Rebuild and resubmit only when:

- a Capacitor plugin is added, removed, or upgraded
- `capacitor.config.ts` changes
- app icons, splash screen, permissions, or store metadata change
- Apple/Google require a new SDK target

```bash
bunx cap sync          # after any dependency/config change
bunx cap open ios      # opens Xcode
bunx cap open android  # opens Android Studio
```

## Icons and splash screens

Place a 1024×1024 `icon.png` and a 2732×2732 `splash.png` under
`assets/` and run:

```bash
bunx @capacitor/assets generate --iconBackgroundColor '#F5F6FA' --splashBackgroundColor '#F5F6FA'
```

## Committing native projects

Recommended: commit `ios/` and `android/` so signing config, entitlements, and
Gradle tweaks are reviewable. They are generated files but they accumulate
hand edits (push entitlements, URL schemes, Firebase config), and regenerating
loses those.

## Next docs

- `signing.md` — certificates, provisioning profiles, keystores, APNs/FCM
- `submission.md` — store listings, review notes, release process
