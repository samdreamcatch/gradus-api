# Handoff — the remainder of the PRD, from a working KWS test environment to native 1.0 in the store

**For:** a fresh Claude Code session that will carry `docs/ios/PRD.md` to the end: the first TestFlight build, S2–S5 (consent and Apple's age signals), the KWS production switch-over, the listing, and I16.
**Written:** 2026-09-26, at the end of the session that walked Mariah through the Kids Web Services portal, proved the KWS test environment end to end on production, and merged the follow-ups.
**Read first, in this repo:** this file; then `docs/ios/handoff-testflight.md` (web PR #151, still open) for the TestFlight mechanics and `docs/ios/handoff-consent-S2-S3.md` (web PR #152, still open) for the consent design, file map and QA rows. Both were written 2026-09-25 and this file does not repeat them; where they disagree with this file, this file is newer. `docs/ios/handoff-preQA.md` §3–§6 still hold the conventions, tooling and gotchas. The PRD sections that matter now: §6.13 (consent), §10.2 (the milestone table), §10.6–§10.9 (P, L, A, S milestones), §12 (open decisions), Appendix D (the submission kit at `docs/ios/app-store-submission.md`).

---

## 1. How to start the fresh session

1. Working directory `~/Developer/gradus`; the iOS repo is `~/Developer/gradus-ios`. Both checkouts are shared with other sessions: **never switch their branches**. Make a worktree per PR (`git worktree add ~/Developer/gradus-wt/<name> -b <branch> origin/main`, same under `~/Developer/gradus-ios-wt/`) and check `git branch --show-current` before every commit.
2. Run the state check in §9 before anything else.
3. Then take the milestones in §5, in order. Report in milestones, one daily update, never dates or durations.

---

## 2. Where things stand (2026-09-26)

### 2.1 Code

Every 1.0 build milestone in the PRD is merged in both repos: B1–B4, I1–I15, P1–P9, L1–L5 and A1–A2 (the last L/A PRs merged 2026-09-24: web #139, iOS #61), the 2026-09-24 open-items pass (web #140–#147, iOS #62–#69), S1 (web #148–#150) and this session's five PRs. Not yet built: **S2, S3, S4 and I16**; L6 is post-launch.

Web `main` is `a313ffe2`. The last five commits are ours:

- #153 `/verified` and `/verified/*` added to the AASA (they had been described as present but were not).
- #154 parent Settings offers "Verify you're an adult" as an **opt-in** while `PARENT_VERIFICATION_REQUIRED` is off (decision #34).
- #155, #157 PRD: decision #34, the `/support` page nearer go-live, the KWS checklist facts, the branding prerequisite, the passed test.
- #156 `Logo` gets `width: max-content` so the highlighter stripe never stretches across a page again.

iOS `main` is `539ac3e` (#69, the Team ID and App Attest entitlement). `Contract/SOURCE_COMMIT` is `0f947b30`, which **predates every S1 endpoint**; re-sync before S2 (§5.2).

Between our commits, Lovable's bot pushes "Changes", "Work in progress", "Reverted to commit …" and "Hid Ask Gradus tab". Those are Mariah's edits in Lovable and a build retry; the tree they leave is byte-identical to what our PRs were built on. "Hid Ask Gradus tab" removes the Ask Gradus tab from the coach and parent web Resources pages, which contradicts decision #22's "the web keeps it"; Mariah has not said whether that was deliberate (§8).

### 2.2 Production (gradus.training)

- Runs S1. `POST /api/public/webhooks/kws` answers `{"error":"invalid_signature"}` to an unsigned body (the secret is loaded); `/verified` renders; `API_V1_ENABLED=true` was set by Mariah on 2026-09-26 for the TestFlight build (kit §1 step 8); the API is live on production (`/api/v1/meta/config` answers 200) and a secret takes about 90 s to reach the worker. The SMOKE precheck is fully passed, including the recover rate limit (10 × 200, then 429).
- The AASA at `/.well-known/apple-app-site-association` and Apple's CDN copy both list `/verified` and `/verified/*`.
- **Lovable deploys are manual.** Merging to `main` updates the preview only; production changes when Mariah clicks **Publish**. Secrets bind at runtime and need no publish.
- Lovable's build service failed once on 2026-09-25 inside TanStack Start's `createStartHandler.js` (build id `br_409cf844-b72f-477a-aa9a-be5e5a9f6f92`); `main` built clean locally at the same commit, and the next publish succeeded. If it recurs, it is Lovable's side; retry, then support.

### 2.3 KWS (Kids Web Services, Epic)

- Organization `gradus-sports-inc` in the Epic developer portal, admin `mariah@gradussports.com`. Parent Verification terms accepted 2026-09-25. Verification methods: every method is on in **production** (2026-10-03, decision #38); in the US that is credit card, debit card and the SSN check; ID and face scan never show there. The **test** environment still has card only, so a run before the secret swap shows one option.
- **Test environment passed end to end on production on 2026-09-26**: Settings opt-in → KWS email to `mariah+kwstest@gradussports.com` → Stripe test card → webhook and `/verified` redirect → `parent_profiles` row verified → the Settings group disappeared. The test parent "Mariahkws Test" remains on production as evidence.
- The five Lovable secrets `KWS_CLIENT_ID`, `KWS_API_KEY`, `KWS_API_HOST`, `KWS_WEBHOOK_SECRET`, `KWS_VERIFICATION_SECRET` hold the **test** set. Lovable Cloud has one shared secret set for preview and production, so only one KWS environment can be live at a time.
- **Production review requested 2026-09-26.** KWS says up to seven business days. What happens on approval is §4 item 1.
- `PARENT_VERIFICATION_REQUIRED` is unset and must stay unset until §4 item 1 is done (§4 explains why).

### 2.4 Apple

Team ID `79RN82HXPZ`; App IDs, App Group, APNs and Sign in with Apple keys in Lovable; the App Store Connect record exists (app name "Gradus Training", version set to 1.0.0 to match `MARKETING_VERSION`); the App ID carries Push, Associated Domains, Sign in with Apple, App Groups, App Attest and Declared Age Range.

**Xcode Cloud is set up (2026-09-26).** Workflow "Archive main to TestFlight" on `mariah-gill/gradus-ios`: start condition branch `main`, action Archive iOS (scheme Gradus, Distribution Preparation **TestFlight (Internal Testing Only)**), post-action TestFlight Internal Testing → group **Gradus team** (Mariah as tester, automatic distribution). Environment Xcode 27. Only `gradus-ios` is granted to the Xcode Cloud GitHub app; the public package repos need no grant. **Build 5 succeeded** (34 pre-existing compiler warnings) after three fixes: Mariah's iPhone 17 Pro registered under Devices (ad-hoc and development exports fail on a team with no devices, and Xcode Cloud runs them on every archive), iOS #70 refreshed `Package.resolved` with the `swift-issue-reporting` pin Xcode 27 resolves, and Distribution Preparation set away from None. `ci_scripts/ci_pre_xcodebuild.sh` stamps the build number.

---

## 3. Decisions made this pass (do not re-ask)

- **#34 (2026-09-25):** opt-in verification in parent Settings while the switch is off; `/support` built nearer go-live; card-only methods *(superseded 2026-10-03 by #38: every KWS method)*.
- The KWS test environment's webhook and redirect point at production `gradus.training`, not the preview (Mariah, 2026-09-25).
- The switch is **not** flipped now (Mariah asked 2026-09-26; answer: no, see §4 item 1).
- The dictation-for-minors question from the consent handoff §8 is still unanswered; ask when S2's composer work starts.

---

## 4. Owed on Mariah's side (ask at the right moment)

1. **On KWS approval:** in the portal, switch to the production environment, publish **Branding** there too (brand name `Gradus`, privacy `https://gradus.training/privacy`, accent `#d0f000`; KWS refuses `send-email` with `400 ERR_INVALID_REQUEST` until branding is published), set the same webhook and redirect URLs, Publish, copy the five values, and **overwrite** the five `KWS_*` secrets in Lovable. Then the webhook curl (§9) and one real verification (card: five cents, refunded; or the SSN check). Only after that, and after the demo parent is confirmed verified, does she set `PARENT_VERIFICATION_REQUIRED=true`. Flipping earlier locks real parents out: the test environment only emails Epic org admins.
2. **Merge #151 and #152** (the two handoff docs) so they are on `main`.
3. **Publish in Lovable** after every merge that must reach production.
4. **Install Build 5 from TestFlight** on her iPhone 17 Pro and begin `docs/ios/QA.md` (Xcode Cloud itself is done, §2.4).
5. **Whether hiding Ask Gradus on the web was deliberate** (§2.1); if yes, amend decision #22.
6. **Coaches with unclaimed guardians:** once the switch is on, their athletes' rooms close until the parent claims. Decide whether to email those coaches ahead of the flip (an admin action, not code).
7. Still open from earlier passes: the Google iOS OAuth client ID (`GOOGLE_IOS_CLIENT_ID`) and the `gradus://reset-password` allow-list entry (kit §1 footnote); counsel on the privacy policy (§12 #24); library rights marking in Admin → Content → Library rights; running Admin → Membership → Demo accounts once on production; simulator access on the iPad Pro 13" for the iPad screenshot pass; the watchOS decision (reopen #7 or not; the scope document lives only in a 2026-09-25 session's files and would need re-creating at `docs/ios/watchos-scope.md`).

---

## 5. Remaining milestones, in order

Each is a milestone, not a date. Where one needs Mariah, it says so; do everything that does not.

### 5.1 T1 — first TestFlight build

**Build 5 is in TestFlight (2026-09-26).** Remaining: Mariah installs it through the TestFlight app and starts `docs/ios/QA.md` and the device accessibility script. Its contract pin predates S1 and the #142/#143 vectors, so the first S2 push to `main` (after the contract re-sync, §5.2) produces the next build automatically. Done when QA has begun on the device.

### 5.2 S2 — iOS consent flows

`handoff-consent-S2-S3.md` §7 has the file-by-file scope, mocks and QA rows; §5.3 the `/verified` redirect handling; §5.5 the error codes. Two additions from this pass:

- `scripts/sync-contract.sh` pinned to web `main` first; expect the generated enum changes listed in that handoff's §4.2. The parent Settings DTO's `verification` object now drives an opt-in state too: on iOS, show the verify step in parent Settings when `!verified && (required || available)`, with the opt-in copy from web #154 when `!required`.
- **`/verified` on iOS is currently a silent open.** `AppModel.open(url:)` returns false for a route it cannot parse, so a device with the app installed opens the app and shows nothing when KWS redirects. The webhook still completes the verification, but S2 must add the route (forward `status`, `externalPayload` and every `signature` untouched to `POST /guardian/verification/complete`, then refresh) **before any parent verifies from a phone with the app installed**. Put it first in S2.

Done when the simulator round-trips each flow against the Lovable preview with the switch off, the mocks show the switch-on states, and the audit harness passes on every new screen.

### 5.3 S3 — Apple's age signals

`handoff-consent-S2-S3.md` §7 "S3": the Declared Age Range entitlement and tighten-only routing, PermissionKit significant-change asks, and the one web endpoint `POST /api/public/webhooks/app-store` for `RESCIND_CONSENT`. Mariah sets the App Store Server Notifications V2 URL in App Store Connect.

### 5.4 S4 — SafeSport behaviours, QA rows, and the `/support` page

The QA rows for every §6.13 rule; the report contact and response commitment in the listing copy and the Safe Sport panel. **Build `/support` here** (decision #34): a short page on gradus.training with support@gradussports.com and a few FAQs, excluded from the AASA like `/privacy`. KWS's go-live review wants a support or FAQ URL that exists; `/contact` exists today and the kit uses it, so `/support` can redirect to or extend it. Enter the URL in KWS branding (both environments) once live.

### 5.5 S5 — paper (Mariah with counsel)

Privacy policy, direct notice, retention policy, security program, the App Store age-assurance answer (flips to Yes once S1 and S3 ship). Nothing to code; keep `/privacy` mirroring what counsel publishes.

### 5.6 KWS production go-live and the switch

§4 item 1, in that order. After the flip: check the room rule and the `parent_unverified` gates against production with a real parent account, and that the retired email mirror stays off.

### 5.7 Listing, screenshots, App Review prep

Kit §3–§8 into App Store Connect; iPhone 6.9" and iPad 13" screenshots; the kit §9 findings. Note that kit §9 items 3 and 7 are stale: `/support` is now scheduled (S4) and L1–L5 are merged. The demo accounts must be seeded on production and the demo parent confirmed verified (`admin` method) before review.

### 5.8 I16 — hardening and submission

PRD §10.2. QA checklist passes, crash-free target, the App Store age-assurance answer updated, submission. T2 (external TestFlight with Founding Coaches) sits between T1 and I16 in the PRD; take it when Mariah wants outside testers.

### 5.9 After 1.0

C2 Android (Mariah's call; the gifted hours are earmarked for Kotlin), L6 when §12 #17 says so, watchOS W0–W6 if #7 is reopened, iOS PR #31 (marketing demo mode, open since 2026-09-12, never reviewed against the current main).

---

## 6. Conventions that held this pass

Everything in `handoff-preQA.md` §3–§6 and `handoff-consent-S2-S3.md` §3, plus:

- Never merge, publish, apply migrations or flip a secret without Mariah's explicit say-so for that batch. 2026-09-25's "review each PR and merge in order" covered #153–#155 only; #156 and #157 she merged herself.
- Adversarial review before merge, even for docs: check table column counts on PRD rows, and re-read a stacked PR's base after `main` moves.
- One web PR per domain; a one-line PRD change rides in its own docs PR.
- Web change verification: `bun run typecheck`, `bun run lint` (0 errors; the 4,000+ warnings are pre-existing prettier drift), prettier on the touched files only, never on `src/integrations/supabase/types.ts`. For a visual change, a local dev server from the worktree (add a `.claude/launch.json` entry pointing at the worktree, remove it after) at a 375px viewport, and measure with the DOM rather than eyeballing.
- Auth-backed routes 500 locally; there is no service-role key in any session. Verify those against production or the preview with Mariah driving.
- Memory notes live in the Claude project memory; the durable record is the PRD and these handoffs.

---

## 7. Gotchas learned this pass

- **KWS branding gate:** `send-email` answers `400 ERR_INVALID_REQUEST "you need to publish your branding"` until Kids Web Services → Branding is published for that environment. The setup roadmap does not mention it.
- **KWS test emails** go only to an Epic org developer/admin address or a `+alias` of one; `+verified` simulates a pre-verified parent; the token step failing looks like a 401 `invalid_client`, the send step failing carries the KWS JSON body in the `[verification]` log line in Lovable → Cloud → Logs.
- **Epic sends its own "Your Security Code" email** when Mariah signs in to the portal; it is not the KWS verification email and there is nowhere to enter it in Gradus.
- **Lovable:** production updates only on Publish; secrets are runtime; the build service can fail on its own.
- **The web never shows the verify step while the switch is off** except through #154's opt-in; the `/api/v1` start route is behind the API flag. Do not add a second trigger.
- **`Logo` in a flex column** stretched to the column width and dragged the stripe with it; fixed in the component, but wrap the wordmark in a block anyway.
- **`perl -0pi` with `|` as the delimiter** turns `\|\|` into an empty alternation and inserts at the top of the file; use another delimiter or the Edit tool.
- **macOS 27 hard-disables Xcode 26** (`CoreTypes.bundle/…/Exceptions.plist` blocks `com.apple.dt.Xcode` builds ≤ 24999 with a free App Store update). After the OS update Xcode "disappears" from Spotlight and `open -a Xcode` fails with -10664; the fix is updating to Xcode 27 from the App Store, not re-registering LaunchServices (`lsregister -kill` no longer exists). Xcode 27 re-resolves packages on open and dirties `Package.resolved`; commit that change when it appears, or Xcode Cloud fails at resolution.
- **Xcode Cloud exports ad-hoc and development on every archive** and both fail with "Your team has no devices" until one device is registered; the TestFlight export itself does not need a device. Exit code 70 hides the reason; download the `*-export-archive-logs` artifact and read `IDEDistribution.standard.log`.
- The Bash safety classifier still times out in bursts; retry once, then use Read/Write.
- Squash merges in the iOS repo move `Contract/SOURCE_COMMIT`; sibling PRs conflict; re-run `scripts/sync-contract.sh`, never hand-merge generated files.

---

## 8. Questions for Mariah, at the right moment

1. Dictation for minors on the web: keep it removed, or restore dictation and hide only recorded voice notes? Ask when S2's composer starts.
2. Was hiding Ask Gradus on the web deliberate? Ask before touching Resources on either platform.
3. Email the coaches with unclaimed guardians before the flip? Ask when the switch is next.
4. Watch: reopen #7 or not, and "same submission" or first point release? Ask before I16 is scoped.
5. T2: who are the external testers and when does she want them in? Ask after T1 QA starts.

---

## 9. State check for the fresh session

```bash
cd ~/Developer/gradus && git fetch origin main --quiet && git log --oneline origin/main -6
gh pr list --state open            # expect #151, #152 and dependabot only, unless Mariah merged the handoffs
cd ~/Developer/gradus-ios && git fetch origin main --quiet && cat Contract/SOURCE_COMMIT   # stale until S2 re-syncs
curl -s -X POST -H 'content-type: application/json' -d '{}' https://gradus.training/api/public/webhooks/kws   # expect invalid_signature
curl -s https://gradus.training/.well-known/apple-app-site-association | grep -c '"/verified'                 # expect 2
```

Then ask Mariah three things: has KWS approved production (if yes, §4 item 1 is next), is Xcode Cloud connected, and did she publish after the last merges.
