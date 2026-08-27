# Gradus in the App Store and Play Store — Capacitor shell

Goal: get Gradus into both app stores quickly, without rewriting the app. No React Native rewrite. The existing site keeps running exactly as it does today; the native app wraps it and adds the native capabilities reviewers look for.

## How it works

Capacitor produces a real iOS and Android project whose main screen is a full-bleed webview pointed at `https://gradus.training`. Because the server (SSR, server functions, Stripe, webhooks) stays where it is, every feature keeps working on day one and every future web deploy ships to the app instantly — no store resubmission for normal changes.

The risk with this approach is App Store guideline 4.2: a pure website wrapper gets rejected. So the plan includes real native functionality from the start.

## What gets built

1. **Capacitor project setup**
   - Add Capacitor plus the iOS and Android platforms to this repo.
   - App id `training.gradus.app`, app name Gradus, server URL `https://gradus.training`.
   - App icons and splash screens generated from the existing Gradus mark.
   - Safe-area handling so the app sits correctly around the notch and home indicator.

2. **Native capabilities (what makes it an app, not a bookmark)**
   - **Push notifications** — native APNs/FCM push for new messages, plan assignments, and practice reminders. Includes a device-token table, a permission prompt in settings, and hooks from the existing notification points.
   - **Camera capture** — the schedule-import photo flow uses the native camera and photo library instead of a file input.
   - **Native share sheet** — invite links and invoices share through the OS sheet.
   - **Haptics** — feedback on session start/stop and log completion.
   - **Biometric unlock** — optional Face ID / fingerprint gate on app launch.

3. **App-aware behavior in the web app**
   - A small `isNativeApp()` check so the app can hide web-only chrome (install banner, "add to home screen" prompts) and swap in native camera/share/haptics where available.
   - Auth session persists in native storage so users stay signed in between launches.
   - External links (Stripe checkout, Stripe portal, third-party pages) open in the system browser and return cleanly to the app via a deep link.

4. **Store submission**
   - Deep-link/universal-link configuration so `gradus.training` links open the app.
   - Privacy manifest and data-collection disclosures for both stores.
   - Store listing copy, screenshots, and the required privacy-policy and support URLs.

5. **Handoff docs for the work that happens on your Mac**
   - `docs/mobile/README.md` — the full local runbook: prerequisites, `npx cap sync`, opening the iOS and Android projects, running on a simulator and a real device, and the rebuild loop after web changes.
   - `docs/mobile/signing.md` — Apple Developer setup (bundle id, certificates, provisioning profiles, APNs key) and Play Console setup (keystore, service account), written as ordered steps with the exact values this project uses.
   - `docs/mobile/submission.md` — App Store Connect and Play Console checklists, privacy answers, screenshot sizes, and review notes covering the guideline 4.2 justification.
   - `CLAUDE.md` in the repo root — project context written for Claude Code: stack, where the native config lives, what's safe to edit in `ios/` and `android/`, what's generated, and the conventions to follow. Every doc above is written to be read by both you and Claude Code, so you can hand it a task like "run the iOS build and fix the signing error" and it has the context it needs.


## Sequence

- Phase 1: Capacitor setup, icons, safe areas, native storage for auth, `isNativeApp()` plumbing — app runs on a device.
- Phase 2: Push notifications end to end (this is the biggest single piece and the strongest anti-rejection signal).
- Phase 3: Camera, share sheet, haptics, biometric unlock, deep links.
- Phase 4: Store assets, privacy disclosures, submission.

## Technical notes

- Capacitor config uses `server.url` pointing at the production origin, with `server.androidScheme: "https"` and cleartext disabled.
- Push requires an Apple Developer account with an APNs key, and a Firebase project for Android FCM. A `device_tokens` table (RLS-scoped to the owning user) stores registrations; sends go through a server function alongside the existing email paths.
- Stripe checkout must not run inside the app webview — it opens in the system browser and returns through a universal link to a result route.
- The existing PWA service worker stays untouched; it does not run in the Capacitor shell.
- Building and signing the native binaries happens on your machine with Xcode and Android Studio (Lovable can't produce signed builds). Everything in this plan up to that step is done here.

## What you'll need to have ready

- Apple Developer Program membership ($99/yr) and Google Play Developer account ($25 one-time).
- A Mac with Xcode for the iOS build.
