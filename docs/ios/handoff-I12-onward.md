# Handoff — from I11 to native 2.0 (`gradus-ios`)

**For:** a fresh Claude Code session that will take the iOS build from where it stands (I1–I11 merged) through submission of native 2.0.
**Written:** 2026-09-08, at the end of the session that built and hardened I10 (Resources and Ask Gradus) and I11 (Invoicing), plus an urgent production safety hotfix.
**Read first, in this repo:** `docs/ios/PRD.md` — §4 (constraints), §6 (architecture), §7 (feature requirements), §8 (design), §9 (engineering), §10.2 (milestone table), Appendix A (endpoint map), C (route→screen), D (submission), F (work packages). Then `docs/ios/handoff-I1.md` §4 and §9, and `docs/ios/handoff-I8-onward.md` (superseded by this file, but its §5 "architecture patterns to copy" and §6 "gotchas" are still accurate and not repeated in full here — read both). Treat the PRD as the spec; treat this file as the current state, the working conventions, and the starting orders.

---

## 1. How to start the fresh session

1. Open Claude Code with `~/Developer/gradus` (this repo, the backend and the contract) as the working directory. The iOS repo is a sibling checkout at `~/Developer/gradus-ios`. iOS work runs only on the Mac (never in a cloud session — PRD §9.6, and `xcodebuild` needs the simulator).
2. First message: "Read docs/ios/handoff-I12-onward.md and docs/ios/PRD.md, then carry out milestone I12 (web wave first, then the iOS wave). Follow the conventions in the handoff."
3. Before writing code, run the state check in §10 so nothing in this document is assumed stale — in particular, confirm the four PRs listed in §2.0 actually merged the way this document assumes, and confirm the two new database migrations from I11 were actually applied (§2.3).

Both repositories belong to `mariah-gill` on GitHub: `gradus-coach-start` (web + `/api/v1`, deployed by Lovable at https://gradus.training) and `gradus-ios` (the SwiftUI app, CI on GitHub Actions `macos-26`).

---

## 2. Where things stand

### 2.0 This document assumes four PRs merged since `docs/ios/handoff-I8-onward.md` was written

- Web [#86](https://github.com/mariah-gill/gradus-coach-start/pull/86) `feat/api-resources-ask` — I10 endpoints.
- Web [#88](https://github.com/mariah-gill/gradus-coach-start/pull/88) `feat/api-invoicing` — I11 endpoints.
- iOS [#15](https://github.com/mariah-gill/gradus-ios/pull/15) `feat/i10-resources-ask` — I10 screens.
- iOS [#16](https://github.com/mariah-gill/gradus-ios/pull/16) `feat/i11-invoicing` — I11 screens.

Also already merged before this session ended, independent of the four above: web [#87](https://github.com/mariah-gill/gradus-coach-start/pull/87) (urgent minor-safety hotfix, see §2.4) and iOS [#14](https://github.com/mariah-gill/gradus-ios/pull/14) (I9 push-permission close-out). If `gh pr list` in either repo still shows #86/#88/#15/#16 as open, stop and finish getting them merged before starting I12 — the state below assumes they are not.

### 2.1 Merged and on `main` (once §2.0 is true)

**Web (`gradus-coach-start`).** `/api/v1` carried 143 operations before #86/#88; both add new operations under `/api/v1/resources/**`, `/api/v1/coach/resources/**`, `/api/v1/ask`, `/api/v1/saved-answers/**` (I10) and `/api/v1/coach/athletes/{id}/rate`, `/api/v1/coach/invoices/**`, `/api/v1/coach/athletes/{id}/billing` (I11) — verify the exact count with the state check in §10, don't trust a number here. Everything through I9 is as described in `handoff-I8-onward.md` §2.1; add:

| Area | On main | Milestone |
|---|---|---|
| Resources and Ask Gradus | `GET /resources` (role-aware: coach/parent/athlete in one response, `{role, coach, parent, athlete}` with only one payload set — deliberately NOT a `z.discriminatedUnion`, see §6), `POST /resources/{id}/signed-url`, `POST /coach/resources`, `POST /coach/resources/upload-url`, `DELETE /coach/resources/{id}`, `POST /ask`, `GET/POST /saved-answers`, `DELETE /saved-answers/{id}` | I10 |
| Invoicing | `PUT /coach/athletes/{id}/rate`, `GET /coach/invoices` (paginated, cursor+limit), `GET /coach/athletes/{id}/billing`, `GET /coach/invoices/{id}`, `POST /coach/invoices/preview`, `POST /coach/invoices` (idempotent, Postgres-reservation-backed — see §6), `PATCH /coach/invoices/{id}/status`, `DELETE /coach/invoices/{id}` | I11 |

Web quality gates: `bun run build`, `typecheck`, `lint` (0 errors), `test` (349 on `feat/api-invoicing` at handoff time, will be higher on `main` post-merge — verify), `openapi` (CI fails if the committed file is stale). CI = GitHub Actions `build` + Semgrep.

**iOS (`gradus-ios`).** Packages, in addition to everything in `handoff-I8-onward.md` §2.1: `FeatureResources` (I10 — library, PDFKit viewer with local caching and share sheet, coach upload via Supabase signed-URL upload (not the voice-note bearer-token pattern), report-a-resource, Ask Gradus for coach/parent/**and athlete** personas with a hand-rolled line/block-oriented Markdown renderer over `AttributedString`, saved answers, Safe Sport panel preserved as a fourth segment for athletes), `FeatureInvoicing` (I11 — rate entry, the preview-then-create draft flow, invoice list/detail, mark paid/delete, native plain-text share via the OS share sheet, all writes online-only with no offline queue, gated behind Coach Pro/Club tier with a no-purchase entitlement note). Both are wired into existing surfaces, not new top-level tabs: Resources already had its own tab; Invoicing lives as a third "Billing" segment on the existing Roster screen (`RosterModel.Segment`) plus a "Billing" section on the athlete detail screen.

Milestones done: I1–I9 (per prior handoff) plus I10 Resources/Ask Gradus, I11 Invoicing.

### 2.2 Dark, unverified, or deferred — know these before claiming anything

Everything in `handoff-I8-onward.md` §2.2 still applies (API_V1_ENABLED off in production — confirmed 503 at handoff time; enrollment still pending; the other deferred items listed there). Add:

- **No real pass has been run for I10 or I11 against the Lovable preview.** Both were verified against the mock/preview dependency graph and full unit/integration test suites only (349 web tests, 47+ new iOS tests for `FeatureInvoicing` alone). The next real-preview pass (§4.2 of the prior handoff) should specifically exercise: Ask Gradus for an athlete persona (never tried against a live model before), the coach resource-upload signed-URL flow end to end, and the invoice create→idempotency-reservation path (the Postgres advisory-lock RPCs have never run outside `bun test` fakes).
- **The Ask Gradus athlete persona is new — the web has never shipped a UI for it.** iOS builds it (parent's `athlete.resources.index.tsx` on web still only has Library/Safe Sport). This was a deliberate PRD-driven scope decision (§7.9, and §103 "youth-safe Ask Gradus"), not an oversight — don't "fix" iOS back down to web parity here.
- **Minor-safety gate on Ask Gradus**: athletes under 18 (or with no birthdate on file — treated as unconfirmed, not assumed adult) cannot reach Ask Gradus or Saved Answers at all, enforced server-side (`resolveAskGradusAudience` in `src/lib/ask-gradus-audience.server.ts`, re-derives the caller's real role and age from a fresh DB read, ignores whatever `audience` the client sends) and mirrored client-side (the segments are hidden). This exists because of a real, now-closed production gap — see §2.4. If you touch anything in this path, re-read `src/lib/athlete-age.ts`'s `canAskGradus` doc comment first.
- **iOS invoicing UI is built open to any coach unless the tier gate from the last session's follow-up actually merged with #16** — confirm `InvoicingEntitlementGate` exists in `Packages/FeatureInvoicing/Sources/FeatureInvoicing/` before assuming this is handled; it was added as a same-PR follow-up commit, not a separate PR.

### 2.3 Action Mariah needs to take that isn't just "merge the PR"

- **Two new database migrations ship in web PR #88** (`supabase/migrations/20260908030000_idempotency_key_reservation.sql`, `20260908030100_invoice_lines_cross_invoice_unique.sql`) implementing the Postgres advisory-lock idempotency reservation and a cross-invoice unique index that prevents double-billing a lesson date. Per standing constraints, no Claude session applies migrations. **Merging #88 does not apply them** — per the existing gotcha in `handoff-I8-onward.md` §6, Lovable publish does not apply migration files from GitHub either; Mariah needs to separately ask Lovable to apply pending migrations after merge, or the idempotency/double-billing hardening this milestone was largely about is not actually live.
- Four unrelated PRs are sitting open on the web repo and were not touched this session: two stale docs-handoff PRs (`#71`, `#82` — `#82` is superseded by this very file) and four Dependabot version bumps (`#47`, `#49`, `#50`, `#51`). Not urgent; close or merge at her convenience.

### 2.4 A production incident this session, now closed — know the shape of it

Mid-session, while building I10's Ask Gradus feature, Mariah gave an explicit product/safety decision: Ask Gradus must be unavailable to athletes under 18. Implementing the gate surfaced that the underlying capability — a client-supplied `audience` field picking between a "parent" and "youth athlete" system prompt with zero server-side identity check — was **already live in production**, predating this session, on the web's pre-existing `src/lib/ask-gradus.functions.ts` (the endpoint backing the already-shipped coach/parent Ask Gradus UI). A signed-in minor athlete could have requested the youth persona directly, bypassing the fact their own UI never showed an Ask Gradus button. This was fixed same-day as a standalone hotfix (web PR #87, branched directly off `main`, merged) independent of the I10/I11 feature branches, then reconciled into I10's fuller implementation once #87 merged (two more real bugs found and fixed during that reconciliation — a discarded-error fail-open bug, and a `.limit(1)` that silently prevented Postgres from ever reporting a multi-row match, see §6). If you ever add a second entry point to an existing gated capability, grep for every caller of the underlying function, not just the one you're editing — that's exactly how this gap was created originally.

---

## 3. Working conventions (Mariah's rules plus the ones that earned their place)

Everything in `handoff-I8-onward.md` §3 still applies verbatim. Update these two:

- **Commit trailer is now `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`** (changed mid-session from the prior Fable 5.1 trailer via explicit system directive — use whatever the current session's own system prompt says, this will drift again).
- **Simulator split, new this session, permanent**: automated `xcodebuild build`/`xcodebuild test` verification runs go on **"iPhone 17 Pro Max"** (UDID `4E63D3FF-E87A-4129-9769-D0B994E9107A`), never on **"iPhone 17 Pro"** (UDID `4CD84707-49D6-4977-8494-D7E8BF340B62`), which is Mariah's own device for manual sign-in and testing. Running `xcodebuild test` against her simulator silently reinstalls a plain `localhost:8080`-pointed Debug build over whatever she has installed (a preview-pointed build, mid-session) and produces a confusing "-1004 can't connect" error with no obvious cause — this happened twice this session before the split became a standing rule. Boot the Pro Max first if it's not already up (`xcrun simctl boot 4E63D3FF-E87A-4129-9769-D0B994E9107A`); don't assume.
- New architectural conventions established this session, keep them:
  - **Money-critical writes are online-only, no offline queue** — a deliberate, narrow exception to I9's "every write queues offline" rule. `InvoicingModel`'s four writes (setRate, createInvoice, setStatus, deleteInvoice) check connectivity up front every time and refuse with a clear message if offline, rather than enqueueing to the outbox like Roster/Plans do. Apply the same exception to any future milestone that touches real money or an irreversible financial state.
  - **Idempotent creates that are genuinely safety- or money-critical use a Postgres advisory-lock reservation** (`reserve_idempotency_key`/`complete_idempotency_key`/`release_idempotency_key`, `src/lib/api/idempotency.ts`), not the older simple select-then-upsert `withIdempotency` alone — the simple version has a real check-then-run-then-store race (two near-simultaneous requests with the same key can both slip through) that the reservation closes. Use `idempotent: true` on `defineApiRoute` as before; the reservation upgrade is inside `withIdempotency` itself now, nothing route-level changes.
  - **Entitlement gating (a paid-tier-only feature) is client-side UI only, no server enforcement, and never a purchase button** — established for I10's coach-upload gate (`canUpload` on the resources feed) and I11's invoicing gate (`effectiveTier` read fresh on every check, not cached for the session — a stale cache was a real bug caught by review). The pattern: read the coach's real `effectiveTier` (reuse `AccountRepository.coachBilling()`, don't build a second fetch), show the real content only for `coachPro`/`club`, otherwise a short neutral note ("X unlocks Y. Manage your plan on the web.") with a tappable link only on the US storefront (`Storefront.current`, mirror `CoachPlanView.swift`), plain text elsewhere. Per PRD §6.8, never anything resembling a purchase flow in this note.

---

## 4. Tooling and commands (do not re-derive)

Everything in `handoff-I8-onward.md` §4 still applies. Corrections and additions:

### 4.1 iOS test/build invocation, corrected

The old handoff's `xcodebuild test` example targets `iPhone 17 Pro` — **do not use that device for automated runs anymore** (§3). Use:

```bash
xcodebuild test -project Gradus.xcodeproj -scheme Gradus \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max'
```

The old handoff also notes `GradusTests` needing `CODE_SIGNING_ALLOWED=NO` to get past a codesign error — **that root cause is now fixed** (`GradusTests` target in `project.yml` gained `GENERATE_INFOPLIST_FILE: YES` this session, on the I11 branch). If `xcodebuild test` on `main` still fails at the codesign step with "Cannot code sign because the target does not have an Info.plist file," the fix didn't merge cleanly — check `project.yml`'s `GradusTests` target settings before reaching for the `CODE_SIGNING_ALLOWED=NO` workaround again.

### 4.2 Launching a preview-pointed build for Mariah to sign into (unchanged mechanics, corrected device)

Only ever install this on **her** simulator (iPhone 17 Pro, `4CD84707-49D6-4977-8494-D7E8BF340B62`), never the Pro Max:

```bash
xcodebuild build -project Gradus.xcodeproj -scheme Gradus \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath /tmp/gradus-preview-build \
  GRADUS_API_BASE_URL=<preview host, no trailing path or token>
xcrun simctl install 4CD84707-49D6-4977-8494-D7E8BF340B62 \
  /tmp/gradus-preview-build/Build/Products/Debug-iphonesimulator/Gradus.app
xcrun simctl launch 4CD84707-49D6-4977-8494-D7E8BF340B62 training.gradus.app \
  -GradusPreviewToken <token>
```

Default simulator signing ("Sign to Run Locally") is sufficient — no explicit `CODE_SIGN_IDENTITY` override needed, contrary to what the prior handoff implies. Getting the preview host/token: ask Mariah for her current Lovable shared-preview link (Share → Share preview → Create new preview link — the *share* link, not a `lovable.dev/preview/...` editor link she might paste instead), open it in the Browser tool, and read the real preview URL + `__lovable_token` out of the page's own embedded iframe (`document.querySelectorAll('iframe')[0].src`) rather than assuming the pasted link's shape — a `lovable.dev/preview/...` link is Lovable's own dashboard viewer, not the standalone host the app needs; the token is embedded inside it and needs extracting. Pass only the JWT itself as the launch argument, not any trailing `&__lovable_badge=...` the iframe URL also carries.

---

## 5. Architecture patterns to copy

Everything in `handoff-I8-onward.md` §5 still applies exactly. Two additions from this session:

- **A "one of N shapes" API response is a plain object with N named nullable fields, never `z.discriminatedUnion` or `z.union`.** `zod-to-openapi` does not emit the OpenAPI `discriminator` keyword for a Zod discriminated union, so `swift-openapi-generator` falls back to an unlabeled `Case1Payload`/`Case2Payload`/`Case3Payload` enum instead of named cases — confirmed for I10's role-aware `GET /resources` and for the pre-existing `InviteResolution` union (same limitation, already in production, not worth retrofitting). Use `{ role, coach: X | null, parent: Y | null, athlete: Z | null }` with exactly one field set instead — every generator handles a plain optional field cleanly.
- **A Supabase query whose result you read for its content (not just existence) must never chain `.limit(1)` before `.maybeSingle()`.** `.limit(1)` caps the HTTP response server-side to one row, which means postgrest-js's client-side cardinality check (`data.length > 1` → the `PGRST116` "multiple rows" error) can never fire — a duplicate row (nothing in this schema's `athletes` table stops one `user_id` from having two rows) gets silently, arbitrarily resolved to whichever row Postgres happened to return, with no error. Fine for a pure existence check (`GET /me`-style role resolution, where any matching row gives the same answer); a real, confirmed bug for anything that reads a field off the row to make a decision (this session's instance: an athlete's birthdate, feeding the minor-safety age gate). Drop `.limit(1)` and let `.maybeSingle()` see the true row count whenever the query's result content matters, not just whether it returned something.

---

## 6. Gotchas learned (do not rediscover)

Everything in `handoff-I8-onward.md` §6 still applies. Add:

- The two Swift-codegen/DTO-shape items and the `.limit(1)` item are covered above in §5 as patterns to copy, not just gotchas to avoid — read them there.
- **`Workflow` script authoring**: a CONTEXT/prompt string built as a JS template literal cannot contain a literal backtick or an unintended `${...}` — both get interpreted as real JS, not prose, and the whole script fails to parse (or, worse, silently interpolates a wrong/undefined value) before any agent runs. Hit this twice this session (a stray `` ` `` used for markdown-style code-span emphasis in prose, and a quoted error message containing `${var}`-looking text). Write prompt prose in plain text or single quotes; reserve backtick template literals' own `${}` strictly for genuine, in-scope JS variables.
- **Concurrent `xcodebuild`/git operations on the same working tree from two different agents (a running Workflow and you, directly) will collide.** If you need to make a direct edit to a repo a Workflow is actively using, either wait for it to reach a clean phase boundary and stop it there (`TaskStop`, then resume with `resumeFromRunId` after editing the script — completed phases replay from cache, nothing is lost) or wait for it to finish outright. Don't run `git commit`/`xcodegen generate` yourself against a checkout a background workflow might still be mid-edit on.
- Getting a Lovable "shared preview" link right matters (§4.2) — the link a person pastes from their browser address bar while looking at a preview in the Lovable editor is not the same as the dedicated Share-preview link, and neither is directly usable as `-GradusPreviewToken`'s value without extracting the real iframe URL.

---

## 7. Remaining milestones and what each needs

Order is PRD §10.2. I1–I11 done (per §2 above). Each milestone: web wave (if any) as one PR per domain against web `main`, branched fresh from `origin/main`; iOS wave as one PR against iOS `main`; adversarial review before handover (this session ran two review lenses minimum per milestone, verified each finding with three independent skeptics requiring majority agreement — keep that bar); contact sheet; daily update.

### I12 — Competitions and recaps (3.4) — next

**Web wave — Appendix A "Live Board and competitions" (the competitions/recaps rows; Live Board itself already shipped in I2).** None of these exist yet:
`GET /competitions/finished` · `POST /competitions/{id}/skater-matches` · `POST /athletes/{id}/competition-links` · `DELETE /athletes/{id}/competition-links/{linkId}` · `GET /athletes/{id}/competition-results` · `POST /athletes/{id}/competition-results/{resultId}/generate-plan` · `GET /coach/post-event` · `POST /coach/post-event/{id}/dismiss` · `GET /coach/competitions/{id}/roster` → `listFinishedCompetitions`, `listSkaterMatches`, `linkAthleteToSkater`, `unlinkAthleteCompetition`, `getAthleteCompetitionResults`, `generatePlanFromResults`, `getCoachPostEventItems`, `dismissCoachPostEvent`, `listCoachRosterForCompetition`.
Plus the recap flow: `GET /recaps/pending` · `POST /recaps/{id}/dismiss` · `GET /recaps/coaches?athleteId` · `POST /recaps` `[idem]` · `GET /athletes/{id}/recaps` → `getPendingCompetitionRecap`, `dismissCompetitionRecap`, `getRecapCoaches`, `submitCompetitionRecap`, `getAthleteCompetitionRecaps`.
Read PRD §7.10 ("Live Board, competition results, and recaps") for the full feature table and priorities before starting — competition results linking and the post-event prompt are P1, the attendance/recap-prompt plumbing described there as already-existing is from I2's Live Board work, not new. Find the existing web source functions with `grep -rln "listFinishedCompetitions\|generatePlanFromResults\|submitCompetitionRecap" src/lib` and extract them the same way every other milestone did (§5.1 of the prior handoff) — do not assume they don't exist yet, this is likely extraction from already-shipped Lovable-era web code, same as I10's resources and I11's invoicing both turned out to be.

**iOS wave.** Results linking UI (coach matches a rostered athlete to a finished competition's skater entries), the athlete detail "stacked folders" results view, "generate plan from results" (opens the existing I6 plan editor pre-seeded), the post-event "link your athletes" prompt card, the recap prompt and sheet (`AppRoute.recap` already exists per the prior handoff — confirm it's still there and what it currently does, since nothing has used it yet), recap messages posting into the existing messaging thread (I3).

Money/safety judgment calls likely to come up, informed by this session's I10/I11 experience: none of this touches real money, so the online-only-writes exception (§3) probably doesn't apply — default back to normal offline-queue behavior unless something here turns out to be genuinely irreversible in a way that matters. If the recap flow or results-linking has any per-athlete-age distinction (a minor's recap visible to a parent differently than an adult athlete's own), treat it with the same conservative "unconfirmed → don't assume the permissive case" posture this session applied to Ask Gradus (§2.2) — ask Mariah rather than guess if it's ambiguous.

### I13 — Guardians, team, visibility, celebration (3.5)
Unchanged from `handoff-I8-onward.md` §7 — not started.

### I14 — Import, share, starters, connections hub, in-app reset (3.6, 3.7)
Unchanged from `handoff-I8-onward.md` §7 — not started.

### I15 — Widget, lesson reminders, App Attest (3.8)
Unchanged from `handoff-I8-onward.md` §7 — not started.

### I16 — Hardening and submission of native 2.0 (Phase 4, 3.9)
Unchanged from `handoff-I8-onward.md` §7 — not started. `docs/ios/QA.md` still does not exist; still needs writing before this milestone.

### T1 / C1 — at enrollment (any time; take next when it lands)
Unchanged — still gated on Apple Developer enrollment (D-U-N-S applied 2026-08-29, was tracking to land ~October 2026 as of the prior handoff; check with Mariah for a status update, don't assume the date).

---

## 8. Decisions that need Mariah (ask at the right moment, not up front)

Everything in `handoff-I8-onward.md` §8 still open. Add:

- Applying the two new I11 migrations after #88 merges (§2.3) — she needs to trigger this via Lovable, no session can.
- Whether the Ask Gradus athlete persona (iOS-only right now, §2.2) should also ship on the web, or stay iOS-exclusive — not asked this session, purely additive so far, but worth surfacing once she's looked at it.
- Whether the four stale/unrelated open web PRs (§2.3) should be closed, merged, or left alone.

---

## 9. Follow-ups and debt carried over (small, do them when nearby)

Everything in `handoff-I8-onward.md` §9 still applies (none of it was touched this session). Add:

- iOS `AthleteBillingSection`/`BillingRosterSection` (I11) both independently re-derive money formatting and share-text building from the same source (`InvoiceFormatting.swift`, `GradusCore/Invoicing/`) — that's correct and shared already, not debt; noted here only so a future refactor doesn't assume otherwise and duplicate it again.
- The web's `InvoiceGenerateBody` (`invoice-generate-sheet.tsx`) has a client-only "sample invoice" fixture system for its demo/sample athlete (`isSampleAthlete`, `buildSampleInvoiceDraft`, `addSampleInvoice`) so the sample athlete gets a fully interactive fake invoice flow on web. iOS's I11 build deliberately did not replicate this — it just hides invoicing entirely for the sample athlete (matching the athlete-detail integration's existing pattern) rather than building a parallel fixture system. If Mariah wants the fuller web-parity demo experience on iOS, that is new scope, not a bug.

---

## 10. First concrete steps for the fresh session

1. State check: confirm §2.0's four PRs are merged (`gh pr list` in both repos should not show #86/#88/#15/#16 as open). `git -C ~/Developer/gradus log --oneline -1 origin/main` and `git -C ~/Developer/gradus-ios log --oneline -1 origin/main`. Re-count `docs/api/openapi.json` operations. `cat ~/Developer/gradus-ios/Contract/SOURCE_COMMIT` and confirm it matches web `main`'s current HEAD (re-run `scripts/sync-contract.sh` if not). Confirm `curl -s https://gradus.training/api/v1/meta/config` is still 503 `api_disabled`. Confirm the two I11 migrations were applied (ask Mariah, or check the `api_idempotency_keys`/`invoice_lines` schema for the new function/index if you have a way to check without a live DB connection — you likely don't; just ask).
2. Boot the two simulators if neither is up: iPhone 17 Pro Max (`4E63D3FF-E87A-4129-9769-D0B994E9107A`) for your own verification, iPhone 17 Pro (`4CD84707-49D6-4977-8494-D7E8BF340B62`) only if Mariah is about to use it herself — don't boot it preemptively for no reason.
3. Read PRD §7.10 and Appendix A's "Live Board and competitions" rows, and the web files behind the operation names listed in §7 above.
4. I12 web wave on `feat/api-competitions-recaps` (or split into two branches/PRs if results-linking and recaps turn out to be cleanly separable domains — your call once you've read the source) from `origin/main`: extract → wrap → routes → schema → `scripts/openapi.ts` → `bun run build && typecheck && lint && test && openapi` → tests → adversarial review (find → verify with independent skeptics → fix) → PR to `main`.
5. I12 iOS wave on `feat/i12-competitions-recaps` from `origin/main`: `GRADUS_WEB_DIR=~/Developer/gradus scripts/sync-contract.sh` (pins the web branch commit until it merges) → build the screens → full suite on iPhone 17 Pro Max → mock walk-through with a contact sheet → adversarial review → PR to `main` → daily update.
6. If enrollment lands at any point, stop and take T1/C1 (§7).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
