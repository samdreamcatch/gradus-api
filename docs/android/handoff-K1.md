# Handoff: Android foundation (SA1 and K1)

**For:** a fresh Claude Code session that will start the native Android app.
**Written:** 2026-10-14, at the end of the session that wrote and settled `docs/android/PRD.md`.
**The spec is `docs/android/PRD.md` on `main`.** This document is the current state and the starting orders. Do not re-derive anything the PRD already decides.

**Read first, in this repo:**
1. `docs/android/PRD.md` §0 (decision log; Table 1 is Android, Table 2 maps every iOS decision #1–#54), §4 (constraints, especially **§4.3 parity rules**), §5.2 (toolchain), §6.1–§6.6 (backend, API, auth, offline, push), §9 (engineering standards), §10.2 (milestones), Appendix A (endpoints and server additions), Appendix F (work packages) and Appendix G (iOS → Android mapping).
2. `docs/android/PRD.md` §8 (design system) **after** checking §1 below.
3. The reference implementation: `mariah-gill/gradus-ios` on `main`. When the PRD and the iOS code disagree, the iOS code at HEAD wins unless an Android decision (A-number) says otherwise.

---

## 1. How the work runs: daily cloud sprints

**Mariah, 2026-10-18:** a fresh Claude Code **cloud** session starts every morning (a scheduled routine), gets as far as it can without her, and opens PRs for her review. She asks a separate session for an adversarial review of each open PR and then merges it. **The sprint session never merges its own PRs.**

The cloud environment now allows `dl.google.com`, so Gradle, `sdkmanager` and Google's Maven work in the cloud. There is **no Android emulator** in the cloud (no hardware virtualization): unit tests, Robolectric, Roborazzi screenshot tests, lint, the contract drift check and release assembly run in the session; instrumented and emulator tests run in GitHub Actions on Linux runners with KVM.

| # | Prerequisite | Status on 2026-10-18 |
|---|---|---|
| P1 | Private repo `mariah-gill/gradus-android` with Claude's GitHub app access | **Done** |
| P2 | Design system ("Show, don't tell") in PRD §8 (A61–A70), from `docs/design/show-dont-tell-handoff.md` and its canvas (https://claude.ai/artifact/6bUwfU8oiUGMP6HhrPrLuQ) | **Done** (PR #245) |
| P3 | Cloud environment network allows `dl.google.com` | **Done** |
| P4 | Mariah's Mac toolchain (PRD §5.2 steps 1–10) and her Pixel in developer mode | Not needed for the cloud sprints. Needed when she wants to run builds on her Pixel; until the Play internal testing track exists (G2), she installs CI-built APKs (KT0) |

**Design source of truth:** PRD §8 (especially §8.6), then the handoff doc and its canvas. Where they differ, the merged iOS code wins (for example, the practice line replaced the canvas's "Mirror" chart).

**What needs Mariah, so park it and say so in the PR and the daily update:** anything needing her accounts or devices (G0–G2: Google Cloud, Firebase, OAuth clients, upload key, Apple Services ID, Play Console), publishing server changes in Lovable (and "apply pending migrations" after a migration), product decisions not settled in the PRD, and device-only checks (her Pixel, a Wear OS watch, real push, microphone, biometrics, App Link verification). Build those features behind interfaces with fakes and keep going.

---

## 2. Each day's sprint

1. **Orient.** Read this file, the PRD sections for today's package, and `docs/PROGRESS.md` in `gradus-android` (create it on day one: milestone and package status, open PRs, what is parked on Mariah, what is next). List open PRs in both repos.
2. **Pick the next unfinished package** in the order in §3. If yesterday's PR is still open, either take an independent package, or branch from that PR's branch and say in the new PR that it is stacked on it. Never rewrite or force-push a branch Mariah may be reviewing.
3. **Check iOS for drift.** Compare `gradus-ios` `main` with the reference commit in the PRD front matter for the area you are building. If iOS changed behavior there, follow the iOS code (A2) and note it in the PR; if it is a product decision the PRD doesn't record, flag it for Mariah instead of guessing.
4. **Build in small PRs**, one package or a coherent slice, each with tests. Before opening a PR, run the full local checks (`./gradlew` lint, unit tests, Roborazzi verify, contract drift) and a self-review of the diff for correctness against the PRD. Open the PR with: what it does, how it was tested, what is parked on Mariah, and screenshots from Roborazzi for any UI.
5. **Keep going** until the day's work is out of road: do as many packages as fit, in order.
6. **Close the day.** Update `docs/PROGRESS.md` (in the day's last PR) and end with a short summary for Mariah: PRs opened, what's next, and what is waiting on her.

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

**K1 done when:** CI is green on `main` with: unit and Robolectric tests for the API client, auth, sync engine and routing (sign-in exercised against a MockWebServer that replays responses shaped by the vendored `openapi.json`); the shared contract-vector tests passing; Roborazzi screenshots of the §8.6 components and the sign-in and role-tab screens in light and dark; and a GitHub Actions emulator job that launches the debug app in mock mode (A28), opens `gradus://board/demo`, and shows the role tabs. **Parked on Mariah:** signing in against the real API on her Pixel (she runs it from her Mac with `API_V1_ENABLED=true bun run dev`, or against production once she provides a test account).

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
