# Handoff — Milestone I1: iOS foundation (`gradus-ios`)

**For:** a fresh Claude Code session that will create `gradus-ios` and build the app's foundation.
**Written:** 2026-09-05, at the end of the backend session that landed API v1 (B1, B2).
**Read first, in this repo:** `docs/ios/PRD.md` sections 6.2–6.6 (API, auth, offline, push), 8 (design), 9 (engineering), 10.2 (milestone list), and Appendices A (endpoints), C (route→screen), F (work packages).

This document is the bridge between the backend work already done and the first iOS work. It exists so the new session does not have to re-derive any of it. Treat the PRD as the spec; treat this as the current state and the starting orders.

---

## 1. How to start the fresh session

1. Open a new Claude Code session with `~/Developer/gradus` as the working directory (the backend + PRD live here; the contract is pulled from here).
2. First message to that session: "Read docs/ios/handoff-I1.md and docs/ios/PRD.md, then carry out milestone I1." 
3. That session will ask you to create the `gradus-ios` repository (see §6). Everything after runs on your Mac.

`gradus-ios` does not exist yet. It is created as the first step of I1, under your GitHub account (`mariah-gill`), private.

---

## 2. What is already built and live (the backend the app will call)

One backend, shared by web and iOS: the Lovable Cloud Supabase project plus the TanStack Worker in **this** repo (`mariah-gill/gradus-coach-start`, deployed at https://gradus.training). The iOS app talks to it through `/api/v1` and to Supabase directly only for the session, realtime, and storage.

**Merged to `main` and deployed, currently DARK behind a flag:**

- **B1 — API foundation** (PR #52): `/api/v1` plumbing — `defineApiRoute` (kill switch → rate limit → auth → validate → idempotency → handler → output validate → `no-store` → error map), `src/lib/api/{errors,auth,client,idempotency,rate-limit,openapi,define-route}.ts`, tables `api_idempotency_keys` and `api_rate_limits`, OpenAPI generation to `docs/api/openapi.json`. Routes: `GET /meta/config`, `GET /meta/client-policy`, `POST /me/presence`, `GET /me/terms`.
- **B2 — auth broker** (PR #53, hardened by #58): `POST /auth/{apple,google,password,recover}`, `POST /auth/signup/coach`, `POST /auth/username/{check,resolve}`; identity verification (`jose`), GoTrue REST with service-role creds (captcha bypass), session minting via `generateLink`+`verify`, table `auth_identities`. **Smoke-tested 20/20 in production on 2026-09-05.**
- **B2 follow-up** (PR #56): Apple token revocation wired into account deletion; a guaranteed no-op until the Apple key exists. Delete-account flow smoke-tested 2026-09-05.

**The flag.** `API_V1_ENABLED` is a Lovable Cloud secret. When it is not exactly `true`, every `/api/v1` route returns `503 api_disabled`. It is currently **OFF**. For iOS development you will need it on (or run a local dev server with `API_V1_ENABLED=true bun run dev` and point the app at `http://localhost:8080`). Turning it on in production requires setting the secret and republishing in Lovable — that is a **you** step.

**Open, NOT merged** (do not assume these endpoints exist on `main` yet):

- PR #55 — Live Board reads (`GET /public/boards`, `/public/boards/{slug}`, `/boards/my-skaters`) and `board_follows`, with the Live Board payload fully modeled in zod. **The typed board payload is in this PR, not on main.** Milestone I2 depends on it; get it merged before I2.
- PR #54 — domain wave 1, **being closed** in favor of the extract approach (see §5). Do not build on it.

The current `docs/api/openapi.json` on `main` describes 11 paths (meta, me, auth). Board and domain endpoints arrive as their PRs merge.

---

## 3. I1 scope and definition of done

I1 is packages 1.1–1.5 in PRD Appendix F. Build them in the new `gradus-ios` repo.

| Pkg | Deliverable |
|---|---|
| 1.1 | Create `gradus-ios`; Xcode project (iOS 18, iPhone + iPad, Swift 6 strict concurrency); SPM packages per PRD §9.1 (`GradusAPI`, `GradusCore`, `GradusDesign`, and `Feature*`); a `Contract/` folder with `scripts/sync-contract.sh`; macOS CI (`xcodebuild test`); Xcode Cloud wired to TestFlight; fonts bundled; core design components. |
| 1.2 | Generated OpenAPI client (`swift-openapi-generator` + `swift-openapi-urlsession`) from the vendored `openapi.json`; request interceptors (bearer, `X-Gradus-Client`); `/meta/client-policy` force-update check; typed `APIError` mapping from the server's error codes. |
| 1.3 | Auth screens: sign in (email or username + password), Sign in with Apple, Google; Keychain session storage; optional biometric gate; terms-acceptance sheet driven by `/me/terms`. |
| 1.4 | Local store (SwiftData) + repositories + the outbox/sync engine (optimistic write, queue, backoff, idempotency-key replay, conflict → Sync Center); connectivity watch. |
| 1.5 | App shell: role tab bars, `NavigationStack` per tab, universal-link + push routing, push registration (`POST /devices`), error states, force-update screen. |

**Definition of done (every package):** builds; `xcodebuild test` green in CI; runs on the iOS 18 simulator; previews work with mock repositories; nothing in PRD §4 is touched in the web repo. Show it working in a daily update. The overall I1 gate: sign in with email or username on a device, role tabs render, sync-engine tests pass, a universal link opens the app.

**Testable now vs. later.** Email/username sign-in, the local store, sync, routing, and the design system are all testable now against a local dev server or the flag-on API. **Sign in with Apple, Google, push, and universal links require Apple Developer enrollment** (expected October 2026) and cannot be exercised end-to-end before it — build them behind the same interfaces and stub the provider calls until then.

---

## 4. Hard constraints (from PRD §4 and the decision log)

- **Never change the web repo's behavior.** iOS work lives in `gradus-ios`. The only touch to `gradus-coach-start` is additive: pulling `openapi.json`, and building the missing token/vector exports (§5). No web server function, migration on an existing table, or auth setting changes.
- **iOS 18 minimum, Swift 6, SwiftUI, `@Observable`.** iPhone-first, adaptive iPad. No Combine unless a framework forces it.
- **Dependencies stay minimal, all SPM:** `supabase-swift`, `swift-openapi-generator`/`-urlsession`, `GoogleSignIn-iOS` (only if the native Google path is chosen — else `ASWebAuthenticationSession`). No Firebase, no analytics, no crash SDK. Markdown via `AttributedString`, PDFs via `PDFKit`, audio via `AVFoundation`.
- **Keep the Gradus look:** bundle EB Garamond (display; Fraunces stays bundled for the Gradus wordmark only), Atkinson Hyperlegible (body), JetBrains Mono (numbers). Colors come from the design tokens (§5). Native navigation and gestures, not a web port.
- **Secrets on device:** only the Supabase publishable key and (if used) the Google iOS client ID. Everything else is server-side. Tokens in Keychain.
- **No In-App Purchase.** Plan status is display-only; link out to the web only on the US storefront (PRD §6.8).

---

## 5. Contract handoff, and two gaps to fill first

The contract is the boundary between the repos. `gradus-ios/Contract/` vendors these from `gradus-coach-start` at a pinned commit, and `scripts/sync-contract.sh` regenerates the Swift client and color catalog from them.

- **`docs/api/openapi.json` — EXISTS.** Source for the generated Swift client. Regenerated in the web repo by `bun run openapi`.
- **`docs/api/design-tokens.json` — DOES NOT EXIST YET.** The PRD (§8.2, §9.1) calls for a platform-neutral token file exported from `src/styles.css` by `scripts/export-design-tokens.ts`, also not yet written. **First task in the web repo:** write that export (OKLCH → sRGB for light and dark, all 154 token lines in `src/styles.css`), commit `design-tokens.json`, and add a CI freshness check. Until it exists, the iOS session can read `src/styles.css` directly, but the generated catalog should come from the JSON so web and iOS never disagree.
- **`docs/api/vectors/` — DOES NOT EXIST YET.** Shared JSON test vectors for lesson recurrence, name normalization, and session labels (PRD §9.5). These are needed when I5/I6 port `lesson-recurrence.ts` etc. Not required for I1; create them alongside the first ported logic.

Both gaps are additive to the web repo and safe.

---

## 6. What needs you (the human), and when

- **Now, to start I1:** create the `gradus-ios` repository, private, under `mariah-gill`. The fresh session will propose the exact `gh repo create` command; you run it (or approve it).
- **At Apple enrollment (~October 2026):** App ID `training.gradus.app` with Push Notifications, Associated Domains, Sign in with Apple; APNs `.p8`; Sign in with Apple `.p8` + key id + team id; Google iOS client id. These go into Lovable Cloud secrets (server side) and the Xcode project (client side). Until then, Apple/Google/push/universal-links are built but not testable end-to-end.
- **For any API dev against production:** turning `API_V1_ENABLED` on/off and republishing is a Lovable step only you can do. Prefer a local dev server for day-to-day I1 work so production stays dark.

---

## 7. Gotchas learned this session (do not rediscover these)

- **Lovable publish does NOT apply migration files that arrive via GitHub.** After merging any migration, you must ask Lovable to "apply pending migrations," then run the SQL precheck in `docs/api/SMOKE.md`. (PRD §4.1 rule 11.)
- **Service-role-only DB functions must `REVOKE … FROM PUBLIC, anon, authenticated`** explicitly — Supabase's defaults grant EXECUTE to anon/authenticated, so revoking from PUBLIC alone leaves them callable with the public key. (PRD §4.1 rule 12. Found and fixed a live enumeration hole this way.)
- **A profile-less confirmed session lands on the `/` role picker**, which reads as a login→signup loop. The API sign-up broker creates an auth user with no profile (profile is made at onboarding), so any account created that way is in this state until onboarded. Relevant because the iOS app signs up through exactly that path — PRD flags hardening the web to show a "finish setup" screen; decide before shipping sign-up.
- **Cloudflare can edge-cache a `/api/v1` GET briefly** even with `no-store`. Fine for public metadata; never let a per-user or sensitive GET be edge-cacheable.
- **Smoke tooling exists:** `scripts/smoke-api-v1.sh` (checklist against a base URL), `scripts/smoke-mint-session.ts` (session-minting path, local-only), `docs/api/SMOKE.md` (runbook with the migration precheck and the anonymous-RPC privilege check). Reuse the same pattern for new endpoints.
- **Auth broker specifics:** password sign-in accepts email or username (username → synthetic email `athlete-<id>@users.gradus.training`); the project auto-confirms email so sign-up returns a session immediately; recovery links to `/reset-password`.

---

## 8. First concrete steps for the fresh session

1. Confirm the plan back to Mariah in one short message, then propose the `gh repo create mariah-gill/gradus-ios --private` command for her to approve.
2. In `gradus-coach-start`: write `scripts/export-design-tokens.ts` + `docs/api/design-tokens.json` + CI check (small additive PR). This unblocks the color catalog.
3. Scaffold `gradus-ios` per PRD §9.1: Xcode project, SPM packages, `Contract/` + `sync-contract.sh` (pull `openapi.json` and `design-tokens.json` at a pinned `gradus-coach-start` commit), macOS CI.
4. Generate the API client (1.2), then build auth (1.3) against a local dev server with the flag on, stubbing Apple/Google until enrollment.
5. Build the store/outbox (1.4) and the shell (1.5). Keep a daily update to Mariah with screenshots or a simulator recording.

## 9. Do NOT

- Do not merge or build on PR #54 (reproduce approach, being closed). Use the extract approach for B3 domain endpoints: move each handler body into `src/lib/<domain>.server.ts`, make the web server function and the `/api/v1` route thin wrappers over it. (This is backend work in `gradus-coach-start`, separable from I1; sequence with Mariah.)
- Do not run a SwiftUI build in a cloud session — cloud runners are Linux. iOS builds are local on the Mac.
- Do not turn on `API_V1_ENABLED` in production or publish in Lovable yourself; those are Mariah's steps.
- Do not commit anything to `gradus-coach-start` that changes web behavior.
