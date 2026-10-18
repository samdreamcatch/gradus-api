# Handoff: Android foundation (SA1 and K1)

**For:** a fresh Claude Code session that will start the native Android app.
**Written:** 2026-10-14, at the end of the session that wrote and settled `docs/android/PRD.md`.
**The spec is `docs/android/PRD.md` on `main`.** This document is the current state and the starting orders. Do not re-derive anything the PRD already decides.

**Read first, in this repo:**
1. `docs/android/PRD.md` §0 (decision log; Table 1 is Android, Table 2 maps every iOS decision #1–#54), §4 (constraints, especially **§4.3 parity rules**), §5.2 (toolchain), §6.1–§6.6 (backend, API, auth, offline, push), §9 (engineering standards), §10.2 (milestones), Appendix A (endpoints and server additions), Appendix F (work packages) and Appendix G (iOS → Android mapping).
2. `docs/android/PRD.md` §8 (design system) **after** checking §1 below.
3. The reference implementation: `mariah-gill/gradus-ios` on `main`. When the PRD and the iOS code disagree, the iOS code at HEAD wins unless an Android decision (A-number) says otherwise.

---

## 1. Before you start: prerequisites

Development is **local, on Mariah's MacBook Pro** (Mariah, 2026-10-14). Cloud sessions are not used for Android because the cloud environment cannot reach `dl.google.com`, where the Android SDK and Google's Maven artifacts download from.

| # | Prerequisite | Who | Status on 2026-10-14 | What it blocks |
|---|---|---|---|---|
| P1 | Private repo **`mariah-gill/gradus-android`**, with the Claude GitHub app given access | Mariah | **Done** (2026-10-14) | — |
| P2 | **Updated design system ("Show, don't tell").** Decisions in `docs/design/show-dont-tell-handoff.md`, visuals in its canvas (https://claude.ai/artifact/6bUwfU8oiUGMP6HhrPrLuQ), already built on iOS (gradus-ios #136 and follow-ups); folded into PRD §8 (A61–A70) by PR #245 | Mariah, then a docs PR | **Done** (2026-10-17), once PR #245 is merged | — |
| P3 | **The Mac toolchain:** PRD §5.2 steps 1–10. Android Studio (stable), its bundled JDK, the SDK platforms and system images, the `~/.zshrc` exports, the Homebrew extras, the named emulators, and the Pixel in developer mode | Mariah for the Android Studio install and the Pixel's settings; the session can run the terminal steps with her go-ahead | **Not done** | Building, running and testing anything in `gradus-android` |
| P4 | Both repos cloned on the Mac, for example `~/Developer/gradus` (this repo) and `~/Developer/gradus-android`, plus `gradus-ios` for reference | The session, with `gh` | Not done | Everything |

**Design source of truth:** PRD §8 (especially §8.6, the "Show, don't tell" principles and pen layer), then the handoff doc and its canvas. Where they differ, the merged iOS code at `c8f83d6` wins: for example, the practice line replaced the canvas's "Mirror" chart. Build the design-system package in K1 1.1 in the handoff's order: tokens and surfaces, then shared components, then the button pass.

Device and account steps beyond the toolchain (PRD §10.2, Mariah's G1 and G2: Google Cloud, Firebase, the Play Console) are **not** needed to start. Emulators and the local API cover K1. They become needed for Google sign-in (SA3), push (SA2), App Links verification (SA5), Play Integrity (SA6) and the internal testing track.

---

## 2. How to start the session (on the Mac)

1. In a terminal on the Mac, `cd ~/Developer` (create it if needed) and start Claude Code there, so all three repos sit side by side.
2. First message:

> Read `docs/android/handoff-K1.md` and `docs/android/PRD.md` in `mariah-gill/gradus-coach-start` (clone the repos you need under ~/Developer first). Walk me through the PRD §5.2 toolchain steps I haven't done, then carry out SA1 in gradus-coach-start and K1 in mariah-gill/gradus-android.

3. The session checks the toolchain first (`java -version`, `adb version`, `sdkmanager --list_installed`, `emulator -list-avds`) and lists any §5.2 step still missing. Android Studio itself, the SDK Manager choices and the Pixel's Developer options are Mariah's clicks; the session can do the shell steps after asking.

The session works in two repos: `gradus-coach-start` (server additions, the PRD, the contract) and `gradus-android` (the app). `gradus-ios` is read-only reference.

---

## 3. Scope: SA1 first, then K1

### SA1: server plumbing (this repo; small, independent of Android tooling)

PRD §5.1 and Appendix A rows S-1, S-2, S-4, S-12, S-14:
- **S-1:** `GET /meta/client-policy` gains optional `minSupportedVersion.android` and `wearos` (default `"0.0.0"`; the `ios` key unchanged).
- **S-2:** `POST /analytics/events` accepts `platform: "android"` (and `"wearos"`).
- **S-4:** `POST /errors` takes the platform from `X-Gradus-Client` instead of the literal `"ios"`; Android rows labeled in the admin errors dashboard and the error digest.
- **S-12:** `POST /feedback` path `android/settings` listed for admin filters.
- **S-14:** contract comments name gradus-android as a consumer.
- Regenerate `docs/api/openapi.json`.

Done when merged and published (Mariah publishes in Lovable), and an `android/1.0.0+1` error report shows as Android. Follow PRD §4.1 (web zero-disruption) and §9.4. Run `bun run lint` before finishing.

### K1: repo and foundation (`gradus-android`; Appendix F packages 1.1–1.6)

| Pkg | Deliverable |
|---|---|
| 1.1 | Create the project; Gradle modules per §9.1 (one per iOS package: `:core:api`, `:core:data`, `:core:design`, `:feature:*`, `:wear`, `:widgets`); version catalog; convention plugins; `Contract/` with the sync script and CI drift check; generated API client; generated tokens; bundled fonts; theme and the §8.6 design-system components. |
| 1.2 | API client wiring: interceptors (`Authorization`, `X-Gradus-Client`, `Idempotency-Key`), transport errors to `ApiError.Offline`, client policy and force update, error mapping, lenient decoding. |
| 1.3 | Auth: email or username + password; Google (Credential Manager) and Apple (web flow) built but **hidden** until SA3 / SA4 are live; Keystore/Tink session storage; BiometricPrompt lock; terms sheet. |
| 1.4 | Room outbox, snapshot caches, repositories, sync engine, connectivity, WorkManager drain, per-screen "{n} to sync" chips (no Sync Center, §6.5). |
| 1.5 | App shell: role tabs, `AppRoute`, App Links and `gradus://`, FCM registration (stubbed until G1/SA2), notification routing, error states, error reporter, analytics tracker, mock mode (A28). |
| 1.6 | CI (lint, unit tests, Roborazzi, contract drift, release assemble, emulator job), release workflow for the KT0 APK, signing config, run configurations, `docs/README.md`. |

**K1 done when:** you can sign in with email or username on the `Gradus Automation Pixel` emulator against the local API on the Mac (`API_V1_ENABLED=true bun run dev`, then `adb reverse tcp:8080 tcp:8080`); role tabs render; the sync-engine tests and the shared contract-vector tests pass; `gradus://board/demo` opens the app; CI is green.

**Suggested order inside K1:** 1.6 skeleton and 1.1 module layout → contract sync and generated client → tokens, theme and the §8.6 shared components (with Roborazzi screenshots against the canvas) → 1.2 → 1.4 → 1.3 → 1.5.

---

## 4. Rules that matter most on day one

- **Parity (A2, §4.3).** Every iOS product decision applies as-is: copy verbatim, same rules, same API calls. Only iOS-native components become Android-native ones (Appendix G). Do not invent product behavior; if the PRD is silent, read the iOS code.
- **Intentional differences** are only the A-numbered decisions in PRD §0 Table 1. Notable: the six accepted fixes in A43; the flow-state scale in A44; the direct US link-out in A37 (no External Content Links; behind the `androidExternalLinksEnabled` kill switch).
- **One backend.** Android uses the same `/api/v1` as iOS. No Android-only product endpoints (§4.3 rule 16). Server changes follow §4.1: additive only, small PRs, Mariah publishes through Lovable, and migrations need "apply pending migrations" plus the `docs/api/SMOKE.md` precheck.
- **No third-party analytics or crash SDKs.** FCM is the only Firebase product (A11, A19).
- **Minors.** The server decides minor status; the app never computes it. Every athlete voice control stays hidden unless `GET /me` returns `athleteVoiceToPlan: true` (#48).
- **Devices.** Automation never runs on Mariah's own Pixel or watch without her go-ahead; use the named emulators in §5.2 step 7.
- **Commits and PRs.** Small PRs, one milestone package at a time; no model names in commits or PR text.

---

## 5. Open items that do not block K1

These are in PRD §12 with defaults that stand until Mariah changes them. None block the foundation:
- Google Play Console organization account (G2): enrollment can take weeks, so Mariah should start it early.
- Google Cloud, Firebase, OAuth clients, upload key, Apple Services ID (G1): needed for SA2–SA5.
- A secondhand Pixel Watch for Wear OS QA (A46): needed from KW0.
- Counsel: the Families-policy review for the Play target audience (A42), the privacy-policy additions (§12 i24), and the link-out policy risk (§11 A-27).
- Proposed decisions A11–A40 and A50–A52 stand as defaults; raise any you need to change in the daily update.

---

## 6. Daily update

End each working day with a short update for Mariah: what merged, what is next, anything blocked on her, and screenshots or a short screen recording of new screens (emulator screenshots via `adb exec-out screencap -p`).
