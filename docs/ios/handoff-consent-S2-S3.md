# Handoff — consent, adult verification and SafeSport: from S1 to S2/S3 (`gradus-ios` + `gradus-coach-start`)

> **Historical snapshot (2026-09-25), merged 2026-10-07 for reference.** S2 and S3 are built and merged (web #170/#171/#174, gradus-ios #89/#90/#94), and S4/S5 followed (S5 renamed the stored method `kws_card` to `kws`). The design notes below still explain the shape of the consent code, but the code on `main` is the source of truth, and the "next steps" and "owed" lists are out of date. For the current state, read `docs/ios/handoff-2026-10-05.md` first, then `handoff-2026-10-04.md` and `handoff-remaining-prd.md`.

**For:** a fresh Claude Code session that will build S2 (the iOS consent flows) and S3 (Apple's age signals) on top of the S1 backend that is now on `main`.
**Written:** 2026-09-25, at the end of the session that designed the consent work with Mariah (PRD decisions #29–#33), built S1 as three web PRs, reviewed and merged them.
**Read first, in this repo:** `docs/ios/PRD.md` §6.13 (the design), §10.9 (milestones S1–S5), §12 #23–#27 (resolved decisions and the two that remain), §7.1/§7.2/§7.5/§7.7/§7.8 rows marked *2026-09-24*, Appendix A "Invites and connections" and "Consent webhooks". Then `docs/legal/privacy-policy-brief-2026-09-24.md` §6 and §8 (what counsel is being asked), `docs/ios/app-store-submission.md` §5 and §7 (the age-assurance answer and review note 6). `docs/ios/handoff-testflight.md` (web PR #151, written by another session the same day) covers the first TestFlight build and general QA; this file covers only the consent work and does not repeat it. `docs/ios/handoff-preQA.md` §3–§6 (conventions, tooling, patterns, gotchas) still apply and are not repeated in full.

---

## 1. How to start the fresh session

1. Open Claude Code with `~/Developer/gradus` as the working directory; the iOS repo is the sibling checkout at `~/Developer/gradus-ios`. Do not work on the shared checkout's current branch: make a worktree (`git worktree add ~/Developer/gradus-wt/<name> -b <branch> origin/main`) and verify `git branch --show-current` before every commit. Other sessions share `~/Developer/gradus`.
2. First message: "Read docs/ios/handoff-consent-S2-S3.md and PRD §6.13, then carry out S2 (iOS consent flows). Follow the conventions in the handoff." S3 follows S2; S4 and S5 are small and mostly Mariah's.
3. Before writing code, run the state check in §10. In particular confirm the migrations are applied (§2.3) and re-sync the iOS contract (§4.2), because the pinned contract in `gradus-ios` predates every S1 endpoint.

---

## 2. Where things stand (2026-09-25)

### 2.1 Decisions Mariah made (do not re-ask)

PRD §0 #29–#33, all 2026-09-24:

- **#29** Every parent account linked to a minor is verified as an adult **once**, through Kids Web Services (KWS, Epic Games) Parent Verification, **payment card only** in the US.
- **#30** Under-13 athletes never create their own account; the parent starts it and the child joins with the parent's code. **Coaches invite the parent, never the athlete, for anyone under 18** or with no birthdate on file.
- **#31** A 13–17 self-sign-up is **provisional** (goals and plans visible; no coach connection, no rooms) until a verified guardian claims it. A room with a minor opens only with a verified adult who is not the coach as a participant. The email mirror to unclaimed guardians is retired once the switch is on.
- **#32** Athletes under 18 send **text only**: no voice notes, no dictation. Coach voice notes to a minor keep their transcripts. No separate consent scope for transcription.
- **#33** Apple's signals: Declared Age Range (tighten-only), PermissionKit significant-change asks, the StoreKit age-rating watcher, `RESCIND_CONSENT`. A coach SafeSport-training attestation at onboarding was **declined**.
- §12 #25: unclaimed provisional accounts are deleted after **3 months**. §12 #27: parents that existed before the S1 migration are marked `legacy` and are **never prompted or gated**.

### 2.2 Merged and on `main`

Web, all merged 2026-09-25 in this order, each rebased onto `main` after the previous squash:

- [#146](https://github.com/mariah-gill/gradus-coach-start/pull/146) PRD amendment (decisions, §6.13, §10.9, risks #22–#26, §12 #23–#27, submission kit, privacy brief).
- [#148](https://github.com/mariah-gill/gradus-coach-start/pull/148) backbone: migration `20260924200000_parent_verification`, `src/lib/kws.server.ts`, `src/lib/guardian-verification.server.ts`, the verification endpoints, `POST /api/public/webhooks/kws`, the `/verified` page, the retention hook and cron, `/me` and settings DTO fields, the demo seeder marks its parent verified.
- [#149](https://github.com/mariah-gill/gradus-coach-start/pull/149) rules: migration `20260924210000_consent_rules` (minors cannot upload to the voice-notes bucket), athlete states, the room rule in `ensureRoom*`/`sendMessage`, coaches-invite-the-parent, text-only minors, the parent pause endpoint, the gates, the COPPA direct notice in the guardian invite email.
- [#150](https://github.com/mariah-gill/gradus-coach-start/pull/150) UI: birthdate-first athlete entry with the under-13 parent-only screen, the shared `ParentVerificationStep`, the pause control, the waiting-for-parent notice, the text-only composer, coach add-athlete and schedule import always invite the parent.

Then `d7180075 Applied pending migrations` (Lovable's bot): both S1 migrations applied and `src/integrations/supabase/types.ts` regenerated with the new tables and columns. Treat that as confirmation the schema is live, but still run the SMOKE precheck (§2.3).

iOS: [#69](https://github.com/mariah-gill/gradus-ios/pull/69) merged (Apple team `79RN82HXPZ`, the App Attest entitlement). Nothing from S1 exists on iOS yet. The contract pin in `gradus-ios/Contract/SOURCE_COMMIT` is `b8845f8c`, which predates every S1 endpoint.

Apple account side (done by Mariah and the "iOS app PRD open items" session): the App ID `training.gradus.app` now carries Push Notifications, Associated Domains, Sign in with Apple, App Groups, App Attest and **Declared Age Range**. The AASA app paths include `/verified` and `/verified/*` (web #147, amended).

### 2.3 Owed on Mariah's side

- **SMOKE precheck** in `docs/api/SMOKE.md` after the migrations: the query now has `guardian_consents`, `webhook_receipts` and `protect_parent_verification_columns()`; every column must be non-null.
- **KWS developer account** (Epic developer portal, dev.epicgames.com/portal → Kids Web Services → Parent Verification). Mariah said she will create it later. Until then `POST /guardian/verification/start` answers `not_configured`, and the switch stays off.
- **`PARENT_VERIFICATION_REQUIRED`** (Lovable Cloud secret) stays unset. It is the only thing that turns on the gates and the room rule (§5.2). Never set it from a Claude session; that is Mariah's call, after KWS is live and the demo parent is confirmed verified.
- One product question is open (§8 item 1): the web composer's microphone was dictation, not voice notes; it was removed for minors as part of #32. Mariah has not confirmed that reading.

### 2.4 Dark, unverified, or deferred — know these before claiming anything

- **KWS end to end.** No account exists, so the card check, the webhook, and the `/verified` redirect have only been exercised with signed fixtures in tests. The send-email endpoint's exact path is in KWS's portal-gated API spec; the code assumes `/v1/verifications/send-email` under `KWS_API_HOST` and lets `KWS_SEND_EMAIL_URL` override it. Confirm at go-live.
- **Messaging paths against a live database.** `sendMessage` and the three `ensureRoom*` openers use the module-level admin client and are covered only through `athleteRoomGate` unit tests, not integration tests.
- **The web screens against a real backend.** Athlete entry and `/verified` were rendered locally; the wizard, claim page, pause control and composer states were checked by reading, not clicking (no service key locally).
- **S3's web half** (`POST /api/public/webhooks/app-store` for `RESCIND_CONSENT`) does not exist yet; `athletes.account_state = 'paused'` and its refusals do.

---

## 3. Working conventions (Mariah's rules plus the ones that earned their place)

- Milestones, never dates or durations. Report in milestones with one daily update.
- Never merge web or iOS PRs, never publish in Lovable, never apply migrations, never flip `API_V1_ENABLED` or `PARENT_VERIFICATION_REQUIRED`. Today's merges were under an explicit one-off authorization ("merge them in order"); do not assume it carries over.
- One web PR per domain where the pieces can stand alone. When they cannot (S1 needed schema → rules → UI), stack them, say so in every PR body, and merge bottom-up: after the lower PR squashes, `git rebase --onto origin/main <last commit of the lower branch> <upper branch>`, force-push with lease, retarget the PR to `main`. **After a lower branch has been rewritten, rebase the upper one from its *old* parent commit, not the rewritten one** — the first attempt on #150 used the new rules head and tried to replay the whole chain.
- Review before merge: a full pass over the stack found eight real defects on 2026-09-25 (§6). Do the pass; the rules are cheap to get subtly wrong.
- Web guardrails (PRD §4.1): a change that would break the current web flow ships behind the switch or together with its UI. The always-on rules (§5.2) were judged safe because their server messages surface as plain errors in the old screens.
- iOS: automated `xcodebuild` on the **iPhone 17 Pro Max** simulator only, never Mariah's iPhone 17 Pro; `.alert`, never `confirmationDialog`; every new screen passes the audit harness (WCAG AAA + VoiceOver) before it is called done.
- Do not run prettier on `src/integrations/supabase/types.ts`. It is generated; hand-add entries in the generator's own style (no semicolons) when a migration lands before Lovable regenerates, and expect Lovable's next regeneration to replace the file.

---

## 4. Tooling and commands (do not re-derive)

### 4.1 Web repo

- Checks that CI runs: `bun run lint`, `bun run typecheck`, `bun test`, `bun run openapi` (fails CI if `docs/api/openapi.json` is stale), `bun run build`. The build regenerates `src/routeTree.gen.ts`; run it after adding any file under `src/routes/`, and commit the result.
- Local dev server for the static screens: `API_V1_ENABLED=true bun run dev` on port 8080 (a launch config `gradus-web-s1` pointing at `~/Developer/gradus-wt/s1` exists in the Desktop session's `.claude/launch.json`; adjust the path for a new worktree). Auth-backed routes 500 locally; there is no service-role key in any session.
- Server-side unit tests use in-memory Supabase-shaped fakes. Two shapes exist: the chainable one in `guardian-verification.server.test.ts` (supports `select/eq/is/lt/in/order/limit/maybeSingle`, inserts with a unique index, `auth.admin.getUserById`) and the older `fakeClient` in `parent-settings.server.test.ts` and `parent-signup.server.test.ts` (no `.is()`). Code that must run under both filters in JS instead of chaining `.is()`.

### 4.2 iOS repo

- Contract sync: `scripts/sync-contract.sh` vendors `docs/api/openapi.json`, `design-tokens.json` and `vectors/*.json` from the web repo at a pinned commit into `Contract/`, writes `Contract/SOURCE_COMMIT`, then runs `generate-client.sh` (swift-openapi-generator) and `generate-colors.sh`. Pin to the web `main` commit that includes #150 or later.
- After the sync, expect generated enum changes: the `POST /rooms/{id}/messages` failure `reason` gains `guardian_required | provisional | paused | paused_by_parent | text_only`; `GET /me` gains `parentVerification` and `athleteAccountState`; parent settings gain `verification` and per-athlete `accountState`, per-coach `messagingPaused`; guardian status gains `accountState`; the room header gains `messagingPausedByParent` and `viewerTextOnly`; three new operations `startParentVerification`, `getParentVerificationStatus`, `completeParentVerification`, and `setParentAthleteCoachMessagingPause`.
- Tests and builds: always to a log file (a piped `xcodebuild` hides its exit code), per `handoff-preQA.md` §4.2.

### 4.3 KWS (when the account exists)

- Secrets (Lovable Cloud): `KWS_CLIENT_ID`, `KWS_API_KEY`, `KWS_API_HOST` (or `KWS_SEND_EMAIL_URL`), `KWS_WEBHOOK_SECRET`, `KWS_VERIFICATION_SECRET`; optional `KWS_TOKEN_URL`, `KWS_WEBHOOK_SECRET_PREVIOUS`, `KWS_VERIFICATION_SECRET_PREVIOUS` during a rotation. Test and production are different sets.
- Portal configuration: webhook URL `https://gradus.training/api/public/webhooks/kws`; redirect URL `https://gradus.training/verified`; verification methods: payment card only; product goes live only after KWS reviews it.
- Limits: KWS allows ten send-email calls per hour per parent email and requires a non-empty `user-agent`; our route allows six per hour per user and re-uses an email sent in the last 60 s.

---

## 5. Architecture patterns to copy

### 5.1 The S1 layering (web)

- `src/lib/kws.server.ts`: a pure client. Config from env (null when absent), OAuth client-credentials token, `send-email` with exponential-backoff retries on 5xx, HMAC checks for the webhook (`timestamp.rawBody`, header `x-kws-signature`) and the redirect (`status:externalPayload`, query `signature`), both accepting a rotated secret, and the `externalPayload` codec (`{"p": parentId, "u": userId}`).
- `src/lib/guardian-verification.server.ts`: every rule, with `env` injectable and the admin client passed in, so tests run against fakes. Routes and `*.functions.ts` wrappers are thin. Read this file before touching anything consent-related; its doc comments say why each branch exists.
- The two channels for one verification carry the same KWS `transactionId` under different `webhook_receipts.source` values (`kws`, `kws_redirect`); `recordParentVerification` is idempotent on `(source, external_id)`, and marking a parent verified twice is harmless.
- `activateAthletesForVerifiedParent` runs after any verification (KWS or admin): provisional athletes turn active and the ledger gets `parent_created` consent for all of the parent's athletes. The guardian claim writes `guardian_claim` consent itself.

### 5.2 What the switch does and does not gate

`PARENT_VERIFICATION_REQUIRED=true` is the only rollout switch. Read `verificationRequired()`; the DTO field `required` mirrors it for clients.

| Always on since #149 | Only with the switch on |
|---|---|
| Under-13 self-sign-up refused (422 `parent_required`) | The room rule for minors: a room opens or accepts a send only with a verified parent linked (403 / `guardian_required`) |
| 13–17 self-sign-ups start `provisional`; connecting a coach answers 403 `provisional`; the guardian claim activates | `assertParentVerified` gates: guardian claim, merge-claim, co-guardian (team) claim, the parent's coach links at sign-up and in Settings (403 `parent_unverified`) |
| Coaches invite the parent for anyone under 18 or with no birthdate (422) | Athlete login codes minted and shown only once the parent is verified |
| Minors send text only (`text_only`); the bucket refuses their uploads | The email mirror to unclaimed guardians stops |
| The parent pause (`paused_by_parent`, both directions) and `paused` accounts | |

With the switch off, `parentVerificationSatisfied()` is true for everyone, consent rows are still written (evidence `not_required`), and `available` tells clients whether KWS is configured.

### 5.3 The redirect channel, for iOS

KWS sends the parent to `https://gradus.training/verified?status=<json>&externalPayload=<json>&signature=<hex>[&signature=<hex>]` after the card check. The web page forwards the three raw query values to `POST /api/v1/guardian/verification/complete` (public; the HMAC is the trust anchor). iOS must do the same when the universal link opens the app: forward `status`, `externalPayload` and **every** `signature` value untouched (never re-serialize the JSON), then refresh the verification status. The webhook usually lands first, so the app can also simply poll `GET /guardian/verification/status` every 5 s while `requestedAt` is set.

### 5.4 The single room gate

`athleteRoomGate(admin, athleteId, coachId)` returns `{ restriction, minor }`. Every place that opens or sends in an athlete room calls it: `ensureAthleteRoom`, `ensureRoomForMyAthlete`, `ensureRoomForTarget` (403 with the restriction as the code) and `sendMessage` (an `ok: false` result with the same reason). `roomHeader` uses it to set `messagingPausedByParent` and `viewerTextOnly`. Do not add a second age or pause check anywhere; extend this one.

### 5.5 Error codes clients must handle

`parent_unverified` 403 (start verification, then retry), `parent_required` 422 (under 13), `provisional` 403 (waiting on the parent), `paused` 403, `guardian_required` 403 and `paused_by_parent` 403 on the room openers, `verification_unavailable` 503 (KWS down or misconfigured; retry later), `not_found` 404 on the pause endpoint for a coach that is not linked. The send endpoint never errors for these; it answers `ok: false` with `reason` and a `message` to show verbatim.

---

## 6. Gotchas learned (do not rediscover)

- The web composer's microphone is **dictation** (audio → text via `voiceTranscribe`), not a voice note. iOS sends real voice notes (`audioPath` uploaded by the client). For S2, hide the recorder for `viewerTextOnly` **before** the upload is attempted: the bucket policy refuses a minor's upload and the send answers `text_only`, but both surface as errors if the UI still offers the mic.
- KWS's "Verification Response" is not a POST: it is the signed **redirect** query on the URL you configure. Do not build a second webhook receiver for it.
- `.limit(1).maybeSingle()` on a query whose row content you read hides duplicates (PGRST116 can never fire). The `/me` athlete query lost its `.limit(1)` for that reason.
- The stacked-squash gotcha applies to *every* stacked PR; see §3 for the rebase rule and the old-parent trap.
- Prettier on `types.ts` produced a 7,300-line diff once. Never again.
- `provisionalCutoff` clamps month ends (May 31 − 3 months is Feb 28, not Mar 3). The window may only err on the long side.
- The consent ledger's `parent_id` is nullable with `ON DELETE SET NULL`; a parent's account deletion revokes (reason `parent_account_deleted`) and keeps the rows. Only an athlete's own erasure removes them.
- The retention sweep writes a `deleted_accounts` tombstone with `initiated_by: 'retention'`, a new value; admin screens that assume `self | admin` need to tolerate it.
- Co-guardians can pause a coach only while the Team plan is active (`resolveAthleteAccess(...).canWrite`), the same rule as goal editing.
- `isMinorOrUnconfirmed` (in `src/lib/athlete-age.ts`) is the conservative helper for every safety gate: missing or unparseable birthdate counts as a minor. `isMinorBirthdate` in the same file is for labels and treats a missing date as an adult. `guardian-claim.server.ts` still has its own `isMinorConservative` with the same semantics; leave it.

---

## 7. Remaining milestones and what each needs

### S2 — iOS consent flows (next)

Contract sync first. Then, in `gradus-ios`:

- **`/me`**: read `parentVerification` and `athleteAccountState`; keep them in the session model so every screen below can branch without another call.
- **Parent onboarding** (`FeatureOnboarding/ParentOnboardingModel.swift`, `Step` is `loading, profiles, goals(Int), schedule(Int), done`): after the profile step creates the parent, when `parentVerification.required && !verified` insert a `verify` step: explain, `startParentVerification`, show "check your email" with a 60 s resend, poll `getParentVerificationStatus` every 5 s, resume on the `/verified` universal link (§5.3), then continue. When `available` is false, say verification is not switched on yet; do not block the rest of onboarding. The athletes entered wait in the model until the link lands (the web keeps them in state the same way).
- **Guardian claim** (`FeatureGuardians/Claim/GuardianClaimFlow.swift`, states `checking/failed/invalid/alreadyClaimed/live/done`): for a known parent, show the same verify step before the claim button when required and unverified; on a `parent_unverified` error from the claim, show the step and re-run the claim when it completes (the claim already created the profile, which is what the KWS email is bound to).
- **Athlete entry** (`FeatureOnboarding/AdultOnboardingModel.swift` and the invite entry): birthdate first; under 13 → a parent-only screen with the share sheet ("Send my parent an invite") and "I already have my parent's code", remembered for the launch, nothing stored; 13–17 → the parent-email field with the provisional copy (own goals and plans now; coach and messages after the claim); the server's 422 `parent_required` and 403 `provisional` messages shown verbatim as the safety net.
- **Athlete Settings**: the "Waiting for your parent" notice when `accountState == provisional`, next to the existing guardian-email row and resend.
- **Messaging** (`FeatureMessages/Components/Composer.swift`, `room.record`): hide the recorder when `viewerTextOnly`; replace the composer with the paused notice when `messagingPausedByParent` (parent copy: "Resume it from Settings"); decode the new `reason` values and show `message` verbatim. Make the generated enum tolerant of unknown cases if the generator produces a strict enum.
- **Parent Settings → Coaches**: "Pause messaging" / "Resume messaging" per coach through `setParentAthleteCoachMessagingPause`; show the paused state in the row; login code row says the code appears once the parent is verified when `inviteCode` is null and verification is required.
- **Coach roster** (`FeatureRoster/Components/NewAthleteSheet.swift`, which still offers "The athlete (18+)" as recipient): remove the recipient picker unless a birthdate of 18+ is entered; the server refuses anything else. Show "waiting for parent" on roster rows whose guardian is unclaimed.
- **Mocks** in `Gradus/Dependencies.swift`: add `parentUnverified` (required, not verified, available), `parentUnverifiedNoKws` (required, not available), `athleteProvisional`, `roomPausedByParent`, and make `athleteMinor` carry `viewerTextOnly`.
- **QA rows** in `docs/ios/QA.md` §1, §4 and §6 for every rule above; audit harness (AAA + VoiceOver) on every new screen.
- Done when: the simulator round-trips each flow against the Lovable preview with the switch off (the states render, the always-on rules bite), and the mocks show the switch-on states. The KWS card check itself waits for Mariah's account.

### S3 — Apple signals (iOS, plus one web endpoint)

- `com.apple.developer.declared-age-range` in `Gradus/Gradus.entitlements` (the capability is already on the App ID). Request the range at the sign-up entry and on launch with gates 13, 16 and 18. **Tighten only**: a device band under 18 blocks coach, parent and adult-athlete sign-up on that device and routes to the minor entry; under 13 routes to the parent-only screen; `declinedSharing` and `notAvailable` (iOS 18–25) fall back to the birthdate path and never block (App Review rejects apps that do). A self-declared 18+ never loosens anything.
- PermissionKit `SignificantAppUpdateTopic` when the age rating changes on the device (the StoreKit age-rating property Apple added in 26.2) or when a gated feature changes; `CommunicationTopic` is post-1.0 (§12 #26).
- Web: `POST /api/public/webhooks/app-store` for App Store Server Notifications V2 (`signedPayload` JWS, verify against Apple's root certificates; `notificationUUID` as `webhook_receipts.external_id` with source `app_store`). On `RESCIND_CONSENT`: `account_state = 'paused'` for the athlete, `revokeGuardianConsent(reason: "rescind_consent")`, push to the parent and every linked coach. Outside the `/api/v1` kill switch, like the KWS webhook. Mariah sets the notification URL in App Store Connect.
- Done when: an iOS 26 device with a Child Account routes as above and a self-declared adult changes nothing; a sandbox `RESCIND_CONSENT` pauses the athlete and both notifications arrive.

### S4 — SafeSport behaviours and QA (small)

The report contact address and response commitment in the listing copy and the Safe Sport panel; the QA rows above; `docs/ios/app-store-submission.md` §5 and §7 are already updated.

### S5 — Paper (Mariah with counsel)

Privacy policy, the direct notice, the public retention policy, the written security program, the App Store age-assurance answer (flips to Yes once S1 and S3 ship), KWS terms accepted and production go-live approved. The proposals are in `docs/legal/privacy-policy-brief-2026-09-24.md` §6 and §8.

---

## 8. Decisions that need Mariah (ask at the right moment, not up front)

1. **Dictation for minors on the web** was removed under #32 because the web mic was voice-to-text, not voice notes. If she only meant recorded voice notes, put dictation back for minors on the web (one condition in `room-view.tsx`'s composer) and keep the iOS recorder hidden. Ask when S2's composer work starts.
2. **When to flip `PARENT_VERIFICATION_REQUIRED`**: after the KWS test environment passes end to end and the demo parent is confirmed verified. Her action.
3. **KWS send-email path**: confirm the default or set `KWS_SEND_EMAIL_URL` from the portal's API specification at go-live.
4. **Existing coach-added athletes with unclaimed guardians**: once the switch is on, their rooms close until the parent claims. Decide whether to email those coaches ahead of the flip (a one-off admin action, not code).

---

## 9. Follow-ups and debt carried over (small, do them when nearby)

- `listMessageTargets` still offers provisional athletes to coaches; opening the room then answers 403 `provisional`. Filter them, or label them, when touching the picker.
- `roomHeader` runs the gate (two or three queries) on every page of a thread. Fine today; cache on the room row if paging gets heavy.
- No integration test drives the room rule through `sendMessage`; `athleteRoomGate` is unit-tested instead. Worth one fake-admin test when the messaging fakes are next extended.
- Schedule import: an "athlete" email in a group still wins the address choice but is now sent in guardian voice; a true adult athlete added by import gets a parent-voiced email. Acceptable under #30; revisit if coaches complain.
- `deleted_accounts.initiated_by = 'retention'` is new; the admin users page may not label it.
- The generated iOS client's `reason` enum for `POST /rooms/{id}/messages` must not crash on the new cases.

---

## 10. First concrete steps for the fresh session

1. State check: in the web repo, `gh pr list --state open` (only the peer's #151 and dependabot should be open from this thread); `git log origin/main --oneline -6` should show `d7180075 Applied pending migrations` above #146; ask Mariah whether the SMOKE precheck ran. In the iOS repo, `cat Contract/SOURCE_COMMIT` (expect `b8845f8c`, i.e. stale).
2. `scripts/sync-contract.sh` pinned to web `main`; build; fix the generated-enum fallout (§4.2) before any feature work.
3. S2 in the order of §7: `/me` fields → mocks → athlete entry → parent onboarding verify step → claim flow → messaging → parent settings → roster sheet → QA rows → audit harness. One iOS PR per screen group if they can stand alone; otherwise one stacked chain with the merge order in every PR body.
4. Daily update to Mariah in milestones, not dates.
