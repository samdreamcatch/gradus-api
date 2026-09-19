# Handoff — the pre-QA gate for native 1.0 (`gradus-ios`)

**For:** any Claude Code session (or Mariah) taking the iOS app from "feature-complete in mock mode" to "ready for QA," and then into QA itself.
**Written:** 2026-09-19, the day Mariah confirmed her Apple Developer enrollment is approved and defined the gate below. Supersedes `docs/ios/handoff-I12-onward.md` as the current-state document (its §5 patterns and §6 gotchas are folded in here, so this file stands alone). The earlier `handoff-I8-onward.md` never merged (PR #82 closed); its still-true content is also folded in.
**Read first, in this repo:** `docs/ios/PRD.md` — §0 (decision log, amended 2026-09-19), §4 (constraints), §6.4 (auth), §6.6 (push), §6.7 (voice), §8.5 (accessibility), §10.6 (the gate and the milestone table), Appendix D (submission). Treat the PRD as the spec; treat this file as the current state, the working conventions, and the starting orders.

---

## 1. How to start the fresh session

1. Open Claude Code with `~/Developer/gradus` (this repo: backend, contract, docs) as the working directory. The iOS repo is a sibling checkout at `~/Developer/gradus-ios`. iOS work runs only on the Mac (`xcodebuild` needs the simulator; cloud sessions are Linux).
2. First message: "Read docs/ios/handoff-preQA.md and docs/ios/PRD.md §10.6, then carry out the next open milestone in §7, in order." Follow the conventions in §3.
3. Run the state check in §10 before writing code. In particular: which of the nine milestones already merged, whether the iOS contract is in sync with web `main`, and whether Mariah has done any of the account-side steps in §2.3.

Both repositories belong to `mariah-gill` on GitHub: `gradus-coach-start` (web + `/api/v1`, deployed by Lovable at https://gradus.training) and `gradus-ios` (SwiftUI app, CI on GitHub Actions `macos-26`).

---

## 2. Where things stand (2026-09-19)

### 2.1 Decisions Mariah made on 2026-09-19 (do not re-ask)

1. **Straight to native.** The Capacitor iOS shell (PRD's old C1) never ships; the native app is the first App Store release, versioned **1.0**. No welcome screen, no shell Sign in with Apple work, no shell review round. The Android shell (C2) is reopened, her call later.
2. **The QA build runs against production with `API_V1_ENABLED` on.** She flips the secret and publishes; no Claude session ever touches that flag. Release builds already point at `https://gradus.training`.
3. **Enrollment is approved, but nothing exists in App Store Connect yet** — no App ID, keys, Team ID, or Xcode Cloud. §2.3 lists what she has to create.
4. **Accessibility scope:** full WCAG 2.2 AAA per the 2026-09-17 audit; **allow landscape on iPhone**; **expand the score-sheet jargon**; **contextual help (3.3.5) is deferred** and stays partial by design.
5. **Voice-note transcripts are server-side** (the ElevenLabs path the guardian mirror already uses), stored on the message and returned to both clients — not on-device recognition.
6. **The Google sign-in button stays hidden until the iOS OAuth client ID exists.**
7. The gate: *"not ready for QA until Apple-developer-gated elements are integrated and it passes full AAA."* Nine milestones close it (§7); she asked for all nine in order in one session.

### 2.2 Merged and on `main`

**Web (`gradus-coach-start`)** at `6fa568cf` (2026-09-19): `/api/v1` has **210 operations** (191 paths). Everything through I15 plus the post-I15 fixes: roster cap (#107, #109), shared-guardian goals (#108), billing visible to all tiers (#102), lesson cadence picker (#103), App Attest server plumbing (#101, dormant/log-only), lesson reminders computed and deduped but never delivered (#100). Quality gates: `bun run build`, `typecheck`, `lint` (0 errors), `bun test`, `bun run openapi` (CI fails on a stale `docs/api/openapi.json`). CI = GitHub Actions `build` + Semgrep. No pre-commit hook exists anymore; `bun run format` is prettier.

**iOS (`gradus-ios`)** at `654a380` (2026-09-19): I1–I15 merged, plus the parent/athlete QA fixes (#34, #35), goals self-edit (#36), celebration poster (#37), the first three accessibility items (#38 design system, #39 announcements, #40 session flow + app-wide `confirmationDialog`→`alert`), and the FlowBars redesign (#41). Only PR #31 (marketing demo mode) is open. Packages: `GradusAPI`, `GradusCore`, `GradusDesign`, `GradusActivities`, `GradusWidgetData`, and `Feature{Auth,Onboarding,Roster,Plans,Messages,Sessions,Board,Resources,Settings,Invoicing,Competitions,Guardians}` (voice capture lives in `FeaturePlans`). Widgets target: `BoardLiveActivity`, `SessionLiveActivity`, `BoardWidget`.

**Contract:** iOS `Contract/SOURCE_COMMIT` = `d2f5798f`, an ancestor of web `main` but **stale**: `docs/api/openapi.json` gained the roster-cap "locked" fields in #107–#109 after it. The scheduled drift workflow's branch `chore/contract-sync-auto` is also behind. **The first iOS milestone (P2) starts with `GRADUS_WEB_DIR=~/Developer/gradus scripts/sync-contract.sh` from web `main`.**

**Accessibility audit** (2026-09-17, WCAG 2.2 AAA + VoiceOver, 88 screen states × light/dark): report and re-runnable XCUITest harness under `/private/tmp/claude-501/gradus-a11y-audit/` (main report `report/Gradus-iOS-Accessibility-Audit-2026-09-17.md`, harness `UITests/GradusAuditTests.swift` + `project.yml`, scheme `Audit`); published as a Claude Doc for the team at https://claude.ai/artifact/E5bKU8Dy2m4UgATH2QQD4W. `/private/tmp` may not survive a reboot — **P5 copies the harness into `gradus-ios/Tools/A11yAudit/`** so it persists.

### 2.3 Account side — Mariah's steps (the gate cannot close without them)

Also in gradus-ios `docs/enrollment-checklist.md` and PRD §10.6.

| Step | Where | Unblocks |
|---|---|---|
| App ID `training.gradus.app` with Push Notifications, Associated Domains, Sign in with Apple, App Groups; widget App ID `training.gradus.app.widgets` with App Groups; register group `group.training.gradus.app` | developer.apple.com → Identifiers | Signing any device build; P2's entitlements |
| APNs key (`.p8` + Key ID) and Sign in with Apple key (`.p8` + Key ID) | developer.apple.com → Keys | P3 push; Apple token revocation on delete |
| Team ID → to the session | developer.apple.com → Membership | P2 `DEVELOPMENT_TEAM`; P3 AASA file |
| Lovable Cloud secrets `APNS_KEY_P8`, `APNS_KEY_ID`, `APPLE_TEAM_ID`, `APPLE_SIWA_KEY_P8`, `APPLE_SIWA_KEY_ID` | Lovable Cloud → Secrets | P3 sender; App Attest registration; Apple revoke |
| App Store Connect app record (name, bundle ID, SKU, version 1.0, privacy URL `https://www.gradussports.com/privacy`, age rating, App Privacy answers, demo accounts) | appstoreconnect.apple.com | Xcode Cloud, TestFlight |
| Xcode Cloud: connect `mariah-gill/gradus-ios`, workflow "archive `main` → TestFlight internal group" with Mariah as tester | App Store Connect → Xcode Cloud | T1 |
| `API_V1_ENABLED=true` in Lovable secrets, then Publish | Lovable Cloud | The QA build talking to production |
| After each migration PR merges: ask Lovable to apply pending migrations, then run the `docs/api/SMOKE.md` precheck | Lovable | P3 (`live_activity_tokens`), P4 (`messages.transcript`) actually existing |
| Later, not blocking: Google Cloud iOS OAuth client for `training.gradus.app` → client ID to the session + secret `GOOGLE_IOS_CLIENT_ID`; Supabase redirect allow-list entry `gradus://reset-password` | Google Cloud Console; Lovable Cloud → Auth | P9 Google provider; P9 native reset |

### 2.4 Dark, unverified, or deferred — know these before claiming anything

- **Production `/api/v1` is off** (`GET /api/v1/meta/config` → 503) until Mariah flips it for QA. Release builds get 503 until then.
- **No real-backend on-device pass has been done for anything after I3.** Every milestone since was verified in mock mode (`-GradusMock`) plus unit/integration suites. That pass *is* QA; do not claim any I4–I15 feature works end to end.
- **iOS cannot play web-recorded WebM voice notes** (`Bubbles.swift` shows "Can't play this note here yet"); the web still records WebM (`use-voice-capture.ts`). P4's transcript gives users the content; the WKWebView playback fallback from PRD §6.7 is still unbuilt and optional.
- **Google sign-in is a stub** (`StubGoogleSignInProvider` in `Gradus/Dependencies.swift`); the button is visible today and errors on tap. P2 hides it; P9 implements it once the client ID exists.
- **Sign in with Apple has no entitlement.** `Gradus.entitlements` carries `aps-environment`, `applinks:gradus.training`, and the App Group, but not `com.apple.developer.applesignin`, so the sheet will fail on a device. P2.
- **No APNs sender, no push triggers, no `live_activity_tokens`, no AASA file** (`public/.well-known/` does not exist on web `main`). P3.
- **App Attest is dormant** on both sides (log-only, never enforcing) and cannot be verified until `APPLE_TEAM_ID` is set and a physical device is used.
- **Native password reset** is behind the build flag `GRADUS_NATIVE_RESET` (default off) and inert until the redirect allow-list entry exists. P9.
- **No `POST /errors` route and no MetricKit upload** despite PRD §6.11/§9.6. P9.
- **No `docs/ios/QA.md`.** P9.
- **Lesson reminders** are computed and deduped (web #100) but never sent. P3.
- **The Live Board Live Activity is app-driven only** (foreground). Server push-to-start is P3.
- **Founding Coach window closes 2026-11-01** (PRD §12 #8, still open). Not part of the gate.
- **CAA record for gradus.training** still not added (the real mitigation from the no-pinning decision). Mariah's DNS; not part of the gate.

---

## 3. Working conventions (Mariah's rules plus the ones that earned their place)

Mariah's rules, verbatim in spirit:
- **Milestones, never dates or durations.** Plan and report in milestones. No forecasts unless she asks, and then only from measured pace.
- **One update a day**, short, with screenshots (contact sheets from the simulator) and any decision that needs her. Send screens as soon as they exist.
- **Do not stop unless truly blocked without her.** Take the next milestone.
- **Never merge web or iOS PRs** (she merges; the 2026-09-12 one-day authorization was an exception, do not assume it), **never publish in Lovable**, **never apply migrations**, **never turn `API_V1_ENABLED` on or off**, never use Lovable "Try to fix all", no direct commits to `main` in either repo.
- Tagline is **"Practice made perfect"** only. App icon: navy `#2D3340` with three cream `#F7F5EF` bars.

Process rules:
- **Every PR targets `main`; branch each milestone from `origin/main`.** If a later milestone genuinely needs an unmerged change (iOS contract pinned to an unmerged web PR; iOS work stacked on unmerged iOS work), say so in the PR body, pin `Contract/SOURCE_COMMIT` to the web branch commit or an integration branch, and re-sync from `main` after the merge. When a stacked PR's base branch is deleted GitHub auto-closes it — retarget to `main` *before* deleting the base.
- **Web wave, then iOS wave, per milestone.** Web extracts and exposes; iOS syncs the contract and builds.
- **Adversarial review before handover.** Read every write path for ownership checks, every admin-client write for a guard, every route for auth/idempotency/rate-limit, every optimistic write for its revert, every hand-built path against the contract. Post the findings as a PR comment. Use independent reviewers (Agent tool or `/code-review`), then verify the strongest claims yourself.
- **Verify in the mock simulator with screenshots, run the full suite, then commit.** Definition of done is PRD §10.1.
- **Simulator split (permanent):** automated `xcodebuild build`/`test` go on **iPhone 17 Pro Max** (UDID `4E63D3FF-E87A-4129-9769-D0B994E9107A`), never **iPhone 17 Pro** (`4CD84707-49D6-4977-8494-D7E8BF340B62`), which is Mariah's own. A test run silently reinstalls a `localhost:8080`-pointed Debug build over whatever she has installed.
- **Confirmations use `.alert`, never `.confirmationDialog`** — on the iOS 26 SDK the dialog renders as a popover with no Cancel button (Apple: intentional). All 27 sites were converted in PR #40.
- Commit trailer: use whatever the current session's system prompt says (this session: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`). PR bodies end with the Claude Code line.
- **Money-critical writes are online-only** (I11 exception to "every write queues"). **Entitlement gating is client-side UI, never a purchase button** (PRD §6.8).
- **Sessions collide.** gradus-ios is one shared clone with no worktrees; other Claude Desktop sessions may be idle on it with dirty trees. Check `git status` and `git stash list` before branching; if another session is mid-work, `git stash push -u`, do your work on a fresh branch, restore exactly once done. Better: `git worktree add ~/Developer/gradus-ios-wt/<branch>` for your own milestone.

---

## 4. Tooling and commands (do not re-derive)

### 4.1 Web repo

```bash
bun run build      # vite build; also regenerates src/routeTree.gen.ts — run after adding routes
bun run typecheck  # tsc --noEmit
bun run lint       # eslint; 0 errors required, warnings are pre-existing
bun test           # unit + route pipeline tests
bun run openapi    # regenerates docs/api/openapi.json (commit it; CI checks drift)
git status --porcelain | cut -c4- | grep -E '\.(ts|tsx)$' | grep -v routeTree | xargs bunx prettier --write
```

Local dev server: `API_V1_ENABLED=true bun run dev` on 8080; auth-broker routes 500 locally (no service-role key), meta and 401 paths work. There is **no service-role key available to any session** (Lovable owns the Supabase org); the only live backend a Debug build can reach is a Lovable shared preview (§4.3) — and after Mariah flips the flag, production from a Release/TestFlight build.

Sibling web PRs conflict on `docs/api/openapi.json`, `scripts/openapi.ts`, `src/routeTree.gen.ts`: merge `origin/main`, take main's generated files, regenerate (`bun run openapi`, `bun run build`), union-merge the import lines in `scripts/openapi.ts`, never hand-merge generated content. Lovable also commits to `main` (e.g., "Fixed CTZ parsing"); `git pull` before assuming local `main` is current.

### 4.2 iOS repo

```bash
xcodegen generate                                            # after editing project.yml (commit Gradus.xcodeproj)
GRADUS_WEB_DIR=~/Developer/gradus scripts/sync-contract.sh   # copies openapi.json, design-tokens.json, vectors; regenerates client + colors; writes Contract/SOURCE_COMMIT
S=<scratch dir>
# tests (CI-equivalent) — ALWAYS to a log file; a piped xcodebuild hides its exit code
xcodebuild test -project Gradus.xcodeproj -scheme Gradus \
  -destination 'platform=iOS Simulator,id=4E63D3FF-E87A-4129-9769-D0B994E9107A' \
  -derivedDataPath "$S/dd-test" > "$S/test.log" 2>&1; grep -E '\*\* TEST (SUCCEEDED|FAILED)|error:' "$S/test.log" | tail
# a launchable build (ad-hoc signed; CODE_SIGNING_ALLOWED=NO builds lose the keychain session)
xcodebuild build -project Gradus.xcodeproj -scheme Gradus -destination '…same…' \
  -derivedDataPath "$S/dd-app" CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO > "$S/build.log" 2>&1; grep -E 'BUILD (SUCCEEDED|FAILED)' "$S/build.log"
xcrun simctl install 4E63D3FF-E87A-4129-9769-D0B994E9107A "$S/dd-app/Build/Products/Debug-iphonesimulator/Gradus.app"
xcrun simctl launch 4E63D3FF-E87A-4129-9769-D0B994E9107A training.gradus.app -GradusMock coach
xcrun simctl io 4E63D3FF-E87A-4129-9769-D0B994E9107A screenshot shot.png
# accessibility passes
xcrun simctl ui <udid> content_size accessibility-extra-extra-extra-large   # reset: medium
xcrun simctl ui <udid> increase_contrast enabled                            # reset: disabled
xcrun simctl ui <udid> appearance dark
```

`xcodebuild` on this Mac silently downgrades `Gradus.xcscheme`'s format (1.7→1.3) as a side effect — `git checkout Gradus.xcodeproj/xcshareddata/xcschemes/Gradus.xcscheme` before every commit unless the scheme change is intentional. CI (`.github/workflows/ios.yml`) regenerates the project, the generated client, and the colour catalog and fails on any diff, then runs `xcodebuild test` on `iPhone 17 Pro` (CI's own simulator, fine there); run the three regenerations locally before pushing.

**Mock graph** (`Gradus/Dependencies.swift`, `-GradusMock <mode>`): `coach`, `newCoach`, `parent`, `parentBasic` (Team plan inactive), `athlete` (adult), `athleteMinor`, `signedOut`, `terms`, `noRole`, `signUp`, `signUpParent`, `signUpAthlete`, `demoCoachAlyson`, `demoCoachMariah`, `demoParent` (marketing demo, PR #31). Every mock launch clears the per-user disk caches first (the 2026-09-14 cache-bleed fix), so each launch is exactly its seed. Preview repositories are actors with `setFailure(_:for:)` and `recorded()`.

**Audit harness:** `/private/tmp/claude-501/gradus-a11y-audit/` — `xcodegen generate` there, then `xcodebuild test -scheme Audit` against the Pro Max with the Gradus debug app installed; it launches each mock role, walks ~88 screens, runs `performAccessibilityAudit`, and dumps the VoiceOver hierarchy (`XCUIApplication.debugDescription`) per screen. When the iOS Simulator MCP tool's `tap`/`inspect` are broken (they were on 2026-09-17 and 2026-09-19), drive the app with XCUITest instead of fighting coordinates.

### 4.3 Real pass against the Lovable preview (Debug builds, until production is on)

Mariah creates a shared preview link (Share → Share preview → new link); it redirects to `https://id-preview--…lovable.app?__lovable_token=<JWT, ~7 days>`; visiting once sets a `lovable-auth` cookie. She sets `API_V1_ENABLED=true` in Lovable secrets (applies to the preview at once). Build with `GRADUS_API_BASE_URL=<preview host>` and launch with `-GradusPreviewToken <token>` (Debug-only `PreviewGate`) on **her** simulator. Demo accounts: coach `coach@gmail.com` (she types passwords), parent `mariah.slone+1@gmail.com`. Once production is on for QA, a Release build on her phone replaces all of this.

---

## 5. Architecture patterns to copy

### 5.1 Web: extract, wrap, expose

For each domain: handler bodies live in `src/lib/<domain>.server.ts` as plain async functions taking a context (`{ userId, supabase }` for RLS-scoped work, `{ userId, admin }` when the original used the admin client, or both) and typed inputs (export the zod schemas). Throw `ApiError` (`src/lib/api/errors.ts`) with stable codes. The `.functions.ts` file is a thin `createServerFn` wrapper inside `try { … } catch (err) { rethrowPlain(err) }` so the web keeps its exact error strings. Web behavior must not change (PRD §4).

Routes at `src/routes/api/v1/**` use `defineApiRoute` (`src/lib/api/define-route.ts`): `method`, `path`, explicit `operationId` (it is the Swift method name), `auth: "user" | "public"`, `input`/`query`/`output` zod (DTO schemas in `src/lib/api/<domain>-schema.ts`), `idempotent: true` on creates (the Postgres advisory-lock reservation lives inside `withIdempotency`), `rateLimit` on public writes and AI routes, `etag` on list/detail GETs, `body: "multipart"` + `partContentTypes` + `maxBodyBytes` for uploads. Register each route file in `scripts/openapi.ts`, then `bun run openapi`. **"One of N shapes" responses are a plain object with N named nullable fields**, never `z.discriminatedUnion`/`z.union` (the generator emits unlabeled `Case1Payload` otherwise). **Never chain `.limit(1)` before `.maybeSingle()`** when you read the row's content.

Migrations: additive only; every new `public` table ships with GRANTs and RLS in the same file; every service-role-only function ends with `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role;`. Cron pattern: pg_cron → a Worker hook route (precedents: `20260819195309`, `20260817000659`, `billing-notices.ts`, `lesson-reminders`). Write migration files in PRs; never run them.

Tests: a chainable fake Supabase client lives in `src/lib/coach-roster.server.test.ts` / `src/lib/plans.server.test.ts` (copy it); route pipeline tests in `src/lib/api/define-route.test.ts`; contract vectors in `docs/api/vectors/*.json` with drift tests on both sides.

### 5.2 iOS: repository, dependencies, model, view

- **Models** in `GradusCore/<Domain>/…Models.swift`: `Codable`, field-for-field with the DTO schema.
- **Repository** protocol + `Live…Repository` (generated client for reads and ETag'd GETs; `LiveMutationTransport` JSON writes for anything the outbox must replay, with `IdempotencyKey`) + `Preview…Repository` actor + a per-user cache (`…Cache.load/save/clear(for:)` under `StoreContainer`, wiped on sign-out). Pin every hand-built path with a `…PathsContractTests` test.
- **Feature package** `Packages/Feature<X>` (register in `project.yml`, `xcodegen generate`): `…Dependencies` struct with `.preview()`, `@MainActor @Observable` models with `activate()` (cache first, then load with `If-None-Match`), `refreshOnForeground()`, the online-first write helper `perform(...)` returning `WriteOutcome` (try live → on status 0/≥500 enqueue → on 4xx revert and toast; invalidate the cached ETag on every queued write). Views use `PaperBackground`, `PageTitle`, `GradusCard`, `Eyebrow`, `GradusChip`, `GradusTag`, `GradusField`, `StateView`, `.gradusPrimary`, `.gradusSecondary`, `.gradusPress`, `.chip*`, `.textFieldStyle(.gradus)`, `FlowBars`. Accessibility identifiers on every control; **route-pushed screens whose `@State` model is built from a route parameter must be `.id(param)`-keyed**.
- **Shell wiring**: `AppDependencies` (`Dependencies.live`/`.preview`), `AppModel`, `RoleTabsView` (tab roots and `RouteDestinationView`), `AppRoute`, `Tests/GradusTests/AppModelTests.swift`.
- **Concurrency**: Swift 6 strict; `Activity` (ActivityKit) is not Sendable, so activity controllers are non-isolated classes with `NSLock.withLock`; never hold a lock across an await. A non-cancellable framework call on a critical path gets a deadline race with an abandoned Task, not a TaskGroup (App Attest lesson).
- **Accessibility**: `ToastCenter.show` announces (errors never auto-dismiss); post `AccessibilityNotification.Announcement` for any outcome that does not go through a toast; `GradusField` labels its content; `GradusChip` carries `.isSelected`; chips have 44 pt hit areas; `Eyebrow(isHeader:)`.

---

## 6. Gotchas learned (do not rediscover)

- swift-openapi-generator: multipart bodies must be `required: true`; `partContentTypes` declares part types; `.nullable().optional()` becomes `String?` and cannot send an explicit `null` (use the transport with a hand-built body); `date-time` becomes `Foundation.Date`; a `z.discriminatedUnion` becomes unlabeled cases.
- Never name a Swift enum case `none`. Plan ids contain hyphens. Only one `extension URL: Identifiable` may exist (it is in `GradusDesign/Components/Identifiers.swift`). `.accessibilityIdentifier` on a container propagates to every child.
- `xcodebuild … | tail` or `…; echo done` masks the real exit code — redirect to a log and grep it.
- `JSONEncoder` key order is not stable across launches; anything hashed or fingerprinted uses `.sortedKeys` or a hand-written canonical form (App Attest and schedule-import both got bitten).
- Web: `defineApiRoute` JSON-parses the body when `input` is set; `routeTree.gen.ts` is regenerated only by `bun run build`. Cloudflare briefly edge-cached a `/api/v1` GET despite `no-store`; treat per-user GETs with suspicion.
- Lovable publish does **not** apply migration files from GitHub (PRD §4.1 rule 11).
- Do not propose certificate pinning, In-App Purchase, Firebase/analytics SDKs, or a Supabase data migration.
- Known schema gap: `parent_profiles.user_id` and `athletes.user_id` lack `auth.users` FKs.
- The web's `getPlan` creates a coach profile on first read for any non-parent — deliberate web parity; do not extend it.
- Every iOS colour (all 57) is generated from `Contract/design-tokens.json`, which is exported from the web's `src/styles.css` by `scripts/export-design-tokens.ts`; CI fails if `Colors.xcassets` drifts. **A token fix is a web change first** (P6).
- The iOS Simulator MCP tool's `tap`/`inspect` have been unreliable in two sessions; XCUITest is the dependable way to drive and inspect the app.
- Concurrent `xcodebuild`/git operations on one working tree from two agents collide; use worktrees or wait for phase boundaries.

---

## 7. The nine milestones (in order; PRD §10.6 has the summary table)

Each: branch from `origin/main`, adversarial review, PR to `main`, daily update with screenshots. Done criteria are in PRD §10.6.

### P1 — Docs (this PR)
PRD amended for native-only and the gate; this handoff. Done when merged.

### P2 — Apple wiring on iOS
Branch `feat/apple-wiring` in gradus-ios, starting with a contract re-sync from web `main`.
- `project.yml` entitlements: add `com.apple.developer.applesignin: [Default]` (run `xcodegen generate`; the entitlements file is regenerated from `properties`).
- `MARKETING_VERSION: "1.0.0"`; check `src/lib/api/…client-policy` on the web so `minSupportedVersion` does not force-update a 1.0.0 client, and any iOS test asserting on `2.0`.
- Google: `GoogleSignInProvider` gains `var isConfigured: Bool`; `SignInModel` exposes it; `SignInView` (and any sign-up screen with a Google button) hides the button when false. Keep `signIn.google` identifiers for when it returns.
- Xcode Cloud: `ci_scripts/ci_post_clone.sh` (install XcodeGen, `xcodegen generate` — harmless since the project is committed) and `ci_scripts/ci_pre_xcodebuild.sh` (stamp `CURRENT_PROJECT_VERSION` from `CI_BUILD_NUMBER`). Release builds already use `https://gradus.training` (`project.yml` sets `GRADUS_API_BASE_URL` to it in the base settings and overrides Debug to `http://localhost:8080`; `Gradus/AppConfig.swift` falls back to it).
- `DEVELOPMENT_TEAM` and the AASA Team ID: **wait for Mariah's Team ID**, then one small follow-up commit/PR. `aps-environment` stays `development` in the file; Xcode sets `production` for App Store/TestFlight exports.
- Do **not** build the push-to-start token upload here; it needs P3's endpoint in the contract (it is P3's iOS wave).

### P3 — Push (web wave, then iOS wave)
Web branch `feat/apns-push` off `main` (split into two or three PRs if the diff gets large: sender+triggers, reminders delivery, live activities):
- `src/lib/push.server.ts`: keep the token functions; add `sendPush(userIds, payload, opts)` — token-based APNs auth (ES256 JWT via WebCrypto from `APNS_KEY_P8`/`APNS_KEY_ID`/`APPLE_TEAM_ID`, cached ≤ 50 min), `POST https://api.push.apple.com/3/device/<token>` with `apns-topic` (`training.gradus.app`; `…push-type.liveactivity` for activities), `apns-push-type`, `apns-priority`, `apns-expiration`; delete the token on `410` and `400 BadDeviceToken`; never throw into the caller (PRD §4.1.7); structured logs. Sends are awaited inline with a short timeout inside try/catch unless the runtime exposes `waitUntil` (check how existing email sends run).
- Payload per PRD §6.6: `{"aps": {"alert", "badge", "sound", "thread-id"}, "gradus": {"type", "route", "v": 1}}`; badge = the recipient's unread total (`getUnreadTotal`). Recipients resolved from `device_tokens` (platform `ios`), skipping anyone who has blocked the sender (`user_blocks`).
- Triggers inside the shared functions (both clients fire them): message sent → other participants (`rooms/{roomId}`); plan activated/assigned → athlete + guardians (`plans/{planId}`); lesson wrap-up prompt (from the existing wrap-up computation, `coach/wrap-ups`); connection accepted → the inviting side (`settings/connections`); recap prompt → coach/parent (`recaps/{competitionId}`); entitlement changed (Stripe webhook) → silent push (`settings/plan`). Lesson reminders: wire the existing `lesson_reminders_sent` pipeline (#100) to the sender.
- Migration `live_activity_tokens` (user_id, token, kind `board_start`/`board_update`, activity_id, follow_key, platform, created/updated; RLS: owner insert/update/delete/select; server reads with the admin client) + `POST /live-activities/tokens` and `DELETE /live-activities/tokens/{token}`; hook the board snapshot refresh (`competition_snapshots` refresh path in the scraper/cron) to compute each signed-in follower's lane state for followed skaters (`board_follows` + the web's `normalizeName`, same rules as iOS `BoardActivityPlanner`), then start (push-to-start token, `attributes-type: BoardActivityAttributes`), update (activity update token), and end activities. The content-state JSON must match `GradusActivities/BoardActivityAttributes.ContentState` key for key.
- `public/.well-known/apple-app-site-association` (`applinks` with the PRD §6.10 paths and exclusions, `webcredentials`), served as `application/json` with no redirect — **needs the Team ID**; do not commit a placeholder (Apple's CDN caches it).
iOS wave (branch stacked on `feat/apple-wiring` if unmerged; contract pinned to the web branch): `Activity<BoardActivityAttributes>.pushToStartTokenUpdates` → upload; per-activity `pushTokenUpdates` → upload with the activity id/follow key; delete on sign-out. Push-tap routing (`RouteParser.route(fromPushUserInfo:)`, I9) already exists.
Verification: unit tests with a fake fetch for the sender (JWT shape, headers, 410 handling); the real send is verified at T1 on Mariah's phone.

### P4 — Voice-note transcripts (web wave, then iOS wave)
Web `feat/voice-note-transcripts`: migration `ALTER TABLE public.messages ADD COLUMN transcript text` (+ `transcript_status text` if a pending/failed state is useful); in `sendMessage` (`src/lib/messages.server.ts`), after the insert, transcribe every voice note (both the inline `voiceBytes` path and the client-uploaded `audioPath` path; `transcribeWithElevenLabs` handles WebM and M4A) and update the row — best-effort, never failing the send; a pg_cron → hook sweep transcribes rows where `kind='voice' AND transcript IS NULL` in small batches (this doubles as the backfill for old notes); add `transcript` to the room message DTO (`src/lib/api/messages-schema.ts`) and the web's `getRoom` shape (additive); reuse the guardian mirror's existing transcript when present instead of transcribing twice. Realtime: the room listens to `postgres_changes` — confirm UPDATE events reach the client or accept that a late transcript appears on the next fetch.
iOS: `Message.transcript: String?`; `VoiceBubble` shows the transcript under the player (full text, no `lineLimit`), a "Transcript coming" line while nil, and includes it in the combined accessibility label; `SampleMessaging` seeds transcripts; tests for decoding and label composition.
Optional, Mariah's call: show the transcript under web voice bubbles too; make the web prefer `audio/mp4` when `MediaRecorder` supports it (PRD 3.9).

### P5 — Accessibility: reflow, landscape, targets (iOS)
Audit §5.3, §5.5, §5.10 orientation; order-of-work items 5, 6, 8. First copy the audit harness into `Tools/A11yAudit/` so it lives in the repo. Then: `ScrollView` around the Terms gate and the celebration card; remove `lineLimit(1)` from names, titles, previews, emails, room titles, board subtitles (84 sites — allow 2–3 lines or none); `ViewThatFits`/`AnyLayout` stacking at `dynamicTypeSize.isAccessibilitySize` for the listed side-by-side rows (sign-in links, name pairs, composer, recording bar, failed-send row, "Messages + New", board code field, score-sheet columns, invoice period pickers, rate field); reserve bottom inset for the Plans floating buttons; `accessibilityShowsLargeContentViewer` on the Live toolbar button and bar items; the 69 `.font(.system(size:))` icons → text-style fonts; segmented pickers that can reflow; every control in the audit's target table to ≥ 44 pt (24 pt is the floor, not the goal). Landscape: add the two landscape orientations to `UISupportedInterfaceOrientations` in `project.yml` and walk every screen in landscape (safe areas, floating buttons, composer, timer, board wheel, sheets). Verify with the harness at AX5 in portrait and landscape (`XCUIDevice.shared.orientation`).

### P6 — Accessibility: tokens, lock screen, hygiene (web token export, then iOS)
Audit §5.4; items 7, 9, 10. Web: light `destructive-ink` to ≥ 7:1 on card/background (≈ `#A8121B`), `destructive-foreground` dark to a dark ink so "Delete my account" passes on the dark fill, re-export `docs/api/design-tokens.json` (CI checks it) — this darkens the web's light-mode red too, by design. iOS after contract sync: `colorSchemeContrast == .increased` → opaque cards, stronger dividers (PRD §8.5 promise); widget and Live Activity lane colours from ink tokens, not raw tints; toggles `.tint(GradusColor.accentInk)`; focus rings already `accentInk` (#38); remove opacity-dimming on text (11 sites) in favour of real tokens; `PageTitle` dark stripe below the baseline or ≈ 0.35 opacity; secondary/chip borders ≥ 3:1; tertiary text over the strongest paper wash. Lock screen: `.accessibilityHidden(isLocked)` on `content` in `RootView` and `.isModal` on `LockScreenView`. Hygiene: move `celebration.cover` off the root ZStack.

### P7 — Accessibility: everything else in the audit (iOS)
Audit §5.2, §5.7, §5.8, §5.9, §5.10 and the §6 scorecard, minus 3.3.5. Name the four `labelsHidden()` pickers; `.speechSpellsOutCharacters()` on invite codes; `.textCase(.uppercase)` instead of `uppercased()` (77 sites); `accessibilityValue` expanded/collapsed on disclosure rows; navigation titles on the listed screens; bubbles' interactive children reachable (`.contain` or explicit actions); decorative chevrons/glyphs hidden; `.updatesFrequently` on the updated pill, recording timer, widget timers; confirmations for Bench, Revoke, club-join (which cancels a paid subscription), "No one competed", queued-message delete; Report sheet `alsoBlock` default false; "Error:"-prefixed and announced inline errors at the listed sites (plus `ForgotPasswordView`); failed invoice load distinguished from empty; disabled-button reasons; force-update screen says it opens Safari and the athlete detail sheet gets a title and Close; Safari-bound rows say so; section titles as headers; image resources labelled and zoomable without pinch; schedule-import result announced; the score-sheet jargon expansions Mariah approved (GOE, deductions, factor, IJS, units); the spoken terms-gate date; the `NoRoleView` internal-jargon string. Line spacing for Markdown answers (1.4.8) if cheap.

### P8 — Device pass and re-audit
Needs a device build (Team ID in the project, or a TestFlight build). What a session can do: re-run the harness (all roles, light/dark, AX5, Increase Contrast, landscape), test with a hardware keyboard on the simulator, and write Mariah a short device script for VoiceOver, Switch Control, Voice Control, Full Keyboard Access, and iPad. Fix everything found; update the audit doc's scorecard.

### P9 — QA prep, then T1
- `docs/ios/QA.md` (this repo): per-role flows from PRD §7, airplane-mode scenarios, background/kill scenarios, push and Live Activity checks, universal links, Sign in with Apple, account deletion with Apple revoke, the accessibility spot checks, the demo accounts.
- Web `POST /errors` (mirrors `reportClientError`, tagged `platform=ios` with version/build) and iOS `ErrorReporter` + MetricKit (`MXMetricManager`) upload on next launch.
- Google: implement `GoogleSignInProvider` with `GoogleSignIn-iOS` (SPM) reading the client ID from `GRADUS_GOOGLE_IOS_CLIENT_ID`; the button shows itself once configured; the broker `POST /auth/google` already verifies against `GOOGLE_IOS_CLIENT_ID`.
- Native reset: flip `GRADUS_NATIVE_RESET` on once the allow-list entry exists; verify the `gradus://reset-password` link end to end.
- Then T1: Xcode Cloud archive of `main` → TestFlight → Mariah's phone against production with the flag on. QA begins.

---

## 8. Decisions that need Mariah (ask at the right moment, not up front)

- Whether the Capacitor Android shell ships at all, or Android waits for Kotlin (PRD §12 #14). Not part of the gate.
- Whether the web should show voice-note transcripts and prefer `audio/mp4` recording (P4 optional pieces).
- Whether the darker light-mode red on the web (P6) is acceptable — it is a visible web change, by design.
- Extending the Founding Coach window past 2026-11-01 (PRD §12 #8).
- US-only storefront at submission (PRD §12 #7, default yes).
- The competition-linking redesign, the Resources seed, and the connections-page redesign from the 2026-09-12 handover (§9) — all outside the gate.

---

## 9. Follow-ups and debt carried over

- Competition-linking flow redesign (browse the public skater list first, then match to own roster, competition-sourced invites pending guardian approval) — designed halfway, not built.
- Resource Library: 18 real parent-facing articles live on web, iOS mock still seeds a placeholder.
- Connections page redesign (only one comparison screenshot in hand).
- `assertOwnsAthlete` in `parent-settings.server.ts` checks only the direct parent, not shared guardians (spawn-task suggestion `task_41a108b2`; #108 may have addressed part of this — verify).
- `PreviewOrgRepository`'s seeded club code `DENVER01` does not match the server's `[A-Z2-9]{8}` alphabet.
- Visibility rollback replaces a whole list snapshot rather than one row; shell routing test coverage for `switchAccount`/`settings/connections`.
- Dependabot PRs #110–#114 on the web repo are Mariah's to merge or close.
- The `parent_profiles`/`athletes` → `auth.users` FK gap.
- CAA record for gradus.training.

---

## 10. First concrete steps for the fresh session

1. State check: `gh pr list` in both repos; `git -C ~/Developer/gradus log --oneline -1 origin/main`; `git -C ~/Developer/gradus-ios log --oneline -1 origin/main`; `cat ~/Developer/gradus-ios/Contract/SOURCE_COMMIT` vs web `main`; `curl -s https://gradus.training/api/v1/meta/config` (503 until Mariah flips it); `git status`/`git stash list` in gradus-ios for another session's leftovers. Which of P1–P9 are merged? Which account-side steps in §2.3 has Mariah done (ask; you cannot see App Store Connect)?
2. Boot the Pro Max if it is not up: `xcrun simctl boot 4E63D3FF-E87A-4129-9769-D0B994E9107A`.
3. Take the next open milestone in §7. For P2, start with the contract re-sync. For P3 and P4, web wave first, adversarial review, PR, then the iOS wave pinned to the web branch commit if the PR is still open.
4. If Mariah sends the Team ID at any point, stop and finish the team parts of P2 (`DEVELOPMENT_TEAM`, `xcodegen generate`) and the AASA file, as one small PR each.
5. Daily update: what merged, what is open, screenshots, and the account-side steps still outstanding from §2.3.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
