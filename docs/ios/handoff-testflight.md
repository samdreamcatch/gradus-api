# Handoff: from the 2026-09-24 open-items pass to the first TestFlight build

> **Historical snapshot (2026-09-25), merged 2026-10-07 for reference.** Everything this file calls next is done: Xcode Cloud and the first TestFlight build (T1) landed 2026-09-26. Where it disagrees with a newer handoff, the newer one wins. For the current state, read `docs/ios/handoff-2026-10-05.md` first, then `handoff-2026-10-04.md` and `handoff-remaining-prd.md`.

Written 2026-09-25 for a fresh Claude Code session. Read this, then `docs/ios/PRD.md` §10.6 (the pre-QA gate), `docs/ios/app-store-submission.md` (the kit), and the enrollment checklist in gradus-ios (`docs/enrollment-checklist.md`). Earlier bridges: `handoff-preQA.md`, `handoff-I12-onward.md`.

## 1. Where things stand

**Code.** Every 1.0 build item in the PRD is merged. The 2026-09-24 pass merged thirteen PRs the same day (web #140–#145, gradus-ios #62–#68); the iOS contract is synced to web main `0f947b30` and both mains were verified green afterwards (web: build, typecheck, contract regeneration with no drift, 896 tests; iOS: 776 tests on iPhone 17 Pro Max).

**Apple.** Mariah's Team ID is **79RN82HXPZ**. As of 2026-09-25 she has: registered the App IDs and the App Group in the developer portal; created the APNs key (Sandbox & Production) and the Sign in with Apple key and put both, with their Key IDs and the Team ID, into Lovable secrets; created the App Store Connect app record on `training.gradus.app`. Xcode Cloud is not set up yet and no build has been uploaded.

**Two PRs open for the Team ID** (merge these first):

- gradus-ios [#69](https://github.com/mariah-gill/gradus-ios/pull/69): `DEVELOPMENT_TEAM: 79RN82HXPZ` in `project.yml` (all targets inherit), plus the App Attest entitlement `com.apple.developer.devicecheck.appattest-environment` (development; Xcode sets production on export), which the I15 App Attest code needed and never had.
- web [#147](https://github.com/mariah-gill/gradus-coach-start/pull/147): `GET /.well-known/apple-app-site-association` as a TanStack server route (`src/routes/[.]well-known/…`, builder in `src/lib/apple-app-site-association.ts`): JSON, one-day cache, Safari-only paths excluded first, the PRD §6.10 app paths plus `/verified` (the KWS consent response), and `webcredentials`. Verified locally with curl.

**Parallel threads in other sessions** (do not duplicate):

- "Apple Developer parental consent features": PRD #146 (decisions #29–#33) and web S1 (#148 → #149 → #150, stacked). iOS S2/S3 not coded. Its capability list for the App ID: Push Notifications, Associated Domains, Sign in with Apple, App Groups, **Declared Age Range** (code in S3), and App Attest. PermissionKit and StoreKit age rating need no portal capability; RESCIND_CONSENT notifications are an App Store Connect setting (`/api/v1/webhooks/app-store`).
- "watchOS app submission scope": W0–W6 proposal, reopens PRD decision #7; Mariah to confirm.

## 2. Decisions made 2026-09-24 (PRD decision log #20–#28)

- Make-room bench asks "why?" (web #140, iOS #62).
- iPad in 1.0 with adaptive one-column layouts, no sidebar (closes §12 #12).
- Ask Gradus and Saved hidden for every role in iOS 1.0 behind `ReleaseFlags.askGradusEnabled = false` (iOS #63). Web keeps it.
- The iOS library lists only curated rows marked `gradus` or `licensed` (`resources.rights`, default `pending`; web #141). Admin → Content → Library rights marks rows.
- Age rating: mature None, medical None, accept the computed rating, unrestricted web No, age assurance No (a third-party vendor is under evaluation; §12 #23). US-only storefront (closes §12 #7).
- Demo accounts for App Review: coach + parent + minor athlete seeded by Admin → Membership → Demo accounts (web #145), invented names; all real skater names were scrubbed from demo data (web #143, iOS #66).
- Onboarding before the account for every role; coach picks one primary sport plus S&C; native Sports and levels in Settings (iOS #67).
- PWA onboarding helpers native (web #142 endpoint, iOS #65). Goals card matches the PWA (iOS #64). Connections hub redesigned (iOS #68).
- Counsel brief for the privacy policy: `docs/legal/privacy-policy-brief-2026-09-24.md` (§12 #24).

## 3. Next steps, in order

1. **Merge #69 and #147.** Publish the web. Check `https://gradus.training/.well-known/apple-app-site-association` returns JSON, then `https://app-site-association.cdn-apple.com/a/v1/gradus.training`.
2. **Portal check.** On `training.gradus.app` confirm the six capabilities above are ticked (Declared Age Range and App Attest were added to the list after the first instructions); the widget App ID has App Groups only.
3. **Lovable.** Apply migration `20260924120000_resources_rights` and mark the curated documents in Admin → Content → Library rights (until then the iOS library shows no curated documents). Run Admin → Membership → Demo accounts once on production. Leave `APNS_ENV` unset for TestFlight (production); set `sandbox` only for Xcode-installed debug builds. `API_V1_ENABLED=true` is Mariah's own flip, per §10.6.
4. **Xcode Cloud (PRD §12 #11, kit §1 step 7).** In App Store Connect → the app → Xcode Cloud, connect `mariah-gill/gradus-ios`, workflow: archive `main` on push → TestFlight internal group. `ci_scripts/` in the iOS repo holds the post-clone script (xcodegen). First archive lets automatic signing create the profiles. Fallback: Product → Archive → Distribute in Xcode on Mariah's Mac.
5. **T1.** Mariah in an internal testing group, TestFlight app installed, build on her iPhone 17 Pro (never drive that simulator; automation uses the iPhone 17 Pro Max). Then QA per `docs/ios/QA.md` and the device accessibility script.
6. **Listing.** Paste kit §3–§7 into App Store Connect; screenshots per kit §8 (iPhone 6.9" and iPad 13"). The iPad screenshot pass is still owed: the iPad Pro 13" simulator is booted, the app renders, but the celebration modal blocks automation until Mariah grants simulator access for that device.
7. **S2/S3** (consent, Declared Age Range) from the other session gate submission alongside the kit's §9 findings.

## 4. Gotchas learned this pass

- The Bash safety classifier times out in bursts; use the Read/Write tools for reads and file writes when it does.
- `bunx tsr generate` writes a different route tree than the Vite plugin. Regenerate with `bun run build` only; CI compares `docs/api/openapi.json` too (`bun run openapi`).
- New `/api/v1` routes must also be imported in `scripts/openapi.ts` or they are missing from the contract.
- A SwiftUI model created inside a `NavigationLink` destination closure is recreated on every parent render (the Sports and levels screen spun forever until it moved into a `@State` wrapper).
- The `coach` mock re-presents the connection celebration on every launch and tab switch; dismiss it before each automation step.
- `xcrun simctl ui <device> appearance dark` and `content_size accessibility-large` give dark and accessibility-size screenshots without touching the app.
- Squash-merging iOS PRs moves `Contract/SOURCE_COMMIT`; resolve sibling conflicts by re-running `scripts/sync-contract.sh`, never by hand-merging generated files.
- Workflow subagents stalled repeatedly; keep research in the main session.

## 5. Local state

- Worktrees (remote branches deleted, safe to remove): `~/Developer/gradus-wt/{make-room-why,resources-rights,checklist-api,demo-names,docs-1-0,demo-accounts,aasa,handoff,main-check}` and `~/Developer/gradus-ios-wt/{make-room-why,hide-ask-gradus,goals-card,onboarding-helpers,demo-names,onboarding-first,connections-redesign,team-id,main-check}`; older ones from L1–L5 and A1/A2 too.
- `~/Developer/gradus` is on another session's `feat/goals-history`; `~/Developer/gradus-ios` main is behind. Use worktrees, never switch those.
- Scratch build products and screenshots live under the session scratchpad and are disposable.
