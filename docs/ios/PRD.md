# Gradus for iOS — Product Requirements Document

**Status:** Draft v1 for review · **Owner:** Mariah Gillespie · **Author:** Claude Code · **Date:** 2026-09-04 · **Amended:** 2026-09-19 (native-only release and the pre-QA gate, §10.6) · 2026-09-20 (athlete learning loop and grounded Ask Gradus, §6.7 and §10.7)
**Repos:** backend and web `mariah-gill/gradus-coach-start` · native app `mariah-gill/gradus-ios` (to be created) · **Web app:** https://gradus.training · **Bundle ID:** `training.gradus.app`

This document specifies the native Swift rebuild of the Gradus progressive web app for iPhone. It is written to be executed by Claude Code with Mariah reviewing, so it is deliberately concrete: it names the endpoints, screens, data, and guarantees, and it records the decisions already made so future sessions do not re-litigate them.

**How to read it.** Sections 1–5 are the "why" and the rules. Section 6 is the architecture, including the answers to *how do web and iOS share one backend* and *how do we avoid disrupting current users*. Section 7 is the feature inventory with priorities. Sections 8–9 are design and engineering standards. Section 10 is the milestone sequence. Appendices map every web server function to an API endpoint and every web route to an iOS screen.

**Contents**

0. [Decision log](#0-decision-log) · 1. [Summary](#1-summary) · 2. [Goals and success metrics](#2-goals-and-success-metrics) · 3. [Users and roles](#3-users-and-roles) · 4. [Non-negotiable constraints](#4-non-negotiable-constraints) · 5. [Current system snapshot](#5-current-system-snapshot)
6. [Architecture](#6-architecture): 6.1 one backend · 6.2 API v1 · 6.3 direct Supabase use · 6.4 authentication · 6.5 offline and sync · 6.6 realtime and push · 6.7 AI and voice · 6.8 payments · 6.9 Live Board · 6.10 deep links · 6.11 security and privacy
7. [Feature requirements](#7-feature-requirements) · 8. [Design system on iOS](#8-design-system-on-ios) · 9. [Engineering standards](#9-engineering-standards) · 10. [Milestones and delivery](#10-milestones-and-delivery) · 11. [Risks and dependencies](#11-risks-and-dependencies) · 12. [Open decisions](#12-open-decisions)
Appendices: [A · endpoint map](#appendix-a--server-function--api-v1-endpoint-map) · [B · tables](#appendix-b--tables-by-domain-and-what-ios-caches) · [C · route → screen](#appendix-c--web-route--ios-screen) · [D · App Store checklist](#appendix-d--app-store-submission-checklist) · [E · glossary](#appendix-e--glossary) · [F · work packages](#appendix-f--work-packages-scope-reference)

---

## 0. Decision log

Decisions confirmed with Mariah on 2026-09-04. Treat these as settled.

| # | Decision | Choice |
|---|---|---|
| 1 | Relationship to the Capacitor shell | **Superseded 2026-09-19 (Mariah):** the Capacitor iOS shell never ships. The native app is the first App Store release, versioned **1.0** (§9.1, §10.5). Whether the Capacitor Android shell ships at all is reopened under §12 #14. The web app stays for the internal admin panel and org admins. *Original 2026-09-04 decision, for the record:* the shell ships as 1.0 for store presence and the native app replaces it as 2.0 under the same bundle ID; the Android shell follows and a Kotlin rebuild replaces it. |
| 2 | Roles in v1 | **Coach, Parent, Athlete** (including adult self-managed athletes). Org admin and internal admin stay web-only. |
| 3 | Native release scope | **Full feature parity in the first native release**, versioned **1.0** since 2026-09-19 (2.0 while a shell was planned). No partial native launch. The P0/P1 tags in §7 order the build, not the releases. |
| 4 | Live Board | **In native 2.0**, built in the first (P0) wave, with Live Activities. |
| 5 | Backend | One backend shared by web and iOS: the existing Lovable Cloud (Supabase) project plus the server logic in this repo, exposed to iOS through a versioned JSON API added to this repo. No data migration. See §6. |
| 6 | Web sunset | Once **both** native apps (iOS, then Android in Kotlin) are live with feature parity, the web app is sunset for coaches, parents, and athletes, and product development moves from Lovable to Claude Code. Until then, **no interruption or degradation of the web experience is acceptable.** See §4 and §10.4. |
| 7 | Platform | iOS 18 minimum, iPhone-first with adaptive iPad layouts, ~~no Apple Watch in v1~~. **Amended 2026-10-03 (Mariah): an Apple Watch app ships in the same 1.0 App Store submission as the iPhone app** (decision #36, §6.15, §10.11). |
| 8 | Payments | **No In-App Purchase.** Subscriptions are purchased on the web. The app shows entitlement and, where Apple's rules allow, links out. See §6.8. |
| 9 | Offline | **Yes.** Offline-first for plans, schedule, sessions, and message drafts, with background sync. See §6.5. |
| 10 | Design | Keep Gradus typography and color tokens; adopt native navigation and gestures. See §8. |
| 11 | Team and format | Claude Code builds it with Mariah reviewing once a day. PRD lives in the repo as Markdown. First TestFlight as soon as App Store Connect is set up (enrollment approved 2026-09-19); the pre-QA gate in §10.6 comes first. |
| 12 | Pace | **Milestone-driven, no time estimates.** One daytime Claude Code stream on iOS plus overnight backend runs; the next milestone starts when the current one is done (§10.1). |
| 13 | Repositories | The native Swift app lives in a **new repo, `mariah-gill/gradus-ios`**. The backend API stays in `gradus-coach-start` because it runs in the Worker Lovable deploys. The OpenAPI document is the contract between them, pinned by commit. Kotlin later gets `gradus-android`. |
| 14 | Athlete learning loop in 1.0 | **2026-09-20 (Mariah):** the site's promise that Gradus "learns each athlete's pace and seasonal trends" and "digests competition results into the next plan" becomes product, not copy. The data capture (skill events, level history), the flow-state label fix, and a longitudinal athlete profile that feeds the existing prompts all ship **before the native 1.0 submission** (§10.7). A *trained* per-athlete pace model is post-launch, once a season of real events exists to train on. |
| 15 | Grounded Ask Gradus | **2026-09-20 (Mariah):** Ask Gradus answers from a curated, cited corpus (retrieval-augmented) instead of general model knowledge: The Athlete Survivors' Assist materials, the SafeSport Code and MAAPP, the rulebooks for each supported sport, the coaching and athlete-development sources Mariah picks (§12 #15), and each coach's own uploaded resources, scoped to that coach's athletes. Gates 1.0 (§10.7). |
| 16 | Ask Gradus fallback | **2026-09-20 (Mariah):** when the corpus does not cover a question, answer from general model knowledge and **say so plainly** in the answer. Safety topics never fall back: they route to the Safe Sport panel content. |
| 17 | Coach "why" prompt | **2026-09-20 (Mariah):** when a coach benches a plan or removes a move, the one-tap reason prompt (landed it / parking it / changed direction) is **skippable**. Only answered prompts become labeled skill events; the rest are inferred with a low-confidence flag. Coaches are never blocked. |
| 18 | Canonical flow-state labels | **2026-09-20 (Mariah):** **Frustrated / Pushing / Steady / Locked in / Flowing** are the labels for every user, every screen, and every prompt. The coach's AI summary had its own mastery-flavored scale for the same index; web PR #127 removes it. |
| 19 | Usage analytics | **2026-09-22 (Mariah):** Gradus measures **how much time users spend in each area of the app, Resources in particular**, from 1.0. This reverses the earlier "no analytics" lines in §6.11 and §9.2. Events are first-party (our own `/api/v1` endpoint and table, no SDK; §12 #19); under-18 athletes' events are stored de-identified, reportable by club and region in groups of 10 or more but never per coach (§12 #22); ~~users can turn it off in Settings~~ consent and withdrawal per **#46** (no in-app switch). Design in §6.12, milestones A1–A2 in §10.8. Never used for ads or cross-app tracking. |
| 20 | Make-room bench asks "why?" | **2026-09-24 (Mariah):** when activating a plan benches another to make room, the coach is asked the same "why?" as on Bench (Landed it / Parking it / Changed direction / Skip). The answer is recorded against the plan being benched (web #140, iOS #62). **2026-09-26 (Mariah, TestFlight QA):** the labels read *Goal reached* (`landed_it`) / *On hold* (`parking_it`) / *No longer needed* (`changed_direction`), plain sport-neutral words workshopped with Mariah on 2026-09-27 (iOS #86); in the make-room sheet each carries a line naming the athlete, the answer is optional with no Skip row (tap again to clear), and "Keep both active" is the default choice (iOS #73). Wire values unchanged. **Moot since #52 (2026-10-11):** activation never benches another plan to make room, so the make-room sheet is gone; the coach answers "why?" when benching a plan from its own screen (#17). The server still records the answer against the replaced plan when an older build sends `replaceId` with a reason. |
| 21 | iPad in 1.0 | **2026-09-24 (Mariah):** the app ships on iPad in 1.0 with **adaptive one-column layouts** (readable max-widths, all orientations, iPad 13" screenshots), no sidebar or split view. Closes §12 #12. **Superseded for 1.0 by #50 (2026-10-11): 1.0 ships iPhone only; this design returns with iPad.** |
| 22 | Ask Gradus held back in iOS 1.0 | **2026-09-24 (Mariah):** Ask Gradus (and Saved answers) are hidden for **every role** in the iOS 1.0 release, behind the compile-time switch `ReleaseFlags.askGradusEnabled` (iOS #63), to buy time for the content rights in §12 #16. The web keeps Ask Gradus; the server endpoints stay live. Analytics for the Ask area cannot fire while hidden. |
| 23 | Library rights in iOS 1.0 | **2026-09-24 (Mariah):** the iOS library lists only curated documents marked **Gradus-authored** or **licensed** (`resources.rights`, web #141; Admin → Content → Library rights). Every existing curated row starts **pending** (web only) until Mariah marks it. The Assist's documents and the safety PDFs therefore come out of the iOS 1.0 library; the Safe Sport hotline panel stays. The web library is unchanged. |
| 24 | Age rating answers | **2026-09-24 (Mariah):** mature/suggestive themes **None** (with #23 applied), medical/treatment information **None**, accept Apple's computed rating (no upward override), unrestricted web access No, age assurance **No** today (parent-entered birthdate only; a third-party age-assurance vendor is under evaluation for later). Details in `docs/ios/app-store-submission.md` §5. |
| 25 | Storefront | **2026-09-24 (Mariah):** United States only at launch. Closes §12 #7. |
| 26 | Demo accounts | **2026-09-24 (Mariah):** App Review gets a coach, a parent and a **minor athlete under that parent** (username login), created and seeded by an admin-only server tool (repeatable for screenshots and future reviews), with invented names. Dummy data must contain no real people: the demo board and preview names lifted from IJS results were replaced (web #143, iOS #66). |
| 27 | Onboarding before the account | **2026-09-24 (Mariah):** for every role, onboarding happens **before** account creation and payment. A coach picks their **primary sport** (Strength & Conditioning always included) during onboarding and adds further sports later in Settings when on Coach Pro or Club; the "Sports and levels" editor becomes native. |
| 28 | Onboarding helpers | **2026-09-24 (Mariah):** the PWA's coach helpers (roster "Get set up" checklist, plans "How to make a plan") ship natively (web #142 for the checklist endpoint, iOS #65). |
| 29 | Parent adult verification | **2026-09-24 (Mariah):** every parent account that links a minor athlete is verified as an adult **once**, through Kids Web Services (KWS) Parent Verification, **payment card only** in the US *(superseded 2026-10-03 by #38: every KWS method)*. Stored on the parent profile with the KWS transaction id. Closes §12 #23. Design §6.13, delivery §10.9. |
| 30 | Under-13 accounts start with the parent | **2026-09-24 (Mariah):** no under-13 athlete account is ever created by the athlete. The athlete entry screen asks for a birthdate first; under 13 it offers only "ask your parent" (the existing share message) and stores nothing. The child joins through the parent's invite code once the parent is verified. **Coaches invite the parent, never the athlete, for any athlete under 18** (or with no birthdate on file). |
| 31 | Provisional accounts for 13–17 | **2026-09-24 (Mariah):** a 13–17 self-sign-up creates a **provisional** account (own goals and plans visible; no coach connection, no rooms) until a verified guardian claims it. A room that includes a minor opens only when a verified adult who is not the coach is a participant. The email mirror to unclaimed guardians is retired. |
| 32 | Minors send text only | **2026-09-24 (Mariah):** under-18 athlete accounts cannot record voice notes in 1.0; coach voice notes to a minor keep their coach-side transcripts. No separate consent scope for transcription (Mariah's reading: transcription is coach input; and with no minor audio stored there is no child recording for the amended COPPA Rule to reach). ~~Reopen if athlete voice returns.~~ **Reopened and narrowed 2026-10-03 (#37):** voice *notes* stay text-only for minors; voice *as input to the athlete's own plan* is allowed under the transcribe-and-discard rule in §6.13 A7. **Restored 2026-10-07 (#48):** minors are text-only for plans too. |
| 33 | Apple age signals | **2026-09-24 (Mariah):** adopt Declared Age Range (tighten-only), PermissionKit significant-change asks, the StoreKit age-rating watcher, and the `RESCIND_CONSENT` server notification. Required for the Texas App Store Accountability Act on the US storefront (#25) and for California from 2027-01-01. A coach SafeSport-training attestation at onboarding was proposed and **declined**. |
| 34 | Opt-in verification before the switch; a `/support` page for KWS go-live | **2026-09-25 (Mariah):** while `PARENT_VERIFICATION_REQUIRED` is off, parent Settings offers "Verify you're an adult" as an opt-in whenever KWS is configured, so the KWS test environment can be exercised on production (Lovable Cloud has one shared secret set, so the switch cannot be on for preview alone) and parents can verify ahead of the gates. KWS's go-live review requires a support or FAQ URL, so `gradus.training/support` (support@gradussports.com plus FAQs) is built **nearer go-live**, not now. KWS verification methods: see #38. |
| 35 | Athletes author their own plans | **2026-10-03 (Mariah):** every athlete (minor or adult) can create, edit, activate, bench and delete **their own** practice plans with the same editor, seeded move curriculum and voice builder coaches have, but can never assign a plan to anyone else. They share a plan through the existing public `/p/:token` link, and anyone who opens it (athlete or coach) can adopt it as a **copy snapshot** that lands **active** on the adopter. Athletes get **read-only** access to the seeded curriculum (no personal move library). Coaches **see** an athlete's self-authored plans; ~~those plans **do not count** toward the two-active-plans-per-coach limit~~ (moot since #52: there is no limit). Under-18 athletes **may** publish share links (a text-only workout, no contact details); the public page says "Plan by *first name*". Built as **parallel `/athlete/...` routes**, never by generalizing the coach modules. Design §6.14; milestones §10.10. |
| 36 | Apple Watch in 1.0, headphones-first | **2026-10-03 (Mariah):** a watchOS app ships **in the same App Store submission** as the iPhone app (reverses #7). It is built to be used **entirely through headphones**: text-to-speech out, voice in. Five workflows: voice→plan (athlete, coach), deploy a plan (athlete: activate their own; coach: assign and activate), plan→audio with a **full read** of every move (athlete, parent, coach), the pre-lesson briefing spoken **on tap only** (coach), and the post-lesson wrap-up by voice (coach). Design §6.15; milestones §10.11. QA device: Apple Watch Series 10. |
| 37 | ~~Minors may build plans by voice (transcribe and discard)~~ **Withdrawn 2026-10-07 by #48** | **2026-10-03 (Mariah):** the #32 text-only rule is narrowed. An under-18 athlete may record a voice clip to build or edit **their own plan** (iPhone and watch). The server transcribes it and **never stores the audio**: the clip is discarded as soon as the transcript exists, and only the transcript text, which the athlete authored exactly as if typed, is kept on the plan (`plans.voice_transcript`). This is the amended COPPA Rule's audio exception (a child's voice collected solely to replace written words and deleted at once), every under-13 account already carries verified parental consent (#29), and 13–17 are outside COPPA. Voice **notes** in messaging stay text-only for minors (#32). Counsel confirms the wording in the privacy policy and direct notice (§12 #31). |
| 38 | KWS verification methods | **2026-10-03 (Mariah):** every method KWS offers is on in production. In the US a parent sees credit card, debit card, or the Social Security number check (last four digits, name, birthdate and address, checked by Veratad on KWS's own pages); ID scan and face scan are not offered there. KWS reports no method in the webhook or the Verification Response, so the stored value is the provider, `kws` (web PR #176). Rollout is expand/contract: #176's migration only widens the CHECK to accept both values and the server normalizes `kws_card` to `kws` on read; the relabel and the tightened CHECK are a later migration, applied after the publish. On the wire `method` is a plain string, not an enum, so an installed iOS build never fails to decode `/me` over a value it has not learned. Copy says "a payment card or the last four digits of your Social Security number"; the privacy policy's "we do not collect Social Security numbers" gets a KWS qualifier (brief, revision 2026-10-03). |
| 39 | Privacy policy: instruction to counsel, existing parents, transcription | **2026-10-03 (Mariah):** (A1) the brief's proposals, as revised 2026-10-03, are the instruction to counsel; (A2) the changes since existing parents consented are **not material**, so legacy parents (§12 #27) are not re-prompted; (A3) coach voice-note transcription is integral to the service and needs no separate third-party-disclosure consent, counsel to confirm. |
| 40 | Direct notice in the flow | **2026-10-03 (Mariah):** the COPPA direct notice is shown in-product wherever a parent enters a minor's details (sign-up athletes step, guardian claim, Settings → Add an athlete), ending "By continuing, you give your consent" in the sign-up and claim flows; one text source for the email and the app (web PR #178, gradus-ios companion). The KWS email is KWS's template and cannot carry it; §6.13 A8 corrected. |
| 41 | Dormant athlete accounts | **2026-10-03 (Mariah):** an athlete account under 18 with no activity for **3 years** is deleted **30 days after every guardian on file is emailed** (plus one day of grace); any sign-in, logged practice, message, goal edit, or coach activity on the athlete cancels it. Nobody to notify means the account is left alone and counted for an admin, never deleted unseen. Accounts with no birthdate are out of scope. Ten years was asked for and declined as out of line with the rule's "not indefinitely." Adult athletes: §12 #34. Web PR `feat/s5-retention-sweeps`. |
| 42 | Life-of-the-account categories | **2026-10-03 (Mariah):** messages, practice logs, goals, plans and coach voice notes are kept for the life of the athlete account; the parent verification result for the life of the parent account; the consent ledger for the life of the athlete account. |
| 43 | Audit records and mail windows | **2026-10-03 (proposed for Mariah's confirmation):** webhook receipts and deletion tombstones **5 years** (the federal civil-penalty limitations period); safety reports **7 years**, other support mail **3 years** (mailbox retention, not code); email delivery records **13 months** (daily sweep built 2026-10-05, `purgeEmailSendLog`). Published text: `docs/legal/retention-policy.md`. |
| 44 | Written information security program | **2026-10-03 (Mariah):** owner Mariah, annual review every **November 1**; drafted in-house from the codebase (`docs/legal/information-security-program.md`); no outside counsel at this stage. |
| 45 | Vendor assurances | **2026-10-03 (Mariah):** the vendor terms and DPAs the security program lists (§7) are filed as part of the PRD wrap-up before submission (submission checklist). |
| 46 | Usage-data consent and withdrawal | **2026-10-04 (Mariah):** **no in-app analytics switch** (the Settings → Privacy toggle built in A2 is removed). Consent to usage-data collection is part of accepting the Terms of Service **and Privacy Policy** at sign-up: the acceptance line on the web sign-up pages and in the iOS sign-up and role chooser names both. The privacy policy (§2.4, §8) states that consent and how to withdraw it: email support@gradussports.com. Gradus honors a request **by hand**: an admin records it on the user's admin page (Usage data card), which stops collection for the account server-side (`analytics_opt_outs`; the events endpoint accepts and discards the account's batches) and deletes its stored usage events. Minor athletes' events carry no id, so a withdrawal for a minor stops future collection only. Apple 5.1.1(ii) (consent, plus an accessible way to withdraw it) is met by the bundled acceptance and the policy's withdrawal route. Mariah chose this over the toggle knowing the toggle was the lower-friction reading of the guideline. Design in §6.12. |
| 47 | Read-aloud voice | **2026-10-06 (Mariah):** "Read this plan aloud" (iPhone now, the watch in W1) uses **Apple's on-device voices only** for 1.0. **Automatic** picks the most natural American English voice installed, a woman's where one is as natural (Enhanced and Premium both count as natural, so an Enhanced woman's voice beats a Premium man's, and a natural voice of either gender beats a robotic one); **Settings → Device → Read-aloud voice** lists the device's English voices (American first, then other English; novelty, Eloquence, classic Mac (Fred, Kathy…) and Personal Voice excluded) with a sample for each, and explains that Premium and Enhanced voices are free downloads in iOS Settings → Accessibility → Spoken Content → Voices. The choice is kept per device: the watch has no picker and always reads with its own Automatic pick from the voices installed on it. Nothing leaves the device; it works offline and wrist-down. A **custom cloud voice** (for example an ElevenLabs voice described as a woman from Michigan) was considered and **deferred to a point release** (§12 #35): it sends plan text, including minors', to a vendor (privacy-policy line and counsel check), needs server storage and per-character fees, and needs a connection unless pre-generated. |
| 48 | Plans by voice are off for athletes under 18 | **2026-10-07 (Mariah):** **withdraws #37.** An athlete under 18, or one with no birthdate on file, can't build or edit a plan by voice, on the iPhone or the watch; they type, as in messaging (#32). **Why:** the transcription service (ElevenLabs) forbids voice data from anyone under 18 in its terms and privacy policy, and its DPA gives no children's-data assurances (amended COPPA Rule §312.8(c)). It also keeps speech-to-text audio and transcripts unless an Enterprise account turns on zero retention, which defeats the audio exception #37 rested on (the recording is deleted right after use). Turning off ElevenLabs model training doesn't change that retention. **Enforced on the server before any audio is transcribed:** `POST /athlete/voice/build-plan` and `POST /voice/transcribe` answer 403 `text_only`. The check is per login and conservative (`isMinorOrUnconfirmed`; any athlete row on the login that is under 18 or has no birthdate). The same check guards the coach voice route and voice notes in any room (a minor's login can also hold a coach profile), and voice-note transcription skips, for good, any note whose sender is under 18 (`NEVER_TRANSCRIBE`; minors stopped sending voice notes on 2026-09-24, #32). `GET /me` sends `athleteVoiceToPlan`, and the apps hide every athlete voice control unless it is `true` (a missing value counts as off). In-app copy promises only that Gradus doesn't store a recording. Coach voice and adult athletes are unchanged. **Owed (Mariah with counsel):** the privacy policy has to name ElevenLabs as the transcription processor for coaches' and adult athletes' voice and say its own retention applies; the repo copy (`src/routes/privacy.tsx`) still limits transcription to coach input. Also a one-off production check for voice notes sent by minors before 2026-09-24, to purge if any remain. **Considered and not taken for 1.0:** on-device transcription for minors (Apple's speech recognition on the iPhone, system dictation on the watch), ElevenLabs Enterprise with zero retention plus a written children's-data amendment, and another vendor. Revisit after 1.0. |
| 49 | Athletes see their own plans on the web | **2026-10-10 (Mariah):** narrows §6.14 B, which said the PWA shows nothing new. On the web, an athlete's Plans list and plan page now include their own **active and benched** `source = 'athlete'` plans: the ones they wrote in the app and the ones they adopted from a share link. Drafts stay app-only. The parent and coach web views are unchanged and still leave these plans out. **Why:** adopting a shared plan on the web (the athlete branch of `import_shared_plan`) created a plan the web then hid, so the athlete landed on "not found" and every retry left another hidden copy. Those copies now show up too; the athlete deletes them in the app. There is still no web editing, since the web sunsets (§10.4). Lovable made the change on `main` (64165c1d): in `athlete-plans.server.ts`, `includeAuthored` now gates only the drafts. **Open:** the web plan page reads `isGradus` and `coachName` but not `source`, so it captions these plans "Coach *first name*" and "From the Coach". |
| 50 | iPhone only in 1.0 | **2026-10-11 (Mariah):** **supersedes #21 for 1.0.** The first App Store submission is iPhone only, because the iPad experience is still a little buggy. The iPad work is kept, not deleted: gradus-ios `TARGETED_DEVICE_FAMILY` is `"1"` on the app and widgets (gradus-ios #127), and every iPad-only branch keys off `userInterfaceIdiom == .pad`, which an iPhone app running on an iPad never reports. An iPad can still install the app and runs it in an iPhone-sized window. No iPad screenshots for 1.0. **To ship iPad later:** set `"1,2"` on both targets, finish the iPad QA, add iPad 13" screenshots. Apple allows adding iPad in an update but not removing it once a version with iPad support is live. |
| 51 | Gradus on the watch face | **2026-10-10 (Mariah):** the watch app must be addable to an Apple Watch face as a **complication**. Built as W7 (§6.15, §10.11; gradus-ios #126): a WidgetKit extension in the watch app for every accessory slot (circular, corner, rectangular, inline; rectangular also stands in the Smart Stack). **Defaults chosen in the build, for Mariah to confirm:** a coach sees the **next lesson today** (athlete first name and time, or "Lesson now" until it ends; "No more lessons today" after the last), which moves through the day on its own; athletes, parents and a signed-out watch get the **Gradus mark** as a one-tap launcher; anything with a name is marked private, so the system hides it while the watch is locked or the face hides sensitive data; a tap on a lesson opens Up next. Nothing new is collected or sent: the watch app writes what it already fetches (`GET /coach/up-next`) into the App Group, and sign-out, an account switch or a lapsed lease clears it. |
| 52 | No cap on active plans per athlete | **2026-10-11 (Mariah, TestFlight feedback 2026-10-11):** a coach can have any number of plans active for one athlete; activation never asks to bench or replace. Supersedes the two-active-plans rule and makes the beta-feedback 2026-10-07 "remove active-plan limit (post-1.0)" item part of 1.0; athlete-authored plans' decision #5 note about not counting toward the cap is moot. **Built:** `POST /plans/{id}/status` no longer answers 409 `bench_choice_required`; an optional `replaceId` still benches that plan in the same step (with its "why?", #20), because older iOS builds send it after their "replace" prompt. The web editor and the iPhone and watch apps activate directly; the iOS app keeps the choose-one-to-bench sheet only as a fallback for a server that still answers 409 (before the Lovable Publish). There never was a database-level cap. Web #223, iOS #128. |
| 53 | AI drafts for new moves | **2026-10-11 (Mariah, TestFlight feedback 2026-10-11):** a coach creating a move, in the Move library or from the plan builder's move picker, can ask Gradus to **draft the description, cue and "why"** (and a category when none is picked) from the move's name and sport (`POST /api/v1/coach/moves/draft`, §7.3). Suggestions fill **empty fields only**, never what the coach typed. AI-written fields are marked "Drafted by AI — check it" until the coach edits or saves them; the apps never say where a draft came from. **Lookup order (Mariah, 2026-10-11):** (1) **The Gradus library.** A `seed_moves` move of the same sport whose name matches after normalising (case, punctuation, hyphens, "&", small numbers as words or digits, plurals, the gym abbreviations DB/BB/KB/RDL, and "Squat (Barbell)" against "Barbell Squat") answers with its own text, unmarked, and no AI call. (2) **An open exercise list, facts only.** 888 gym exercises in `src/lib/exercise-list/`, imported from yuhonas/free-exercise-db (Unlicense) and exercemus/exercises (MIT) at pinned commits by `scripts/import-exercise-list.ts`. An exact name or alias match, or else up to three close names, go to the model as reference facts (name, aliases, category, equipment, muscles, force, mechanic, level), and the model must say whether one is the same move in this sport (a fencing "lunge" is not the gym lunge); a confirmed match drafts consistently with those facts. *Why facts only:* the lists' instruction text matches Bodybuilding.com's exercise pages almost word for word and their images were scraped, so instructions, descriptions, tips, images and video are never imported, stored, shown or sent to a model, and the one CC-BY-SA entry is skipped (`SOURCES.md`; a test fails if any of it reaches the committed file). (3) **The recognition check.** The model answers `known`, `unsure` or `unknown`, plus one line on what it took the move to be. Only `known` gets a draft. `unsure` and `unknown` return 200 with empty fields, and the app says "Gradus doesn't recognise “*name*” in *sport*. Add a few words about it and draft again." with a hint box (up to 200 characters, sent as untrusted text) and **Draft again**; with a hint, the model may treat the move as known when the hint makes it clear, and stays consistent with it. **A draft is never invented for a name the model doesn't recognise.** **Models:** step 3 runs on **Claude Haiku 5.5** (`claude-haiku-5-5`, Anthropic API through `@anthropic-ai/sdk`) with Anthropic's **web search** (`web_search_20250305`, at most 3 searches per draft), so it can look up an unfamiliar drill. It searches only when it isn't sure what the move is, writes in its own words, describes the most common version, and hands back its answer through a strict tool; a refusal or searches that find nothing count as `unsure`, and an answer written before its search ran never counts. **Gemini is the fallback:** when the `ANTHROPIC_API_KEY` production secret is unset, Anthropic fails (5xx, overload, rate limit, connection error, timeout, or a 400/401/403, which is logged as an error), or Claude ends without a usable answer (no answer, the wrong shape, cut off at `max_tokens`, out of time), step 3 runs on `google/gemini-2.5-flash` on the Lovable AI Gateway, as the plan-session summary, without the web. **One deadline:** a draft gets 28 seconds in all, inside the app's 60-second request timeout; Claude gets two thirds of what is left when step 3 starts and Gemini the rest, and a draft neither answers in time is a 503. Either model gets only the move's name, sport and category, the coach's hint, anything the coach already typed about the move, and Gradus examples; no user ids. Pages the answer relied on are logged server-side with the sport only (never the move name) for evals and never reach the apps. The sport must be a built-in key or a custom `custom_…` key (an older label such as "Figure Skating" is read as its key); anything else is a 422. **Cost:** Anthropic web search is $10 per 1,000 searches plus tokens, at most 3 searches per draft and only when the model is unsure; library matches cost nothing. The response's optional `source`, `sourceName` and `understoodAs` are for logs and evals; the apps read only `recognition`. **Not taken:** Google Search grounding on Gemini, whose terms require showing Google's search suggestions with every grounded result and forbid modifying or storing grounded results. **Owed:** the `ANTHROPIC_API_KEY` production secret; a privacy-policy line naming Anthropic as a processor for coach move drafts; legal review of showing reworded drafts without citations (Anthropic asks for citations when web-search output is shown as-is). **Coach-only:** athletes have no personal library, so neither the button nor new-move creation appears in their authoring editor (§6.14). 30 drafts per hour per coach, library matches included, counted once per draft and shared by the web and the API (never per IP). **Bundle:** the Worker grows by about 135 KB gzipped (the Anthropic SDK about 110 KB, the exercise list about 14 KB); neither reaches the client bundle. The same feedback ("too much friction to create new moves when generating a plan") made creating a move from the plan builder native, as on the web (§7.3, "New move from the plan editor"). |
| 54 | Read and reply to a message from its notification, on iPhone and Apple Watch | **2026-10-11 (Mariah, TestFlight feedback):** "when I click on a notification in the watch that contains a message, I should be able to read the message and respond to it." **Narrows §7.15**, which kept messaging off the wrist in 1.0. Message pushes (a new message in a room, and the competition-recap message, which is a real message in the coach's room with the athlete) carry `aps.category = "GRADUS_MESSAGE"` (§6.6). The iPhone app and the watch app register that category with one text action, **Reply** (`gradus.reply`, button "Send", placeholder "Message"), so Reply shows on the iPhone notification and on its mirrored copy on the watch. **Where a Reply runs:** it is a background action, and Apple runs a background action on the device the push was sent to, which is the iPhone even when Reply is tapped on the watch (Apple, "Adding actions to notifications on watchOS"). So the phone sends every notification reply, without opening a screen, through the thread's own path: online with a fresh idempotency key, into the outbox on a transport or server error when the app is running, never queued when refused. When a reply doesn't simply go, the phone posts a local notice ("Couldn't send your reply", with the server's words or "Open Gradus to try again") that opens the conversation. **On the watch, a tap** on a message notification opens that conversation in the Gradus watch app (Apple delivers the default tap to the watch app): the 20 most recent messages, newest at the bottom, the room marked read on open, and a reply by dictation, Scribble, the keyboard or a quick reply ("Thanks!", "Got it", "See you soon", "On my way"). The watch sends online with an idempotency key and has no outbox: a reply that fails stays on screen with "Try again", which reuses the key. The watch home gains a Messages row for every role. **Text only from the wrist, for every role** (#32, #48): dictation and Scribble become text on the device and Gradus never receives audio; a voice note someone sent shows as "Voice note — play it on your iPhone", with its transcript when the server has one. Old app builds ignore an unknown category, so the server change ships safely before the iOS build. No custom long-look interface: the system one shows the title, the full body and Reply. **Review (2026-10-11):** Reply requires the device to be unlocked (`.authenticationRequired`), and while the in-app Face ID lock is on the iPhone registers the category without Reply, so a tap opens the app and its lock. Sign-out and an account switch clear delivered notifications, and every push carries `gradus.uid` (§6.6) so a leftover one can't reply or open as the wrong account. |
| 55 | Home Screen widgets: practice and Today, no Live Board widget | **2026-10-17 (Mariah):** the Home Screen widgets in 1.0 are **Practice goals** for parents and athletes (medium: practice logged each day this week against the coach's weekly target, and the level being worked towards; a parent sees up to two children; it fetches for itself every 30 minutes on its own session) and **Today** for coaches (medium: today's lessons with a practice ring per athlete toward their weekly target, ‹ › to page, a tap opens the pre-lesson briefing). gradus-ios #133 and #135. **The Live Board Home Screen widget (I15, package 3.8) is removed** (gradus-ios #158): parents and coaches kept finding the competition widget in the gallery instead of the new ones. The Live Board **Live Activity** (Lock Screen and Dynamic Island while a followed skater's event is live) stays. A Live Board widget already on a Home Screen stops loading once the build without it installs. *2026-10-18, #57:* the widgets' data is now rebuilt at most every two hours, and only while that widget is on the Home Screen. |
| 56 | A minor's room always needs their parent, whatever the verification switch says | **2026-10-19 (Mariah, TestFlight build 101):** test coach Jordan Marsh added a 13–17 athlete with a parent email and could direct-message her before the parent had joined. The room rule's parent-linked half is now **always on**: a room with a minor opens, and accepts sends, only once a parent is linked to the athlete; `PARENT_VERIFICATION_REQUIRED` decides only whether that parent must also have verified as an adult. **A coach can share plans with such an athlete but never message them**, and when a plan goes live the parent or guardian on file keeps getting the existing **Guardian message copy** email (`guardian-activity`, "Assigned a new plan: …", with the claim link), which `setPlanStatus` already sent; **no new email template** (Mariah, 2026-10-19: the emails already exist in Lovable, only make sure they are triggered). The new-conversation picker leaves these athletes out, the roster carries `canMessage` so the apps hide the Message button, and an already-open room shows `messagingClosedMessage` in place of its composer. **Only the server writes messages:** migration `20261019180000_messages_server_only_insert` drops the client INSERT policy on `public.messages` and revokes INSERT from `authenticated`, so the room rule cannot be skipped with a crafted request from a participant's own session (adversarial review finding, 2026-10-19; Lovable applies it). The watch app shows the same closed notice in place of its reply box. Web #253, gradus-ios #173. |
| 57 | Widget refresh cadence: at most every two hours | **2026-10-18 (Mariah):** TestFlight build 98 felt slow everywhere. Her iPhone's log showed why: on every account check (each launch, each return to the app, each reconnect) the app rebuilt the coach's **Today** widget data in the background, 8 day-by-day `GET /coach/up-next` calls plus one athlete page per student plus one session log per active plan, all at the same instant, and then asked the widget to fetch it again. That was 24 bursts of 9–36 requests in eight minutes; the server answered everything, including the screen she was looking at, in 10–15 s, with HTTP 500s in groups of 6–8. **Decision:** widget data is rebuilt **at most every two hours** ("we do not need to know practice totals with such precision, and an athlete isn't logging practices within two hours of seeing their coach"), **only while that widget is on the Home Screen**, with **three requests in flight at a time**, and never just because the app reopened. The app and the widget extension share the two-hour clock for the Today widget; the Practice goals widget keeps its own 30-minute fetch on its own session, so a practice an athlete logs still shows within half an hour. Accepted trade-off: a lesson rescheduled or cancelled in the app can take up to two hours to reach the coach's widget. In the same pass the app stopped calling a dropped Wi-Fi ↔ cellular hop "You're offline" (it now says "Can't reach Gradus right now"), retries a read once only when the connection was cut, and gives up on a slow read after 30 s instead of 60. gradus-ios #169, #171, #172. Two follow-ups are parked in §12 #36 and #37. |
| 58 | "Upgrade to Coach Pro" link at the roster cap, US storefront only | **2026-10-21 (Mariah):** amends §6.8 rule 2, which had banned the wording. The schedule-import flow shows an "Upgrade to Coach Pro" link next to the roster-cap row, in the review screen's seat summary, and on the Done screen, on the US storefront only, opening the web paywall (`CoachBilling.manageUrl`) in Safari (rule 3). "Your roster is full on your current plan." stays the limit sentence; other storefronts get it with no link and no plan name. **Built:** gradus-ios #176 and #177, merged 2026-10-23. |
| 59 | Coaches never enter a birthdate: Under 18 / Over 18 only | **2026-10-27 (Mariah):** "I don't want coaches entering athlete DOB, just a checkbox whether they are over- or under-18." Amends #30 for coach-entered athletes. The iOS "New athlete" form and the schedule-import review card ask **Under 18 / Over 18** (no date of birth). Under 18 takes the parent or guardian's first and last name and email; the name is stored on the athlete row (`athletes.guardian_first_name` / `guardian_last_name`, migration `20261027120000`) and shows on the roster until the parent claims, when the parent's own profile name wins. Over 18 takes the athlete's own email and invites the athlete directly in their own voice (`invite_recipient: athlete`; `adultConfirmed: true` on `POST /coach/athletes`, `emailRecipient: athlete` on the import commit). The coach's choice decides only who gets the invite: age assurance still comes from the athlete's or parent's own sign-up, and an athlete with no birthdate on file keeps the minor-or-unconfirmed rules until then. The web app's forms keep their birthdate field. Web #256, gradus-ios #180. |

---

## 1. Summary

Gradus is a coaching platform for the time between lessons: coaches write practice plans, athletes and parents run them with a session timer and log how practice felt, everyone messages in one shared room, and coaches get AI briefings before each lesson. A public Live Board shows who is on the ice, latest scores, and who is up next at U.S. Figure Skating competitions.

Today Gradus ships as a server-rendered React web app (TanStack Start on Cloudflare Workers, Supabase behind it, built in Lovable), installable as a PWA, with a Capacitor shell prepared for the stores. That shell was always a compromise: it depends on a live network connection for every screen, cannot run a session timer reliably in the background, cannot show a Live Activity, and offers nothing a rink with poor reception can use.

This project rebuilds the coach, parent, and athlete experience as a native SwiftUI app while **keeping exactly one backend**. The web app is not forked, migrated, or changed in any user-visible way during the build. iOS reaches the same database, the same auth users, the same storage buckets, and the same server logic through a new versioned API that lives in the web repository and deploys through the same Lovable publish the web uses today. The Swift app itself lives in its own repository, `gradus-ios`, and consumes that API through a generated client. When the Kotlin app follows, it consumes the same API from `gradus-android`.

**Store presence.** *Amended 2026-09-19:* the native app is the first store release, version 1.0. The earlier plan to ship the Capacitor shell as 1.0 and replace it with native 2.0 is dropped; §10.5 stays only as the record of that decision. No user ever migrates from a shell.

**What changes for users:** the app works offline, the session timer survives the phone locking, messages and plan assignments arrive as push notifications, Face ID unlocks the app, the Live Board shows up in the Dynamic Island, and everything feels like an iPhone app rather than a web page. **What does not change:** their account, their data, their coach connections, their subscription, and the web app they use today.

### Non-goals

- Android, macOS (Catalyst), or visionOS. *Amended 2026-10-03:* watchOS is **in scope** for 1.0 (decision #36, §6.15).
- Org admin or internal admin features on iOS.
- Purchasing subscriptions in-app.
- Migrating off Lovable Cloud or changing the Supabase project. (Documented as a possible later project in §11.)
- Rewriting AI prompts, the IJS scraper, the email system, Stripe webhooks, or any server behavior that is not required for the iOS client. *Amended 2026-09-20:* §6.7 and §10.7 now change the Ask Gradus, plan-draft, athlete-summary, and briefing prompts on purpose, under the §4.1 rules and with the web receiving the same improved answers. The rest of this bullet stands.
- Redesigning the product. Screens may be reorganized to fit iOS idioms, but the information architecture, copy, and flows are ported, not reinvented.

---

## 2. Goals and success metrics

### Product goals

1. **A coach can run their week from the rink.** Roster, today's lessons, the athlete's plan, the pre-lesson briefing, and messaging all work with no or intermittent connectivity.
2. **A practice session is effortless to log.** Start the timer, lock the phone, come back, end, rate the flow state. Never lose a session.
3. **Nothing important is missed.** New messages, plan assignments, lesson wrap-up prompts, and Live Board moments arrive as notifications.
4. **The Live Board is the best way to follow a competition on a phone.** Scan a QR code at the rink, follow your skaters, watch the Dynamic Island.
5. **Feature parity with the web app for coaches, parents, and athletes**, so the web can be sunset for those roles.
6. **Gradus learns each athlete and answers from vetted sources** *(added 2026-09-20)*. Every plan draft, briefing, and athlete summary reads a longitudinal profile of that athlete built from what coaches, athletes, parents, and judges have already recorded; Ask Gradus answers from a cited corpus. See §6.7.

### Success metrics (measure from launch)

| Metric | Target |
|---|---|
| Crash-free sessions | ≥ 99.5% |
| Cold launch to interactive (cached account) | < 1.5 s on iPhone 12 |
| Sessions started offline that sync successfully | ≥ 99% |
| Message send → recipient push delivered (p50) | < 5 s |
| Live Board data age shown to a viewer (p50) | ≤ 45 s behind IJS |
| App Store rating after 60 days | ≥ 4.6 |
| Web weekly actives among coaches/parents/athletes 90 days after launch | trending to zero, gating the sunset (§10.4) |
| Ask Gradus answers that cite at least one corpus source *(added 2026-09-20)* | ≥ 80% of answers; the rest carry the "not from Gradus sources" label |
| Bench and move-removal prompts a coach answers rather than skips *(added 2026-09-20)* | ≥ 60% |
| Athletes with at least one labeled or protocol-derived skill event 60 days after launch *(added 2026-09-20)* | ≥ 70% of athletes with an active plan |

### Guardrails (must not regress during the build)

- Web error rate in the admin errors dashboard.
- Web sign-in success rate.
- Email deliverability health.
- Web p75 page load, measured before Phase 0 begins and re-checked after every backend publish.

---

## 3. Users and roles

Gradus resolves a signed-in user's role server-side from which profile rows exist (see `getMyRole`): coach if a coach profile exists, else parent, else athlete, else org admin. The iOS app uses the same resolution through the API and never infers role client-side.

| Role | Who | In native 2.0 | Notes |
|---|---|---|---|
| **Coach** | Private-lesson coaches, mostly figure skating; also multi-sport and strength & conditioning | Yes | Subscription tiers: Coach, Coach Pro, Club (via organization). Founding Coaches (onboarded before 2026-11-01) are free for life. |
| **Parent / guardian** | Parent of a minor athlete; up to three guardians per athlete on the Team plan | Yes | Creates athletes, links coaches, runs sessions for young athletes, manages the athlete's login. |
| **Athlete (minor)** | Created by a parent, logs in with a **username** (no email) | Yes | Restricted messaging persona, Safe Sport resources, youth-safe Ask Gradus. *2026-09-24:* 13–17 may also self-sign-up into a **provisional** account with a parent email; under 13 never self-sign-up (§6.13). |
| **Athlete (adult, self-managed)** | Signs up directly, links coaches themselves | Yes | Has an invite code for coaches; can manage own schedules and goals. |
| Org admin | Club purchaser or director | **No** (web) | Roster of club coaches, coach invites, templates, calendar. |
| Internal admin | Gradus staff | **No** (web) | 30 admin routes: users, billing, emails, errors, impersonation, competitions, promo codes. |

Minors: the app never markets to children and does not enroll in Apple's Kids Category (it forbids external links and third-party analytics). Athlete birthdates are collected by the parent; the app must surface age-appropriate personas exactly as the web does. *2026-09-24:* every parent account linked to a minor is a **verified adult**, and a minor's account, coach links and rooms wait on that verification (§6.13, decisions #29–#33).

---

## 4. Non-negotiable constraints

These are the rules that protect current web users. Every backend pull request is checked against them before merge, and they are restated in the CI checklist (§9.6).

### 4.1 Zero-disruption guarantees for the web app

1. **No change to web-facing server functions.** Every `createServerFn` keeps its name, input schema, return shape, and behavior. Refactors that extract shared logic must be behavior-preserving and are verified by `bun run typecheck`, `bun run lint`, `bun run build`, and a manual smoke pass in Lovable preview before publish.
2. **Additive database changes only** until the web is sunset. New tables, new nullable columns, new indexes, new RLS policies, new functions. No renames, drops, type changes, or tightened constraints on existing tables. Every new `public` table ships with GRANTs and RLS in the same migration (existing repo rule).
3. **No change to Supabase Auth settings the web depends on.** Captcha protection stays on. The Lovable-managed Google provider stays as is. Email templates stay as is. iOS gets its own auth endpoints (§6.4) rather than changing shared settings.
4. **The API is additive and isolated.** It lives under `src/routes/api/v1/`, shares nothing with the web client bundle, and has a server-side kill switch (`API_V1_ENABLED`) that disables it without a redeploy of anything else.
5. **Same deploy path, smaller steps.** Backend changes ship through the existing Lovable publish, in small independently revertible PRs, never bundled with unrelated web work. Migrations that touch shared tables are applied first in Lovable preview, then published in US evening hours.
6. **Web bundle budget unchanged.** No new client-side dependencies for the web. New server code lives in `.server.ts` files, which are never reachable from a client import chain.
7. **Push is best-effort.** A push-send failure never fails the underlying action (message send, plan activation).
8. **Observe after every publish.** The admin errors dashboard and email health page are checked after each backend publish; a regression triggers a revert first and a diagnosis second.
9. **Sunset is a separate decision.** Until the criteria in §10.4 are met and Mariah decides, the web app for all roles is fully supported, including bug fixes.
10. **No credential or key moves.** The Supabase publishable key, service role key, Stripe keys, and AI keys stay where they are. iOS only ever holds the publishable key.
11. **Migration files that reach `main` through GitHub are NOT applied by a Lovable publish.** Confirmed 2026-09-05: after two publishes the SQL precheck returned NULL for every `/api/v1` relation and the rate limiter silently allowed every request; Mariah asked Lovable to apply the pending migrations (Lovable recorded it as the commit "Applied pending migrations"); the precheck then returned all of them and the limiter enforced its limit. Every backend PR that adds a migration therefore ends with two steps after merge: ask Lovable to apply pending migrations, then run the precheck in `docs/api/SMOKE.md`. Nothing that reads a new relation is enabled before both are done. Code guarding public write endpoints fails closed and logs when its table is unreachable.
12. **Service-role-only database functions revoke EXECUTE from `anon` and `authenticated` explicitly.** Supabase's default privileges grant EXECUTE on every new function directly to those roles, so `REVOKE ... FROM PUBLIC` alone leaves it callable by anyone holding the public key (found 2026-09-05: `find_confirmed_user_by_email` answered anonymous PostgREST calls with real user ids). Every such migration ends with `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role;` and is verified by an anonymous call to `/rest/v1/rpc/<fn>` returning permission denied.
13. **Billing and membership columns on profile tables are server-only.** `coach_profiles` (entitlement, subscription, Stripe, founding, free-access, trial, promo, organization, org-admin) and `parent_profiles` (subscription, Stripe, promo, team seats) are guarded by `BEFORE INSERT OR UPDATE` triggers that reject changes unless the caller is the service role (migration `20260905200000_protect_billing_columns`). Row policies cannot restrict columns, so a user could otherwise PATCH their own row through PostgREST (Lovable schema review, 2026-09-05). Server functions write these columns through the admin client only; never through `context.supabase`. Verified with the guard check in `docs/api/SMOKE.md`.

### 4.2 Platform constraints (facts, verified 2026-09-04)

- **Supabase Auth captcha.** The project has Turnstile captcha enabled at the Auth layer (the web passes `captchaToken` into `signInWithPassword`, `signUp`, and `resetPasswordForEmail`). Supabase Auth **skips captcha** when the request uses the `id_token`, `refresh_token`, or `pkce` grant, or when it carries service-role credentials. It **enforces** captcha on the password grant, sign-up, and recovery. This shapes §6.4.
- **No direct Supabase dashboard.** The backend is a Lovable Cloud project. Lovable Cloud exposes a SQL editor, table views, RLS review, secrets, edge functions with schedules and database triggers, and auth settings including Google sign-in (managed by Lovable or with your own credentials). It does **not** expose a Sign in with Apple provider. Anything that needs a provider Lovable Cloud does not expose must be done in our own server code.
- **Google sign-in is brokered.** The web uses `@lovable.dev/cloud-auth-js`, which runs the OAuth dance on Lovable's broker and hands back Supabase tokens. That is a web redirect flow, not a native one.
- **Server logic depends on the service role.** 49 of 67 server-function files use the admin client. Row Level Security alone cannot power a native client; an API layer is required.
- **Cloudflare Workers can reach APNs.** Workers `fetch` speaks HTTP/2 and has WebCrypto for signing the APNs JWT, so the push sender can live in the existing Worker.
- **TLS certificates rotate.** gradus.training certificates are Cloudflare-managed and rotate roughly every 90 days. **Do not pin certificates** (see `docs` memory: ATS pinning decision). Use ATS defaults; add a CAA record at the DNS level instead.
- **Apple Developer enrollment** was approved on 2026-09-19 (D-U-N-S applied 2026-08-29). App Store Connect is not set up yet: no App ID, no APNs or Sign in with Apple keys, no Team ID in the project, no Xcode Cloud. Until those exist: no TestFlight, no push testing, no Sign in with Apple testing on a device, no Associated Domains. The account-side steps are listed in §10.6 and in gradus-ios `docs/enrollment-checklist.md`.

---

## 5. Current system snapshot

Measured on `main` at commit `e6b21f48` (2026-09-03).

| Measure | Count |
|---|---|
| Route files | 107 (31 coach/parent/athlete, 27 admin, 7 org-admin, 10 sign-up, 6 auth and layouts, 9 public and legal, 17 API, email, and dev) |
| Server functions (`createServerFn`) | 370 total; 293 in the 53 non-admin files (the rest are admin, email, impersonation, error tracking, and Turnstile) |
| Public tables | 75, with 341 RLS policies across 173 migrations |
| Lines of TypeScript | ~96,000 (routes 28k, components 25k, lib 35k) |
| Realtime channels | `messages` table via `postgres_changes` (room view and unread badge) |
| Storage buckets | `voice-notes` (private, room-participant RLS), `resource-pdfs` (signed URLs) |
| External services | Supabase, Stripe (subscriptions + billing portal), Lovable AI Gateway → Gemini 2.5 Flash / Gemini 3 Flash preview, ElevenLabs Scribe v2 (transcription), Cloudflare Turnstile, pg_cron → Worker hook routes, USFS IJS results pages (scraped) |
| Client-side platform code | `src/lib/native.ts`, `native-push.ts`, `native-biometric.ts` (Capacitor; inert on web) |

### What is reused as-is

Database schema and RLS; all server-side business logic (after being made callable from the API); Stripe integration; AI prompts and gateway; transcription; email system; IJS scraper and snapshot cache; invite code system; account deletion and message tombstoning; report/block system; terms versioning.

### What is rebuilt natively

Every screen for coach, parent, and athlete; navigation; auth UI; offline store and sync; push handling; Live Board presentation and Live Activities; voice capture and playback; camera capture for schedule import; PDF viewing; share sheets; haptics; biometric gate.

### What is added server-side

The `/api/v1` layer (§6.2); auth broker endpoints for Apple, Google, and password sign-in (§6.4); APNs sender and notification triggers (§6.6); idempotency and pagination support; OpenAPI spec generation; a small number of additive tables (`api_idempotency_keys`, `auth_identities`, `board_follows`, `live_activity_tokens`). *Added 2026-09-20 (§6.7):* the `vector` extension and the tables `athlete_skill_events`, `athlete_goals_history` (web PR #129), `knowledge_sources`, `knowledge_chunks`; a knowledge-ingestion path that runs inside the Worker; and a derived athlete profile that the existing prompts consume.

---

## 6. Architecture

### 6.1 One backend, two clients

```
                ┌──────────────────────────────────────────────────────────────┐
                │  Lovable Cloud (Supabase project sdqfaqxmdmujxqhwlqdi)        │
                │  Postgres + RLS · Auth (GoTrue) · Storage · Realtime · pg_cron│
                └───────────────▲──────────────────────────────▲───────────────┘
                                │ service role                 │ publishable key + user JWT
                                │                              │ (auth session, realtime,
                                │                              │  storage signed URLs)
┌───────────────────────────────┴───────────────┐              │
│  gradus.training  (Cloudflare Worker,          │              │
│  TanStack Start app in THIS repo)              │              │
│                                                │              │
│  ┌──────────────────┐   ┌───────────────────┐  │              │
│  │ Web UI (SSR+SPA) │   │ /api/v1/* (JSON)  │  │              │
│  │ server functions │   │ OpenAPI 3.1       │  │              │
│  └────────┬─────────┘   └─────────┬─────────┘  │              │
│           │  both call the same   │            │              │
│           └──────► src/lib/*.server.ts ◄───────┘            │
│                    (shared domain logic)                     │
│  Stripe · AI gateway · ElevenLabs · IJS scraper · APNs sender│
└───────────────────────────────▲──────────────────────────────┘
                                │ HTTPS, Bearer <Supabase access token>
             ┌──────────────────┴───────────────┐      ┌───────────────────────┐
             │  Web browser / PWA (unchanged)    │      │  Gradus for iOS (new)  │
             └──────────────────────────────────┘      │  later: Gradus Android │
                                                       └───────────┬───────────┘
                                                                   │
                                                                   └── direct to Supabase for auth session,
                                                                       realtime on messages, storage URLs
```

**Why this answers "how do web and mobile stay in sync."** There is one database, one set of auth users, one storage bucket set, and one copy of the business logic. The web reaches that logic through TanStack server functions; iOS reaches it through `/api/v1`. Both are thin transports over the same TypeScript functions, so a fix or a rule change lands in both clients the moment it is published. Nothing is copied, mirrored, or scheduled to sync, so nothing can drift.

**Why the API lives in this repo rather than in Supabase Edge Functions.** The logic already exists here in Node-flavored TypeScript with the service role, Stripe, AI, and transcription wired in. Wrapping it is days of work; porting ~290 functions to Deno edge functions is weeks, and it would require the web app to be re-pointed at the new functions, which is exactly the kind of change §4 forbids. Edge functions remain a good fit for database-triggered jobs (see push, §6.6) and are used where they are the simplest tool.

**Why this is the scalable long-term shape.** The API is versioned, transport-agnostic, and described by an OpenAPI document that generates the Swift client (and later the Kotlin client). When the web is sunset for the three roles, the TanStack app shrinks to the admin panel plus the API; if it is ever useful to split the API into its own Worker or service, clients do not change. If Gradus later takes ownership of its Supabase project (§11), the API is the only thing that needs re-pointing.

### 6.2 Backend API v1

**Location and deployment.** File routes under `src/routes/api/v1/**` in this repo, served by the same Worker at `https://gradus.training/api/v1/...`. Deployed by the existing Lovable publish. A `src/lib/api/` folder holds the shared plumbing (auth, errors, idempotency, OpenAPI registry).

**Implementation pattern (behavior-preserving).** For each domain file `src/lib/<domain>.functions.ts`:

1. Move each handler body into an exported function in `src/lib/<domain>.server.ts` (create if missing) with the signature `fn(ctx: ApiContext, input: Input): Promise<Output>`, where `ApiContext = { userId, supabase (user-scoped), admin (service role) }`. The zod input schema and the output type move with it and are exported.
2. The server function becomes a three-line wrapper: middleware → validate with the same schema → call the shared function. Its name, schema, and return type do not change.
3. The API route imports the same schema and function, validates the JSON body, calls it, and serializes the result. The route registers itself with the OpenAPI registry using the same schema.
4. Each domain is one PR, merged only when typecheck, lint, and build pass and the affected web screens have been smoke-tested in Lovable preview.

**Authentication.** `Authorization: Bearer <Supabase access token>`, verified exactly as `requireSupabaseAuth` does today (`auth.getClaims`). Public endpoints (Live Board, shared plan) are explicitly marked and rate-limited. Role checks happen inside the shared functions, as today.

**Request and response conventions.**

| Concern | Rule |
|---|---|
| Versioning | Path prefix `/api/v1`. Within v1 only additive changes (new optional fields, new endpoints). Breaking changes create `/api/v2`. |
| Client identification | `X-Gradus-Client: ios/1.4.0+87` header. `GET /api/v1/meta/client-policy` returns `minSupportedVersion` and an optional message so the app can force an update. |
| Content type | JSON in and out. Multipart for audio and images. Dates as ISO 8601 UTC strings. IDs as UUID strings. Money as integer cents plus currency. |
| Errors | `{"error": {"code": "roster_full", "message": "...", "details": {...}}}` with stable snake_case codes. Existing string-matched errors (for example the roster cap trigger's "Roster full:") are mapped to codes at the boundary. HTTP 400 validation, 401 unauthenticated, 403 forbidden, 404 not found, 409 conflict, 422 domain rule, 429 rate limited, 5xx server. |
| Idempotency | Creating POSTs (`messages`, `sessions`, `invoices`, `lesson-slots`, `plans`) accept an `Idempotency-Key` header. The server stores `(user_id, key) → response` in `api_idempotency_keys` for 24 hours and replays the stored response on retry. Required by the offline mutation queue. |
| Pagination | Cursor-based on unbounded lists: `?limit=50&cursor=<opaque>` returning `{ items, nextCursor }`. Applies to room messages (today capped at 500 in one call), plan sessions, invoices, admin-style lists. Small per-user collections (roster, plans, moves) return whole with an `ETag`; clients send `If-None-Match` and get `304`. |
| Rate limiting | DB-backed sliding window (same pattern as the existing `record_invite_lookup_attempt` RPC) on auth endpoints, invite lookups, AI endpoints, and public board endpoints. Keyed by IP and, when authenticated, by user. |
| Kill switch | `API_V1_ENABLED` environment variable. When false every `/api/v1` route returns 503 with a friendly message and the app shows its offline cache. |
| Documentation | OpenAPI 3.1 generated from the zod schemas at build time to `docs/api/openapi.json` in the web repo. CI fails if the committed file is out of date. The `gradus-ios` repo vendors that file at a pinned web-repo commit and generates the Swift client with `swift-openapi-generator`. |

**Composite endpoints.** A few endpoints exist only for the client's benefit and aggregate several server functions, to avoid launch-time request storms on mobile networks: `GET /api/v1/me` (role, profile summary, onboarding state, entitlement, terms status, guardian status, feature flags, unread count) and `GET /api/v1/coach/home?week=` (roster, week occurrences, practice summaries, pending wrap-ups, pending post-event items).

The full mapping from server functions to endpoints is in Appendix A.

### 6.3 What iOS talks to Supabase about directly

Only the parts where the Supabase SDK is the right tool and RLS already governs access:

| Use | How | Why direct |
|---|---|---|
| Session storage and refresh | `supabase-swift` Auth with Keychain storage; `refresh_token` grant is captcha-exempt | The SDK handles expiry, refresh, and token rotation correctly. |
| Realtime messages | `postgres_changes` on `public.messages` filtered by room, same as the web's `room:<id>` channel; plus an unread listener | Realtime is already published and RLS-scoped to participants. |
| Voice note upload/playback | Upload to `voice-notes/<roomId>/<uuid>.m4a`; download via signed URL | Bucket policies already scope to room participants; avoids proxying audio through the Worker. |
| Resource PDFs | Signed URL from the API, then direct download | Same as web. |

Everything else goes through the API. The app never issues ad-hoc table queries; that keeps the RLS surface the web already relies on unchanged and keeps business rules in one place.

### 6.4 Authentication and account

**Requirement.** Because the web offers Google sign-in, App Store Guideline 4.8 requires the iOS app to offer Sign in with Apple (or an equivalent privacy-preserving option). Sign in with Apple is therefore **P0** and must exist before the first App Store submission.

**Constraint recap.** No Apple provider can be configured in Lovable Cloud. Captcha blocks direct password sign-in from a native client. Google is brokered by Lovable's web flow.

**Design: the API is the identity broker.** iOS never depends on provider settings that Lovable Cloud does not expose. The Worker already holds the service role, which both bypasses captcha and can mint sessions. The same broker gives the Capacitor 1.0 shell its Sign in with Apple: a Capacitor plugin (`@capacitor-community/apple-sign-in`) shows the native Apple sheet, and the web code posts the identity token to `/auth/apple` and calls `setSession`, exactly as the native app does.

| Flow | Client | Server (`/api/v1/auth/*`) |
|---|---|---|
| **Sign in with Apple** | `ASAuthorizationController` with a hashed nonce; receive identity token, user identifier, and (first time only) name and email | `POST /auth/apple {identityToken, nonce, fullName?}` → verify JWT signature against Apple JWKS, check `aud == training.gradus.app` and nonce → look up `auth_identities(provider='apple', provider_sub)`; else match a confirmed user by email; else create the user via admin API with `email_confirm: true` → mint a session (admin `generateLink(type: magiclink)` then `verifyOtp` with the token hash using service-role credentials) → return `{access_token, refresh_token, expires_in, isNewUser}` → client calls `auth.setSession`. Handle Apple private-relay emails as normal emails. |
| **Google** | Native `GoogleSignIn` SDK (or `ASWebAuthenticationSession` with PKCE) → ID token | `POST /auth/google {idToken}` → verify against Google JWKS and the iOS client ID → same identity lookup and session mint. **Alternative** if Lovable Cloud's "your own credentials" Google setup exposes authorized client IDs: use `signInWithIdToken` directly (captcha-exempt). Decide during Phase 0 (§12). *2026-09-19:* the broker exists; on iOS the provider is a stub and the button is **hidden until `GOOGLE_IOS_CLIENT_ID` is configured** (Mariah's call). |
| **Email or username + password** | Native form | `POST /auth/password {identifier, password}` → if identifier has no `@`, resolve username to the synthetic email `athlete-<id>@users.gradus.training` (existing logic in `resolveAthleteLogin`) → call the GoTrue password grant with service-role `Authorization` (captcha-exempt) → return the session. Rate-limited per IP and per identifier; generic error on failure. |
| **Coach email sign-up** | Native form | `POST /auth/signup/coach {email, password, promoCode?, inviteCode?}` → admin create user honoring the project's email-confirmation setting → session mint if confirmation is off; otherwise return `confirmationRequired`. Verify the current setting in Lovable Cloud during Phase 0. |
| **Parent, minor athlete, adult athlete sign-up** | Native flows | Already server-side today (`startParentSignup`, `signupAthleteWithUsername`, `createSelfManagedAthlete`); exposed as-is under `/signup/*`. |
| **Forgot password** | Native form | `POST /auth/recover {email}` → `resetPasswordForEmail` with service-role credentials (captcha-exempt). The emailed link opens the existing web reset page in the P0 wave; the P1 wave opens the app via universal link and calls `auth.updateUser`. |
| **Change password / email** | Settings → Account & security | `auth.updateUser` directly through the SDK (authenticated, no captcha). |
| **Sign out** | Settings | `DELETE /devices/{token}` then `auth.signOut()`; clear local store and Keychain. |
| **Delete account** | Settings → Account & security | `GET /me/deletion-impact` then `DELETE /me` (existing logic including message tombstoning). Because Sign in with Apple is offered, the server must also **revoke the Apple token** (`POST https://appleid.apple.com/auth/revoke`) using the Sign in with Apple key. Needs the `.p8` from the developer account. |

**Session and device security.** Tokens live in the Keychain (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`). Optional Face ID / Touch ID gate on launch and on return from background (mirrors today's `native-biometric.ts` semantics: a local convenience lock, not an auth mechanism). No token is ever logged or sent to any third party.

**Terms.** On every launch with a session, compare `termsVersion` from `/me` with `CURRENT_TERMS_VERSION` (currently `2026-10-11`; bumped with the 2026-10 terms revision, web #220; the terms themselves are published only on gradussports.com, and `/terms` redirects there); if stale, present a blocking acceptance sheet that calls `POST /me/terms/accept`. Signup screens include the same checkbox the web has. *2026-10-02:* the sheet waits for a profile. `POST /me/terms/accept` answers `deferred` until a coach, parent or athlete row exists, so a session whose `/me` has no role (a brand-new Sign in with Apple user, or an email sign-up before its profile) is never shown a sheet it cannot accept; the agreement given on the sign-up form or the in-app role chooser is recorded by each onboarding flow right after it creates the profile, as the web's `_authenticated` layout does.

**Account switching.** The local store is keyed by user id. Signing out wipes it. There is no multi-account mode in v1.

**Bot protection without Turnstile.** The API's auth endpoints rely on rate limiting, generic error responses, and Apple's App Attest as an optional Phase 3 hardening (`DCAppAttestService` assertion attached to auth requests; server verifies and can require it for the password endpoint once adoption is high).

### 6.5 Offline and sync

**Principle.** The app renders from a local store and treats the network as a way to refresh that store and drain a queue of pending changes. A user should never see a spinner for something they looked at an hour ago, and should never lose a session or a message because the rink has no signal.

**Local store.** SwiftData (iOS 18 baseline) behind a repository layer. Models mirror API DTOs, not database tables, so the schema follows the OpenAPI document. Each record carries `serverUpdatedAt`, `fetchedAt`, and a `syncState` (`synced`, `pendingCreate`, `pendingUpdate`, `pendingDelete`, `failed`). A `PendingMutation` table holds the outbox: endpoint, method, body, idempotency key, attempt count, last error, created time. If SwiftData proves unsuitable for the outbox under real load, GRDB is the sanctioned fallback; the repository interface hides the choice.

**Refresh policy per entity.**

| Entity | Refresh | Staleness the UI tolerates |
|---|---|---|
| `/me`, flags, entitlement | On launch, on foreground, after sign-in | 24 h; entitlement changes also arrive by push |
| Roster, lesson slots, practice summaries | On tab open with `If-None-Match`; background refresh every 4 h | 7 days (schedule is stable) |
| Plans and plan moves | On tab open; per-plan on open; after any edit | 7 days |
| Move library | On plan editor open | 30 days |
| Rooms list + last message | On tab open + realtime | 1 h; badge from push |
| Room messages | Cursor page on open; realtime while open; newest 200 cached per room | Unlimited (history is append-only) |
| Plan sessions | On plan open; own sessions cached indefinitely | Unlimited |
| Athlete detail, AI summaries, briefings | On open; cached with the server's content hash | Show cached with "as of" label; refresh on demand |
| Resources list | On tab open | 7 days; PDFs cached on device after first open |
| Live Board | 30 s while visible; ETag; Live Activity via push | Shows "Updated Xs ago"; degrades visibly after 3 min |

**Mutation queue.** Every write goes through the repository: apply optimistically to the local store, enqueue the mutation, attempt immediately if online. The drainer runs on foreground, on connectivity change, and in a `BGAppRefreshTask`. Retries use exponential backoff with jitter; 4xx responses other than 429 stop retrying and mark the record `failed` with the server's error code. Idempotency keys make retries safe.

**Conflict policy.** Append-only entities (messages, sessions, reports, feedback) cannot conflict. Scalar edits (plan title, notes, move fields, lesson slot times) are last-writer-wins by server time; the server returns the winning record and the client replaces its copy. Structural edits (reordering plan moves, activating a plan when the max-active rule would be violated) can be rejected with 409/422; the app surfaces these in a **Sync Center** (Settings → "Pending changes") where the user can retry or discard. The Sync Center badge appears on the Settings tab whenever anything is `failed`.

**What works offline.**

| Works fully | Works with queueing | Needs a connection |
|---|---|---|
| Browse roster, week schedule, athlete details (cached) | Create/edit lesson slots, cancel or reschedule an occurrence | Schedule import (camera → AI) |
| Browse plans, moves, templates; read plan detail | Edit plan fields, add/reorder/remove moves, activate/bench | Voice transcription and AI plan build (audio is saved locally and sent when online) |
| Run the session timer end to end; rate flow state | Submit the session | AI session summary, AI athlete summary, pre-lesson briefing refresh, AI move drafts (#53) |
| Read cached conversations | Send text messages and voice notes (queued, shown as "Sending…") | Live Board, Ask Gradus, new conversation with someone not cached |
| Read cached resources and downloaded PDFs | Save an Ask Gradus answer for later | Sign in, sign up, invites, billing, account deletion |

**Session timer specifics.** The timer stores a start timestamp and accumulated pause intervals, never a running counter, so it is correct after the app is killed. A Live Activity shows elapsed time on the Lock Screen and Dynamic Island; a local notification ("Still practicing?") reminds an hour after the app goes to the background with the timer running. The web's `gradus.activeSession.v1` semantics (one active session per user, resumable) are preserved; the server remains the source of truth once submitted.

### 6.6 Realtime and push notifications

**Realtime.** Room views subscribe to `postgres_changes` on `messages` for the open room; the rooms list subscribes to inserts across the user's rooms to update previews and badges, replacing the web's polling where it exists. Realtime is a refinement over push and polling, not a dependency: if the channel drops, the room refetches on foreground.

**APNs sender (new server component; not built as of 2026-09-19, milestone P3 in §10.6).** Lives in the Worker (`src/lib/push.server.ts`), uses token-based APNs auth (`.p8` key, key ID, team ID stored as secrets), signs the JWT with WebCrypto, and POSTs to `api.push.apple.com` over HTTP/2. Handles `410 Unregistered` by deleting the token from `device_tokens`. Sends are fire-and-forget from the calling code path (guarantee §4.1.7) with structured logging.

**Triggers (native 2.0).** Because web and iOS share the same server functions after §6.2, every trigger fires regardless of which client performed the action.

| Event | Recipients | Payload route |
|---|---|---|
| New message in a room | Other participants (respecting blocks and the athlete persona rules) | `rooms/{roomId}` |
| Plan activated or assigned | The athlete and their guardians | `plans/{planId}` |
| Lesson wrap-up prompt (after a slot ends) | Coach | `coach/wrap-ups` |
| Lesson reminder (about 15 minutes before a slot starts): "{Athlete} is up next", opening that athlete's Up next briefing | Coach | `coach/roster/briefing/{athleteId}` |
| Practice nudge (three days after a lesson, at its start time held to 08:00–20:00, when no practice has been logged since, no lesson has happened since, and the athlete has an active plan) | The athlete and their guardians | `plans` |
| Guardian or coach connection accepted | The inviting side | `settings/connections` |
| Competition recap prompt (day after a followed competition) | Coach, parent | `recaps/{competitionId}` |
| Entitlement changed (Stripe webhook) | Coach or parent | `settings/plan` (silent push, refresh `/me`) |

Lesson reminders and practice nudges are driven by pg_cron calling Worker hooks (`lesson-reminders` every 5 minutes, `practice-nudges` every 15), matching the existing hooks pattern. Changed 2026-09-27: the reminder used to go to both sides an hour before the lesson; the coach now gets it 15 minutes out, and the athlete side became the practice nudge.

**Payload shape.** `{"aps": {"alert": {...}, "badge": n, "sound": "default", "thread-id": "room:<id>", "category": "GRADUS_MESSAGE"}, "gradus": {"type": "message", "route": "rooms/<id>", "v": 1, "uid": "<recipient user id>"}}`. Badge equals the unread total the server already computes. The app routes on `gradus.route` from a tap, and refreshes the relevant store on a silent push. **Category (added 2026-10-11, #54):** message pushes (`type: "message"`, including the competition-recap message) carry `"category": "GRADUS_MESSAGE"`, which the iPhone and watch apps register with a text **Reply** action (`gradus.reply`); the iPhone handles every Reply, including one tapped on the watch, and sends it to `gradus.route`'s room without opening the app. Other pushes and silent pushes carry no category. An app build that doesn't know the category shows the notification without actions. **Recipient (added 2026-10-11, #54 review):** every push names the account it was sent to in `gradus.uid` (the payload is built per recipient). A notification can outlive a sign-out or an account switch in Notification Center, and household members share rooms, so the apps compare `gradus.uid` with the signed-in account before a Reply or a tap: on a mismatch nothing is sent or opened, and a local notice says "This message was for another Gradus account. Switch accounts to reply." Pushes from before this change have no `uid` and are handled as before.

**Token lifecycle.** Ask for permission in context (first message thread opened, or from Settings), not at first launch. Register via `POST /devices` after permission; re-register whenever APNs rotates the token; `DELETE` on sign-out. Table `device_tokens` already exists with the right shape.

**Live Activities.** Push-to-start tokens (iOS 17.2+) are uploaded to `live_activity_tokens` so the server can start and update a Live Board activity for a followed skater without the app being open. Update frequency is bounded by the board refresh cadence (30 s). The session timer activity is local-only.

### 6.7 AI and voice

**Server-side AI is unchanged.** Ask Gradus, athlete summaries, pre-lesson briefings, session summaries, voice plan building, schedule-image parsing, plan-from-results generation, and (*2026-10-11, #53*) drafts for new moves all run on the server through the Vercel AI SDK (the drafts' Claude step through Anthropic's own SDK). iOS calls the corresponding endpoints and renders results. Long-running calls (briefing refresh, voice build) show progress and are cancellable client-side; the server keeps its current timeouts.

**Provider recommendation (Mariah's question: which route is more scalable?).** Today calls go through the Lovable AI Gateway (`ai.gateway.lovable.dev`) with `LOVABLE_API_KEY`, routed to Gemini. That is convenient but ties quota, billing, rate limits, and model availability to Lovable's plan. The scalable route is a **direct provider key** (Google AI for the same Gemini models) configured through the AI SDK's `@ai-sdk/google` provider. Because every call site already uses the AI SDK, the switch is one provider factory plus an environment variable; the model IDs stay the same so outputs do not change character. Recommended plan: add the direct provider behind an `AI_PROVIDER=lovable|google` switch in Phase 0, canary it on Ask Gradus, then flip the rest. This is invisible to users and reversible in one publish. It is not on the critical path for iOS and can slip without affecting the app. *2026-10-11 (#53):* new-move drafts are the exception: their recognition step calls Anthropic directly (Claude Haiku 5.5 with web search, `move-draft-claude.server.ts`, secret `ANTHROPIC_API_KEY`) and falls back to the same `createLovableAiGatewayProvider` and `google/gemini-2.5-flash` as the plan-session summary, so only the fallback moves when the switch flips.

**Audio capture on iOS.** Record with `AVAudioRecorder` as AAC in an `.m4a` container, mono, 24 kHz, ~32 kbps (voice-optimized; a 90-second note is under 400 KB). Show a live waveform from `averagePower`. Respect the existing limits: 90 s for the voice FAB, 180 s / 18 MB hard cap server-side.

**Transcription endpoint changes.** `voiceTranscribe` currently names the upload `voice.webm` when forwarding to ElevenLabs. The `/voice/transcribe` endpoint must accept `audio/mp4` and `audio/webm`, pass the correct filename and MIME type through, and keep the vocabulary hints (athlete names, move names) the web already sends.

**Voice notes in messages and cross-platform playback.** Web browsers record WebM/Opus; iOS records M4A/AAC. AVFoundation does not play WebM. Policy:

1. New notes from iOS are `.m4a`. New notes from the web should prefer `audio/mp4` where `MediaRecorder` supports it (Safari, current Chrome) and fall back to WebM only where it does not. This is a small web change and must be verified against the §4 rules (no behavior change for users; the message payload already carries the MIME type).
2. iOS plays `.m4a` with `AVPlayer` and plays legacy WebM notes through a hidden `WKWebView` audio element, which WebKit on iOS can decode. Verify on iOS 18 during Phase 1; if WebKit playback proves unreliable, bundle an Opus decoder as a fallback (P1). *As of 2026-09-19 the WebM fallback was never built: iOS shows "Can't play this note here yet" for a web-recorded note.*
3. *2026-09-19 (Mariah):* every voice note gets a **server-side transcript** at send time, stored on the message and returned to both clients, using the ElevenLabs path the guardian mirror already uses. iOS shows it under the bubble and reads it in the VoiceOver label. This is the WCAG 1.2.1 text alternative, and it also gives iOS users the content of legacy WebM notes. Milestone P4 in §10.6.

**On-device transcription.** Apple's `SpeechAnalyzer` (iOS 26+) is an attractive later option for offline dictation. Not in scope; the server pipeline is the source of truth so both platforms behave the same.

**Athlete learning loop (added 2026-09-20; decisions #14, #17, #18).** The claim on gradussports.com is that Gradus learns how long a given athlete takes to develop a new skill, where their ups and downs fall across a season, and folds competition results into the next plan. Today the backend holds one flow state per practice session at the plan level, a coach action (edited / redeployed / dismissed) per lesson wrap-up, a plan status of active or benched with no reason, a level on `athlete_goals` that is overwritten in place, and, for figure skating, the full judged protocol per competition. Nothing records when a skill was first attempted or first landed, so nothing can be learned about pace. The loop closes in two stages:

*Stage one, ships in 1.0 (§10.7 L1–L5): capture the signal and compute the trends deterministically.* There is no per-athlete machine learning in this stage, and none is needed to make the sentences on the website true.

1. **Skill events.** A new additive table `athlete_skill_events` (athlete, coach, move or plan-move, event kind, source, confidence, occurred-at, plan and competition references). Event kinds: `attempted`, `landed`, `consistent`, `parked`, `dropped`. Sources: `coach` (the "why" prompt), `protocol` (a competition element executed clean with non-negative GOE and no `<` or `*` mark), `inferred` (below). Athletes and parents record nothing new; their session log stays a mood and flow measure (§7.6) and is never turned into a per-move checklist.
2. **The coach "why" prompt.** When a coach benches a plan or removes a move from an athlete's plan, the client asks one question with three answers, *landed it / parking it / changed direction*, plus a one-tap skip (decision #17). The answer travels as an optional `reason` on the existing status and removal endpoints and becomes a `landed`, `parked`, or `dropped` event with `source = coach` and confidence 1.0. Skipping writes nothing. The prompt is a native alert on iOS, queued offline with the underlying edit.
3. **Level history.** Every write to `athlete_goals` also appends a row to `athlete_goals_history` (web PR #129: athlete, sport, who changed it by role and user, the new level, season goal and long-term goal, and the previous values of each, with a timestamp). It is written at the app layer by `goals-history.server.ts` from every goal write path, not by a trigger, because a trigger cannot see the author's role when the parent path writes through the admin client; any new goal write path must call the same helper (PR #129 covers the parent, athlete, and parent-onboarding paths; coaches never write goals). Goal deletes (coach unlink, account deletion) leave history in place. For the profile, a level change is a row whose previous level is **non-null and** distinct from its new level: backfilled rows carry previous values equal to their current ones and count as nothing, and the first row after a delete and re-create has no previous level and counts as "level as of that date", not as a change. No UI change for this loop; this is the seasonal-pace signal.
4. **Protocol-derived events.** When a competition result is linked to an athlete (§7.10), each executed element becomes an `attempted` event and each clean element a `landed` event with `source = protocol`. Figure skating only until other sports have structured results.
5. **Inferred events.** A nightly pg_cron job (the existing cron pattern) looks for a move that left a plan without a coach answer, preceded by a sustained run of Locked-in or Flowing sessions on that plan, and writes a `landed` event with `source = inferred` and a confidence between 0 and 1. Inferred events are always shown to the coach as "likely" and are never promoted to certain without a coach or protocol event. The coach-labeled set is the check on the inference: the job's precision against coach labels is logged so the rule can be tuned or switched off.
6. **The athlete profile.** A server-side derived read (SQL over the tables above, computed on request and cached by input hash like the briefing) that yields, per athlete and sport: median days from first attempt to first landing by move category; the flow-state trend over the last 30, 90, and 365 days; competition scores over time; level changes with dates; and the calendar weeks where dips cluster. It is prompt-sized text, contains no free text the gateway has not already seen, and is injected into three existing prompts: plan drafting (`generatePlanFromResults`, which also starts reading the athlete's whole results history rather than one competition, and takes its persona from the athlete's sport rather than a hard-coded figure skating coach), the coach's athlete summary, and the pre-lesson briefing. Each prompt keeps its current instruction to report only what the data shows.
7. **Flow-state labels.** Every producer and consumer of `plan_sessions.state_index` uses the scale in `session-states.ts`: Frustrated / Pushing / Steady / Locked in / Flowing (decision #18). No module may carry its own scale for that column.

*Stage two, after launch (§10.7 L6): a learned model.* Once enough athletes have a season of skill events, a simple survival or regression model for time-to-land per move category, fit across athletes, conditioned on level and age, and personalized per athlete, runs as a scheduled server job and writes predictions to a table the prompts read. It lives where the data lives. **No on-device model** (no Core ML, no Create ML, no on-device training): the one-backend rule in §6.1 means iOS, web, and later Android must see the same athlete, and on-device training would silently diverge between clients. Whether to start L6 is a decision taken on evidence (§12 #17), not a launch commitment.

**Grounded Ask Gradus (added 2026-09-20; decisions #15, #16).** Ask Gradus today sends a persona system prompt and the question, nothing else, so it answers from general model knowledge. It becomes retrieval-augmented: the answer is written from passages retrieved out of a curated corpus, cites them, and says plainly when it had to fall back.

1. **Corpus v1.** (a) The six Athlete Survivors' Assist documents already in the library since 2026-09-20 (Abuse in Sports; Appropriate Athlete–Coach Relationships; Barriers to Reporting Abuse in Sports; Power and Control Wheel; Survivor Safety Plan; What to Do: Abuse & Neglect) and any further Assist material Mariah licenses; (b) the U.S. Center for SafeSport Code and the Minor Athlete Abuse Prevention Policies; (c) one rulebook set per supported sport, starting with figure skating (U.S. Figure Skating rulebook and the ISU technical rules), tennis (USTA *Friend at Court*), and golf (USGA/R&A *Rules of Golf*); (d) the coaching and athlete-development sources Mariah names (§12 #15); (e) each coach's own uploaded resource PDFs, indexed per coach and retrievable only for that coach's athletes and their guardians. Every source has a row in `knowledge_sources` recording title, publisher, version or edition, the rights basis for quoting it, and the date ingested; `docs/knowledge/SOURCES.md` is the human-readable ledger. **Nothing is ingested without a recorded rights basis** (§12 #16). *Corpus v0 (Mariah, 2026-09-20):* L4 is built on what Gradus already has rights to, and the pending sources are registered **cite-only** (`quote_allowed = false`): after ingestion their chunk and page text is scrubbed and only embeddings, section headings and page numbers remain, so an answer can point to the document but never quote it. Quotable today: coach uploads (`coach_upload`), Gradus-written text such as the Safe Sport panel copy (`gradus_owned`), and U.S. federal publications (`public_domain_us_gov`: CDC HEADS UP concussion sheets, the HHS Physical Activity Guidelines, the Safe Sport Authorization Act). Cite-only until permission: The Assist's six documents, the SafeSport Code and MAAPP, the USFS rulebook. The ledger is `docs/knowledge/SOURCES.md`.
2. **Storage.** The `vector` extension; `knowledge_chunks` (source, sport or `all`, coach scope or null, chunk text, section heading, page, embedding, content hash). RLS: global chunks readable by the service role only (retrieval happens server-side); coach-scoped chunks carry the coach id and are filtered in the query. Chunking is per source type: rulebooks split on numbered clauses and keep tables whole; prose splits on headings with overlap. Chunk quality is verified against a fixed set of questions with known answer sources (`src/lib/knowledge-known-answers.ts`, run from the admin panel), not by eyeballing.
3. **Ingestion runs in the Worker.** No session holds a service-role key (§4.1 rule 10), so ingestion is not a local script. A source is registered from the internal admin panel (web-only, §3), the PDF is read from the `resource-pdfs` bucket, chunked, embedded through the same Lovable AI Gateway the app already uses (`KNOWLEDGE_EMBEDDING_MODEL`, default `openai/text-embedding-3-small` at 1536 dimensions, the width pgvector's HNSW index supports without truncation), and advanced one stage per tick (40 pages extracted or 32 chunks embedded, checkpointed in `knowledge_pages` and `knowledge_chunks`), so a 300-page rulebook never runs inside one request. The admin page drives a source to completion when it is registered or "Run ingestion now" is pressed; a pg_cron sweep every six hours finishes anything left half-done (Mariah, 2026-09-21: per-minute was needless load; the voice-transcript sweep moved to hourly for the same reason). A coach upload enqueues its own ingestion on insert. Re-ingesting a changed source replaces its chunks by content hash.
4. **Retrieval and the prompt.** `askGradus` embeds the question, retrieves the top passages filtered by the asker's sport plus the sport-agnostic sources plus the asker's coach scope, and passes them to the model wrapped as untrusted content (the existing `ai-prompt-safety` helpers), with the instruction to answer only from the passages, to cite each one it uses, and to answer "not covered" when they do not cover the question. The audience personas and the minor-athlete safety rules stay exactly as they are.
5. **Fallback (decision #16).** On "not covered", a second call answers from general knowledge under the same persona, and the answer opens with one plain sentence that it is not drawn from Gradus sources. The response carries `grounded: false`. **Safety topics never fall back:** a question the classifier or the retrieved passages mark as abuse, grooming, self-harm, disordered eating, or injury concealment returns the Safe Sport panel content (hotlines and reporting links, §7.9) verbatim above whatever else is said, for every audience.
6. **Citations.** `POST /ask` returns `answer`, `grounded`, and `sources[]` (source title, section, page, and the resource id when the document is in the library so the client can open it). Saved answers keep their sources. The web server function keeps its current return shape; showing citations on the web is a later web change outside this PRD.
7. **Provider coupling.** Embeddings are tied to the embedding model: if §12 #4 ever flips the gateway to a direct provider key, the corpus is re-embedded in the same job, and a `knowledge_sources.embedding_model` column records which model produced each source's vectors so mixed states are detectable.

### 6.8 Payments and entitlements

**Decision.** No In-App Purchase, no StoreKit. Coach and Team subscriptions are purchased and managed on the web through Stripe. This is compliant provided the app follows the rules below, and it is the same posture the Capacitor submission plan already took.

**The rules the app follows.**

1. **Entitlement is displayed, never sold.** Settings → Plan shows the current tier, renewal or trial date, Founding Coach status, and roster capacity. There is no price list and no "Subscribe" button in the app outside the case in rule 3.
2. **Feature limits are stated plainly; a purchase link is allowed only under rule 3.** The roster cap message is the fixed sentence "Your roster is full on your current plan." Where the cap blocks an action, a link labelled "Upgrade to Coach Pro" may accompany it on the **United States storefront only**; it opens the web paywall (`CoachBilling.manageUrl`) in Safari per rule 3, never an in-app web view. Non-US storefronts keep the sentence with no link and no plan name. The first use is the schedule-import flow: the link sits next to the roster-cap row and in the review screen's seat summary, and on the import's Done screen (decision #58, gradus-ios #176 and #177). No other screen carries the label until a decision adds it. Founding Coach and Club tiers are unaffected.
3. **Link-out only where permitted.** On the **United States storefront**, Apple's guidelines (updated May 2025 after Epic v. Apple) allow buttons and links to external purchase with no entitlement. The app checks `Storefront.current` and, for US users only, shows "Manage your plan at gradus.training" that opens Safari. For any other storefront the app shows plan status with no link and no instructions. Gradus is US-focused, so at launch the App Store availability can be US-only, which keeps this simple.
4. **Stripe never appears inside the app.** Checkout and the billing portal open in Safari via `UIApplication.open`, never in an in-app web view (both Stripe and Apple prohibit card entry in embedded web views). The web's `/coach/paywall` and parent Team pages already exist for this; after purchase the user returns to the app and the entitlement refreshes from `/me` (plus the silent push from the Stripe webhook).
5. **Coach invoicing is allowed in-app.** Coaches invoicing parents for lessons is a real-world service consumed outside the app (Guideline 3.1.3(e)); creating, sharing, and marking invoices paid is fine. Invoices are records; no money moves through the app.
6. **New coaches after the Founding window (2026-11-01).** With the paywall flag on, a brand-new coach who signs up in the app finishes onboarding and then sees the plan-status screen. In the US they get the link; elsewhere they get "Finish setting up your plan on the web" without a link. Sign-up itself is never blocked, which satisfies minimum-functionality expectations.

**App Review notes (prepared in Appendix D).** State plainly: subscriptions are multiplatform and purchased on the web; the app unlocks previously purchased access; US storefront linking follows 3.1.1(a); there is no purchase flow in the app; demo coach and parent accounts are provided.

### 6.9 Live Board

**What it is today.** A public web page per competition (`/board/<slug>`) built from a shared `competition_snapshots` row that the Worker refreshes from the USFS IJS results site at most every 30 seconds (one refresh serves every viewer; pg_cron keeps live boards warm). Three tabs: **Live** (each rink: just scored, on the ice, up next), **Schedule** (a departures board of the day's events), **Following** (skaters the viewer follows, matched by normalized name). Signed-in coaches and parents get their rostered skaters auto-suggested. Viewing a board records attendance, which later drives competition recap prompts.

**Product truth to preserve.** IJS never publishes who is currently skating. "On the ice" is inferred as the next start number after the last posted score, and scores post one to two minutes late. The three lanes exist so the inference sits next to the facts; the app must not present "on the ice" as authoritative, and must show the data age.

**Native requirements.**

| Area | Requirement |
|---|---|
| Entry | App tab "Live" visible to everyone, signed in or not. Board index lists live-window competitions and recently visited boards (local history, 20 items). Universal link `gradus.training/board/<slug>` and the rink QR codes open straight to the board. |
| Board screen | Same three tabs with a segmented control. Rink panel per sheet with the three lanes, protocol (score sheet) on tap, event results ranked by final placement, schedule grouped by day with status chips, follow search. Pull to refresh; automatic 30 s refresh while visible with `ETag`; "Updated 12s ago" indicator; visible stale state after 3 min. |
| Following | Follows stored locally and, for signed-in users, in `board_follows` (new, additive) so push and Live Activities can target them. Auto-follow suggestions from `getMySkaterNames` for coaches and parents. |
| Live Activity | When a followed skater's event is live: Lock Screen and Dynamic Island show the skater, start position, and lane state (up next → on ice → just scored with score). Started by push-to-start from the server when the event goes live; updated on each snapshot change that affects that skater; ended when the event is final. Compact island shows "#4 of 12". Frequent-updates entitlement requested. Falls back to app-driven activity updates while the app is foregrounded. |
| Widget | *Removed 2026-10-17 (#55):* no Live Board Home Screen widget; the Live Activity covers a followed skater. (It was: small and medium widgets, "Next up for my skaters" with time and rink, and the last posted score.) |
| Attendance | Viewing a board while signed in calls `POST /competitions/{id}/attendance`, preserving the recap-prompt flow. |
| Accessibility | The skater wheel respects Reduce Motion (no spin), lanes have VoiceOver labels including data age, colors come from the accessibility-audited tokens. |
| Time | All times in the rink's timezone (`RINK_TZ` from the scraper), not the device's. |

The scraper, snapshot cache, and refresh lock stay server-side unchanged.

### 6.10 Deep links and universal links

The app claims `applinks:gradus.training`. The `apple-app-site-association` file is served from `public/.well-known/` (already verified to survive the production build) once the Team ID exists. Paths the app owns, and how it handles them:

| Path | Handling | Priority |
|---|---|---|
| `/board`, `/board/*` | Live Board index and board | P0 |
| `/i/:code` | Invite entry: resolves code kind (coach, parent, adult athlete) and routes into the matching sign-up or link flow | P0 |
| `/login`, `/signup/*` | Native auth screens | P0 |
| `/coach/*`, `/parent/*`, `/athlete/*` | Mapped to the equivalent native screen (Appendix C); unknown subpaths open the role home | P0 |
| `/g/:token` | Guardian claim flow | P1 |
| `/verified` | Return from KWS parent verification; resumes the claim or onboarding step that started it (§6.13) | P0 |
| `/team/:token` | Guardian team invite | P1 |
| `/p/:token` | Shared plan preview and import | P1 |
| `/reset-password` | Native reset (requires the recovery token to reach the app; until then this path is excluded so Safari opens the web page) | P1 |
| `/privacy`, `/terms`, `/unsubscribe`, `/admin/*`, `/org-admin/*`, `/api/*`, `/email/*`, `/lovable/*` | **Excluded** from the app's paths; always open in Safari | — |

Custom scheme `gradus://` is registered as a fallback for QR codes and internal use only. Emails keep linking to `https://gradus.training/...` so that non-app users are unaffected.

### 6.11 Security and privacy

- **Transport.** ATS defaults (HTTPS, TLS 1.2+, forward secrecy). **No certificate pinning** (see §4.2). Add a CAA record for gradus.training at the DNS level as the actual mitigation.
- **Secrets.** The app ships only the Supabase publishable key and the Google iOS client ID. Everything else is server-side.
- **Storage at rest.** Keychain for tokens; the SwiftData store uses `NSFileProtectionCompleteUntilFirstUserAuthentication`. Cached PDFs and voice notes are in the app's Caches directory and purgeable. Sign-out wipes the store.
- **Minors.** Athlete accounts are created by parents and log in by username, and that path never asks a minor for an email; the 13–17 self-sign-up path takes the teen's email plus a parent email and stays provisional until a verified guardian claims (§6.13). Messaging keeps the athlete persona rules server-side; minors send text only (decision #32). No ads SDKs and no tracking. Usage analytics are first-party (§6.12, decision #19), and a minor athlete's events are stored without their user id. The App Privacy label lists first-party collection (contact info, user content, identifiers for push, diagnostics, and product interaction once A2 ships); the answers live in `docs/ios/app-store-submission.md`. Consent, adult verification of parents, Apple's age signals and the SafeSport messaging rules are §6.13.
- **User-generated content (Guideline 1.2).** Report and block are one tap away in every room and on every profile the user can see, using the existing `submitReport` / `blockUser` logic. Blocked users' messages are hidden client-side immediately and server-side thereafter.
- **Account deletion (5.1.1(v)).** In-app, two taps from Settings, with the existing impact preview and confirmation phrase for accounts with minor athletes. Includes Apple token revocation.
- **Error reporting.** `POST /errors` mirrors `reportClientError` so iOS errors land in the existing admin errors dashboard. MetricKit crash and hang diagnostics are uploaded on next launch through the same endpoint. No third-party crash SDK in v1.
- **Screenshots and logging.** No PII in logs. Debug logging is compiled out of release builds.
- **Impersonation.** Admin impersonation is web-only; the API rejects impersonation tokens on `/api/v1`.

### 6.12 Usage analytics (added 2026-09-22)

Decision #19. The question to answer: **where do coaches, parents and athletes spend their time, and which resources do they actually read?**

**What is measured**
- **Screen time.** Foreground time per screen, grouped into areas that match the tabs and major flows: `roster`, `schedule`, `plans`, `sessions`, `messages`, `board`, `resources`, `ask`, `settings`, `onboarding`. The clock runs only while the screen is visible and the app is active. Backgrounding, locking the phone, or presenting a sheet over the screen stops it. A single stretch longer than 30 minutes is capped at 30 and marked `capped`, so an app left open on the counter does not inflate the numbers.
- **Resources, in detail.** Opened (resource id, kind, sport, library vs coach upload); read time per open; read depth (furthest PDF page reached ÷ page count); shared; downloaded for offline; library searches (a count and the result count, **never the query text**); Safe Sport panel opened; Ask Gradus question asked, answer saved, source row tapped (after L5).
- **Envelope on every event:** random event id, per-launch session id, timestamp, platform, app version and build, OS version. The server adds role and age band itself; neither is trusted from the client.
- **Never collected:** message, note, plan or question text; search terms; names; contacts; location; the advertising identifier; anything from another app.

**Transport (iOS).** `AnalyticsTracker` in `GradusCore` buffers events on disk in the per-user cache (cap 1,000 events, drop anything older than 7 days) and sends batches of up to 100 to `POST /api/v1/analytics/events`, when the app backgrounds, every 60 s in the foreground, and at launch. Analytics never use the write outbox, never retry in a loop, and never show an error. Screens opt in with a `.trackedScreen(area:screen:)` modifier on each tab root and routed screen; the Resources viewer reports read depth itself.

**Server (web repo).** Additive migration `analytics_events` (id, occurred_at, received_at, user_id nullable, subject `adult` or `minor_athlete`, role, age band, session_id, platform, app_version, event, area, screen, resource_id nullable, duration_ms, org_ids uuid[] and regions text[] (minor athletes only, empty otherwise), props jsonb allow-listed per event). RLS on with no client policies; the route inserts with the admin client after authenticating the caller. Event ids are unique, so a retried batch is a no-op. The route is authenticated, rate-limited, and capped at 64 KB and 100 events. **Minor athletes:** an athlete account counts as a minor unless it is a **confirmed adult** (a birthdate on file that parses and is 18 or more years ago). A missing or unreadable birthdate is treated as a minor, the same conservative rule as the Ask Gradus age gate in `src/lib/athlete-age.ts`; do not reuse `isMinorBirthdate`, which treats a missing birthdate as an adult. For a minor, the server writes `user_id = null`, `subject = minor_athlete`, the age band, and the athlete's **club and region**: `org_ids` (every organization the athlete's coaches belong to, empty for solo coaches) and `regions` (those organizations' `region` values). A club or region goes into the row only if it has **at least 10 minor athletes at write time**; otherwise it is left out, so a raw row can never point at a club or region small enough to identify a child. It never writes a coach id, parent id, or athlete id. A minor's usage can be counted by age band, club, and region, but never tied back to the child or to one coach (Privacy Policy §5.3; COPPA's support-for-internal-operations exception). Club and region come from the database at write time, never from the client. A pg_cron job deletes raw events after the retention in §12 #21 and keeps weekly aggregates.

**Reporting.** A **Usage** page in the internal admin panel (web-only, decision #2): time per area per role per week; a Resources table with opens, unique users, total and median read time, median read depth, shares and offline saves per resource, filterable by sport and by library vs coach upload; Ask Gradus volume. Small groups (fewer than 5 users) show as "<5" so no individual can be picked out. **Minor athletes by club and region:** the report can break minors' events, including Safe Sport panel and Safe Sport resource opens, down by club and by region, compared with the all-club baseline (for example, "Safe Sport opens per minor athlete at this club vs. the median club"). A club or region appears only when it has **at least 10 minor athletes** on Gradus, counted from the roster at report time, because minors' events carry no user id to count (and only clubs and regions that passed the same test at write time are stored at all). The threshold applies to **every cell shown**: a club split by age band or by week shows a cell only when that cell's roster count is at least 10, and other cells merge upward. Smaller ones roll into "Other clubs" or "Other regions", and the report never shows a region total next to its named clubs in a way that lets a small club be found by subtraction: if a region's residual ("Other clubs" within it) would describe fewer than 10 minor athletes, the region total is suppressed too. Minors with only solo coaches appear as "No club". **There is no per-coach breakdown for minors**; §12 #22 covers that.

**Consent and withdrawal (decision #46, 2026-10-04; replaces the Settings toggle).** No in-app switch. Consent is part of accepting the Terms of Service and Privacy Policy at sign-up, and the policy (§2.4, §8) says to email support@gradussports.com to withdraw it. Gradus honors a request by hand: the admin user page's **Usage data** card records it in `analytics_opt_outs` (service role only) and deletes every `analytics_events` row carrying the account's user id. `POST /api/v1/analytics/events` checks the table first and answers `accepted: 0` for a withdrawn account without storing or deriving anything, so the app needs no change and never sees an error; its buffer still clears on a 2xx. Recording is one transaction (`analytics_withdraw_consent`: request row, then the delete, returning the count the card shows); both admin actions sit behind a confirmation. Resuming (if the person asks) deletes the `analytics_opt_outs` row. A minor athlete's events carry no user id, so for them a withdrawal stops future collection only. Account deletion clears `user_id` on the account's events (FK `ON DELETE SET NULL`, same migration), so a deleted adult's events survive only as de-identified counts. The iOS tracker keeps its `isEnabled` hook (always true in the app) for tests and for a future server-driven flag; `clear()` runs at sign-out.

**The web.** Does not send usage events (§12 #20, resolved no); the web app is unchanged (§4.1). The endpoint and table stay client-agnostic.

**Apple and the policy.** First-party analytics is not tracking under App Tracking Transparency, so there is no ATT prompt. A2 adds `NSPrivacyCollectedDataTypeProductInteraction` with purpose `Analytics` to the privacy manifest, and App Privacy gains *Usage Data → Product Interaction → Analytics*, both before the collecting build ships. The published policy's §2.4 already covers features accessed, session duration and usage patterns; counsel confirms the minor de-identification and retention wording against §5.3 and §8.

### 6.13 Consent, adult verification, age signals, and SafeSport (added 2026-09-24)

Decisions #29–#33. **Why.** The live privacy policy already promises verifiable parental consent and parent-created athlete profiles, and the product did not back either: a minor of any age could self-sign-up on web and iOS with any typed "parent" email, the account was live at once, nothing was gated on the guardian claim, and coach messages were mirrored to that unverified inbox. The amended COPPA Rule (compliance deadline 2026-04-22) counts a stored child's voice recording as personal information and requires a written retention policy and a written security program. The Texas App Store Accountability Act is in force on the US storefront (#25) and California's Digital Age Assurance Act follows on 2027-01-01; both require the app to read Apple's age signal. SafeSport's MAAPP electronic-communications policy requires a parent or another adult on every adult–minor communication and requires honoring a parent's request to stop contact.

**What stays (guardrails).** No coach↔minor room can exist without the athlete's guardians as participants: athlete rooms are three-way by construction and the only direct rooms are coach↔coach and coach↔parent. Report and block stay one tap away and a `minor_safety` report still emails admins immediately. Minors never reach Ask Gradus (#22). No ads and no third-party SDKs.

**A. Consent backbone (server; both clients inherit it).**

1. **One adult verification per parent account (#29).** A parent account that links a minor is verified as an adult once, through KWS Parent Verification, with every method KWS offers in the US (#38: card or the SSN check). `parent_profiles` gains `adult_verified_at`, `adult_verification_method` (`kws`, `admin` or `legacy`) and `adult_verification_ref` (the KWS transaction id). Triggered at the first minor link or claim: after account creation in parent onboarding (onboarding itself stays before the account, #27) and inside the guardian claim flow. Never at coach or adult-athlete sign-up. Parent profiles that exist when the S1 migration runs are marked `legacy` and are never prompted or gated (§12 #27, Mariah 2026-09-24); verification applies to parent accounts created afterwards. *2026-09-25 (#34):* while the switch is off, parent Settings shows the step as an opt-in whenever KWS is configured (`available`); legacy parents carry a verified state and never see it.
2. **KWS flow.** Server-side only. Client-credentials token, then `send-email` with the parent's **own account email** (never the address a child typed), `location` `US`, `language` `en`, `userContext` `parent`, and `externalPayload` carrying the parent profile id and a nonce. KWS emails the parent, hosts the white-labeled adult check (card or SSN in the US, #38), posts the signed `parent-verified` webhook, and redirects the parent to `https://gradus.training/verified` with a signed query (KWS's "Verification Response": `status`, `externalPayload`, `signature`, HMAC over `status:externalPayload` with the verification secret). The page and the app forward that query to `POST /guardian/verification/complete`, so either channel alone completes the verification. Webhook handling: HMAC-SHA256 over `timestamp.rawBody` against `x-kws-signature` (accept either signature during a secret rotation), idempotent on transaction id, a `webhook_receipts` row, and a 2xx only after the parent row is updated. Secrets live in Lovable Cloud (`KWS_CLIENT_ID`, `KWS_API_KEY`, `KWS_WEBHOOK_SECRET`, `KWS_VERIFICATION_SECRET`), test and production sets. The KWS test environment carries preview and CI; production waits on KWS's go-live review. Demo and review accounts (#26) are seeded verified with method `admin`, because App Review cannot pass a card check.
3. **Consent ledger.** `guardian_consents` (athlete, parent, scope, granted at, revoked at, method, evidence). Scopes in 1.0: `account` and `messaging`. Granted when a verified parent creates or claims the athlete; revoked on unlink, athlete removal, account deletion, or `RESCIND_CONSENT` (B4). No `voice` scope, because minors send text only (#32); *2026-10-03 (#37):* voice input to the athlete's own plan needs no scope either, because no minor audio is ever stored (A7). No separate third-party-disclosure scope; §12 #24 carries the counsel check.
4. **Athlete account states** (`athletes.account_state`: `active`, `provisional`, `paused`). Age comes from the birthdate on file; no birthdate means minor (the D8 posture).
   - **Under 13 (#30).** No self-created account. The athlete entry screen asks for the birthdate first; under 13 it shows only "Ask your parent to set up Gradus" with the existing share message, stores nothing server-side, and remembers the outcome for the session so a second birthdate does not reopen the flow. `createSelfManagedAthlete` refuses under-13 input (`parent_required`, 422). The child joins through the parent's invite code after the parent is verified.
   - **13–17 (#31).** Self-sign-up creates a `provisional` account with a parent email on file: own goals and plans visible; no coach connection, no rooms, no coach-side claim, until a verified guardian claims. Provisional accounts nobody claims are deleted after 3 months (§12 #25), and the direct notice says so.
   - **Parent-created minors.** `active` once the parent is verified. Before that the athlete's invite code (their login) is not issued, coaches cannot be linked, and rooms do not open.
   - **18+.** Unchanged.
5. **Coaches invite the parent, never the athlete, for anyone under 18 (#30).** `addAthleteWithGuardian` accepts `inviteRecipient: "athlete"` only when a birthdate is on file and the athlete is 18+; the roster shows "waiting for parent" until the parent verifies and claims; `claimAthleteSelf` keeps refusing under-18.
6. **The room rule (#31).** A room that includes a minor athlete opens, and accepts sends, only when a verified adult who is not the coach is a participant. `mirrorGuardianActivity` (the email copy to an unclaimed guardian) is retired: it sent coach messages to an unverified address. *2026-10-19 (#56):* the parent-linked half of the rule is always on, whatever `PARENT_VERIFICATION_REQUIRED` says: a coach can share plans with a minor whose parent hasn't joined, but never open or send in their room; the parent on file still gets the existing guardian-activity email when a plan goes live (`setPlanStatus` → `mirrorGuardianActivity`; only the per-message copy was retired, never the plan-activation copy), the new-conversation picker and the roster's `canMessage` leave such athletes out, and an already-open room shows `messagingClosedMessage` in place of its composer.
7. **Text only for minors (#32, #48).** `sendMessage` refuses a voice send from a minor athlete's session and the voice-note upload policy refuses their uploads; the composer hides the microphone for minors and says why in the VoiceOver label. Plans too (#48, 2026-10-07, withdrawing the #37 exception): `POST /athlete/voice/build-plan` and `POST /voice/transcribe` answer 403 `text_only` for a login with any athlete row under 18 or without a birthdate (`assertVoiceAllowed`, `src/lib/minor-voice.server.ts`), before the clip is read into any request. The coach voice route (`buildPlanFromVoice`) and `sendMessage`'s voice branch run the same check for any login and role, since a minor's login can also hold a coach profile; `transcribeVoiceNote` skips any note whose sender is under 18 and stamps it `NEVER_TRANSCRIBE`. `GET /me` `athleteVoiceToPlan` tells the apps, which hide the voice controls unless it is `true`. No audio from an athlete under 18 reaches Gradus's transcription processor; voice notes a minor sent before 2026-09-24, if any remain in the `voice-notes` bucket, are never transcribed and are owed a one-off purge.
8. **Direct notice.** The parent invite email carries the COPPA direct notice and, from 2026-10-03 (#40), so does the app wherever a parent enters a minor's details; the KWS email is KWS's own template and cannot. Content: it leads with the promise that Gradus never collects photos or video of the athlete (no profile pictures, no photos or video in messages; policy §2.3), then what is collected (name, birthdate, username, messages, goals, practice logs), how it is used, the categories of processors (the policy carries the full list), the retention rule itself (kept for the life of the account; an under-18 account unused for three years is deleted after notice, #41), that a self-signed-up provisional account and the parent contact details it holds are deleted after the §12 #25 window (that line is sent only when no coach added the athlete, since only provisional accounts are swept), and how to review or delete. The policy link opens a new tab so the form a parent is consenting on survives. One text source: `src/lib/consent/direct-notice.ts` and `GradusCore/DirectNotice.swift`.
9. **Retention.** A scheduled job deletes expired provisional accounts and their guardian emails; the public retention policy (§12 #24) states the windows. *2026-10-03:* the same daily hook also deletes dormant under-18 accounts after a 30-day notice (#41) and audit records past five years (#43); the published text is `docs/legal/retention-policy.md` §A and the enforcement map is its §B.

**B. Apple signals (iOS; #33).**

1. **Declared Age Range** (`DeclaredAgeRange`, iOS 26+, entitlement `com.apple.developer.declared-age-range`), requested at the sign-up entry and on launch with gates 13, 16 and 18. It satisfies Texas now and California later, and it is a **tighten-only** cross-check: a device band under 18 blocks coach, parent and adult-athlete sign-up on that device and routes to the minor flow; a band under 13 routes straight to the parent-only screen. A self-declared 18+ never loosens anything. `declinedSharing`, and `notAvailable` on iOS 18–25, fall back to the birthdate path and never block, because App Review rejects apps that do. *Built 2026-10-03 (S3):* asked on launch only where `isEligibleForAgeFeatures` says the law requires it, otherwise once per launch at the first sign-up entry; the band stays on the device and is never sent to the server (so the privacy manifest is unchanged). Every coach, parent and adult-athlete entry passes one check: the sign-up chooser and the role chooser hide Coach and Parent, coach/parent/invite deep links land on "Coach and parent accounts are for adults", a guardian-claim or team-invite link opened by a profile-less account is refused the same way, and an 18+ birthdate typed on a band under 18 is refused with the reason. Accounts that already have a profile are not re-gated by the band (§12 #28).
2. **PermissionKit.** `SignificantAppUpdateTopic` when the age rating or a gated feature changes (required in Texas). The `CommunicationTopic` ask-a-parent flow for coach connections on Child Accounts with Communication Limits is additive and post-1.0 (§12 #26). The ledger, not Apple, is the record.
3. **StoreKit age-rating watcher** triggers the significant-change ask when the app's rating changes on the device. *Built 2026-10-03 (S3):* significant changes come from a registry in the app (empty in 1.0: a fresh install never acknowledges what it installed) and from `AppStore.ageRatingCode` differing from the code the device last accepted. `requiredRegulatoryFeatures` (iOS 26.4+), or eligibility plus the band on 26.2–26.3, decides: a minor gets a blocking "Ask a parent to approve this update" screen with PermissionKit's button and the app waits for the approval; an adult gets Apple's acknowledgment sheet; anyone else has nothing to do. Handled changes are remembered per device. The PermissionKit listener registers only while an ask is pending, because registering on a device with no Apple Account signed in makes the system ask to sign in.
4. **`RESCIND_CONSENT`** from App Store Server Notifications V2 reaches `POST /webhooks/app-store` (signed JWS, idempotent), sets the athlete `paused`, revokes the ledger scopes, and notifies the parent and every linked coach. *Built 2026-10-03 (S3):* the route is `POST /api/public/webhooks/app-store`, outside the `/api/v1` kill switch like the KWS webhook. The JWS is verified against the pinned Apple Root CA - G3 with Apple's marker OIDs on the intermediate and the leaf. The notification names no Gradus account, only the `appTransactionId` of the child's download (`appData.signedAppTransactionInfo`), so athlete sessions on TestFlight and App Store builds send their signed `AppTransaction` to `POST /me/app-transaction`, which stores the binding in `app_store_app_transactions` (many-to-many, sandbox and production apart; coaches and parents are never bound). That id is an account-level identifier the privacy manifest already declares (User ID, Purchase History; linked, app functionality), so S3 adds no data type. A download rescinded before anyone bound to it is remembered in `app_store_rescinded_transactions` and pauses whoever binds to it later; claims and invite resends refuse a paused athlete. Apple sends no "consent restored" event, so un-pausing is an admin action (§12 #29).
5. **Age-rating answers (#24).** "Age assurance" becomes **Yes** once S1 and S3 ship (parent adult verification; Declared Age Range on device); messaging stays declared as restricted to connected users. Under-13 Child Accounts install through Ask to Buy, which now covers free downloads.

**C. SafeSport in the product.**

- The no-private-channel rule above is a guardrail: never add coach↔athlete direct rooms.
- **Parent pause.** A parent can pause a coach's messaging with their athlete (`coach_athletes.messaging_paused_at`); sends are refused server-side in both directions while paused and the coach sees why. This honors the MAAPP rule that a parent's request to discontinue contact is honored.
- **Reports.** A published contact address and a response commitment in the listing and in the Safe Sport panel (Guideline 1.2); `minor_safety` reports keep their urgent admin email.
- **Not adopted.** A coach SafeSport-training attestation at onboarding (Mariah, 2026-09-24).

**D. Paper (Mariah with counsel; §12 #24).** Privacy policy reconciled with what is actually collected (username, messages, goals, practice logs; no audio collected from athletes under 18 (#48 withdrew the #37 plan-building exception)), KWS named as a processor, the direct-notice copy, the public retention policy, and the written information-security program the amended rule requires. *2026-10-03:* decisions #39–#45; the retention policy and the security program are drafted in `docs/legal/`; the brief carries a revision section; counsel's remaining job is the policy wording itself.

**What the web gets for free.** A and C live in the shared server functions, so the web has the same states, the same room rule and the same verification step the moment S1 publishes; only B is iOS-only. Kotlin later uses Google's Play Age Signals API in B's place.

---

### 6.14 Athlete-authored plans (added 2026-10-03)

Decision #35. **Why.** The product has always treated the plan as a coach artifact: `plans.coach_id` and `moves.coach_id` own every row, every write route refuses non-coaches up front (`requirePlansCoach`) and then filters by the coach id, the voice builder resolves athlete names from the coach's roster, the library seeds per coach, and the share-import RPC refuses non-coaches. Athletes who train without a coach, or between coaches, had only Gradus starter programs and whatever a coach assigned. Mariah wants athletes to plan their own practice with the same tools, and to pass plans to friends.

**What already fits.** Starter programs insert plans with no coach (`coach_id NULL`, `athlete_id`, `source = 'gradus'`), so the schema trigger already admits non-coach-owned plans. The share-token helper already authorizes the plan's own athlete, the runner's plan detail already has the Share button, and the app already routes `/p/:token`. The iOS plan editor renders one role-aware DTO and gates every edit on `isOwner`.

**A. Ownership.** A self-authored plan is `kind = 'plan'`, `source = 'athlete'`, `coach_id NULL`, `athlete_id` = the author. Three schema guards admit it (AP1, `20261006010000_athlete_authored_plans.sql`): `plans_source_check` gains the value, the ownership trigger admits `source = 'athlete'` alongside `'gradus'`, and the old `plans_coachless_must_be_gradus` CHECK (which the first draft of this section missed) becomes `plans_coachless_must_be_gradus_or_athlete`. A new CHECK, `plans_athlete_source_shape`, pins the row: always `kind = 'plan'`, always an `athlete_id`, never a coach or an organization, so a direct write cannot relabel a coach's plan or forge coach ownership. RLS: athletes insert, update and delete `plans` and `plan_moves` rows where the plan is theirs and `source = 'athlete'` (helpers `is_own_athlete` and `is_own_authored_plan`); a **paused** athlete (§6.13, Apple withdrew consent) keeps read access but writes nothing new, and the pause is judged per user rather than per `athletes` row (an existing policy lets a signed-in user open a second athletes row, which must not escape it). The existing athlete SELECT policies only show active and benched plans, so a new policy lets the author read their own plans in every status (a voice-built draft is still a draft), and `can_view_plan`, the `plan_moves` read gate, gains the same two reads. Coaches rostered to the athlete read them while they are active or benched (a draft stays private) through a new policy shaped like the one for Gradus starter plans, and through the existing role-aware detail (read-only, `isOwner: false`); a coach never writes them, and a coach cannot mint a public share link for one (AP2 enforces it in `getOrCreateShareToken`); they appear on the athlete's detail screen in the roster with a "By *first name*" caption. There is no cap on an athlete's own active plans (§12 #33), and since #52 none on a coach's either.

**B. Routes: parallel, never generalized.** New module `athlete-authoring.server.ts` and routes `POST /athlete/plans`, `PATCH` / `DELETE /athlete/plans/{id}`, `POST /athlete/plans/{id}/status`, `POST /athlete/plans/{id}/moves/from-library`, `PATCH` / `DELETE /athlete/plans/{id}/moves/{moveId}`, `PUT /athlete/plans/{id}/moves/order`, `GET /athlete/moves` (read-only seeded curriculum for the athlete's sports), `POST /athlete/voice/build-plan` (create and edit modes; no athlete slot; move-name hints from the seed curriculum). They reuse the plans schemas and DTOs. The coach modules (`plans.server.ts`, `moves.server.ts`, `voice.server.ts`) are **not** touched: the 32 coach-keyed filters stay as they are, which is the §4.1 no-disruption posture. `GET /plans/{id}` serves the author their own plan in any status (a voice-built draft included) with `isOwner: true`, `coach: null`, `source: "athlete"` and their own transcript; its moves are plain rows (`moveId` and `libraryMove` are always null, since an athlete has no personal library). `GET /athlete/plans` marks self-authored rows (`source`) so the client never captions them "from Gradus" (their `coachName` is the athlete's own first name) and lists the author's unfinished plans in a separate `drafts` array, so the closed `status` enum never gains a value. A parent sees the same plan as "By *first name*" (`coach: null`); the coach's roster detail lists it read-only with `source` and `authorFirstName`. A coach can read it but cannot mint a public share link for it: `getOrCreateShareToken` refuses everyone except the athlete and their parent for a plan the athlete wrote. Every new response field is optional on the wire and `source` is a plain string, never an enum. The parent and coach-roster loaders include the plans an athlete wrote only when the `/api/v1` route asks (`includeAuthored: true`); the web functions that share those modules never do. The athlete's own loader returns their active and benched plans everywhere, the web included, and there `includeAuthored` gates only the `drafts` array (#49, 2026-10-10; until then the PWA showed nothing new, §4.1). Minting a share link for such a plan is refused for a paused athlete (their pause is judged per user), and a user who is both a parent and an athlete still gets their own plan back from `GET /plans/{id}`. The athlete voice route transcribes with `quiet: true` (length only in the logs, never the words, and no raw SDK error objects) and writes no audio anywhere; `voice.server.ts` gained only additive options for this (`quiet`, `speaker`), so the coach behavior is byte-for-byte unchanged.

**C. Library.** Read-only. `GET /athlete/moves` serves `seed_moves` filtered to the sports on the athlete's goals; "Add moves from the library" works exactly as for coaches; there is no personal library, no save-to-library, no archive, no move sheet for athletes.

**D. Sharing and adoption.** Unchanged share token and public page. The public snapshot RPC gains two keys, `authorKind` (`coach` or `athlete`) and `authorFirstName`, so the page reads "Plan by *first name*" when the author is an athlete ("Plan by Coach *Name*" as today otherwise); `coachFirstName` and `coachLastName` keep their meaning, and an athlete's link carries a first name and nothing else about them. A link whose author athlete is **paused** (§6.13) stops resolving, as if unshared, and cannot be imported. `import_shared_plan` gains an athlete branch (a caller with no coach profile but an active athlete profile): a copy snapshot (same as the coach import) created as `kind = 'plan'`, `source = 'athlete'`, `athlete_id` = the importer, **status active**, with the title suffixed "(from *author*)"; its moves copy as plain rows with no `move_id`, since athletes have no personal library (the athlete `plan_moves` policies refuse a `move_id`, and a coach import follows a `move_id` only into the source plan's own coach's library). Coaches keep importing as a benched template, and a coach who is also an athlete imports as a coach. A caller who is neither is refused. Under-18 authors may share (#35); counsel confirms the first-name line with the privacy policy (§12 #32).

**E. iOS.** The athlete's Plans tab gains a "+" and the voice button, a "Mine" caption and filter, and a read-only Library segment. Opening a plan the athlete owns pushes the editor (`PlanDetailView` in an *authoring* mode that hides assignment, templates, the bench-reason prompt and the coach-voiced copy); any other plan opens the runner view. `SharedPlanView` offers "Add to my plans" to athletes. Offline edits go through the existing outbox with the new paths on its allow-list. The mock repository gets the athlete mode so the simulator walkthroughs and tests cover it.

**What the web gets.** The routes are additive. Since #49 (2026-10-10), an athlete's web Plans list and plan page also show the active and benched plans they wrote or adopted, read-only; drafts, authoring and everything parents and coaches see on the web are unchanged. The web sunsets (§10.4), so no web authoring UI is built for this.

### 6.15 Apple Watch, headphones-first (added 2026-10-03)

Decisions #36 and #37; supersedes the "no Apple Watch" line of #7. **Why.** Coaches are rinkside with their hands busy; athletes and parents run plans on the ice or in the gym. Mariah wants the watch usable **without looking**: Gradus speaks, the user talks back.

**The constraint that shapes everything (verified against the watchOS 26 SDK, 2026-09-25).** watchOS has **no speech-recognition framework**. Every "voice in" on the wrist is a recorded clip sent to the server, which already transcribes through ElevenLabs. "Voice out" is Apple's on-device `AVSpeechSynthesizer`, which works offline and keeps playing through AirPods when the wrist drops (`audio` background mode). **Recording cannot run in the background**, so a clip is spoken with the screen awake; the existing 90-second cap fits. The interaction model is therefore: raise wrist, tap one large button, talk or listen. Hands-free navigation by voice inside the app is not possible on this platform and is not promised.

**Architecture (from the 2026-09-25 study; unchanged).** An **independent** watch app (`WKRunsIndependentlyOfCompanionApp`) in target `GradusWatch` (bundle `training.gradus.app.watchkitapp`, watchOS 11+), embedded in the iOS binary so it rides the same record and the same review. New package `FeatureWatch`; `GradusAPI`, `GradusCore`, `GradusDesign`, `GradusWidgetData` gain `.watchOS(.v11)` with guards around `UIApplication`, `LocalAuthentication`, MetricKit, `UIFont` and the audio-session options. The watch holds **its own session**, minted by a new `POST /auth/companion` (reuses `mintSessionForEmail`) and handed over through WatchConnectivity, because Keychain items are this-device-only and Supabase refresh tokens are single-use. No Realtime, no watch-native push tokens (the phone's notifications mirror; a tap on a mirrored message opens that conversation in the watch app, #54), no voice notes from the wrist in 1.0 (message replies are text, #54).

**Workflows.**

| Workflow | Roles | Existing pieces | New |
|---|---|---|---|
| Voice → plan | athlete, coach | the iPhone recorder (90 s), `POST /voice/build-plan` (coach), `POST /athlete/voice/build-plan` (§6.14) | watch recorder screen; spoken read-back ("New plan, six moves. First: forward crossovers, eight reps"); a watch outbox for the rink |
| Deploy a plan | athlete, coach | assign (`PATCH /plans/{id}`), activate (`POST .../status`), ~~bench-conflict handling~~ | spoken list of drafts, pick by tap, spoken confirmation; ~~the 409 conflict is spoken, not shown~~ activation always goes through (#52). Athletes activate **their own** plan only |
| Plan → audio | athlete, parent, coach | role-aware plan detail for all three | **new** `PlanNarration` in `GradusCore` (shared with iPhone): title, then every move with target, cue and why, in order (**full read**, #36); a player with next and previous; plan cache on the watch |
| Pre-lesson briefing | coach | `GET /coach/athletes/{id}/briefing` (`narrative`), the 15-minute "up next" push | spoken **on tap only** (#36); a compact `GET /coach/up-next` so the wrist never pulls the whole roster |
| Post-lesson wrap-up | coach | pending wrap-ups, voice edit on `activePlanId`, `POST /coach/wrap-ups` (`edited` / `redeployed` / `dismissed` / `did_not_happen`) | spoken prompt ("Greta's lesson just ended. What changed?"), record, spoken result, one-tap action |
| Messages (#54, added 2026-10-11) | all | rooms and threads (`GET /rooms`, `GET /rooms/{id}`, `POST /rooms/{id}/messages` with an idempotency key, `POST /rooms/{id}/read`); the `GRADUS_MESSAGE` notification category | a tap on a message notification opens the thread; the 20 latest messages; reply by dictation, Scribble, the keyboard or a quick reply, text only; voice notes point to the iPhone; no watch outbox |

**The read-aloud voice (decision #47, 2026-10-06).** Plan → audio speaks with `AVSpeechSynthesizer` and the voice `NarrationVoiceChoice` resolves: the reader's choice from Settings → Device → Read-aloud voice while it is still installed, otherwise the most natural American English voice on the device, a woman's where one is as natural (Enhanced or Premium). The ranking is platform-neutral in `GradusCore` (`NarrationVoice.swift`), so the watch reuses it in W1, but the iPhone's choice is not synced: the watch always uses its own Automatic pick. Apps cannot download voices; the picker says where in iOS Settings the free Premium and Enhanced voices are. A cloud voice is a point-release option (§12 #35).

**On the watch face (W7, #51, 2026-10-10).** A WidgetKit extension, `GradusWatchWidgets` (`training.gradus.app.watchkitapp.widgets`), offers a Gradus complication in every accessory slot and the Smart Stack. A coach's face shows the next lesson today (first name, time) and steps through the day from a snapshot the watch app writes to the App Group `group.training.gradus.app` (now on the watch App ID too) whenever a coach's home shows, the app returns to the foreground, or the system grants a background refresh (about every 30 minutes while the complication is on the active face). The extension never signs in or calls the API. A snapshot from another day, or a list the server cut off at its limit once its lessons have passed, shows the mark rather than a guess. Everyone else sees the mark. Names are `privacySensitive`. Sign-out, an account switch, a lapsed lease (checked locally before a background refresh) or a 403 clears it.

**Minors on the wrist.** No voice→plan for athletes under 18 (#48, withdrawing #37): the watch hides "Record a plan" unless `/me` says `athleteVoiceToPlan`, and the server refuses their audio anyway. Drafts, hearing a plan and activating it stay. Everything else is role-gated as on iPhone.

**Dependencies.** Athlete workflows on the watch wait on §10.10 AP1 and AP2. Plan→audio ships first because it needs no server change and gives the iPhone read-aloud for the accessibility gate. The watch is now on the **critical path** for submission (#36): W0–W6 land before I16's go/no-go, and a review rejection on the watch holds the whole app (§11 #27).

---

## 7. Feature requirements

**Priority key.** **P0** is built first and gates the internal and external TestFlight builds. **P1** is built second. **Everything tagged P0 or P1 ships together in native 2.0**, which is a full-parity release by decision (§0, #3). **P2** is later or never.

Each table lists the web behavior being ported and what is specifically required on iOS. Anything not called out is a straight port.

### 7.1 Sign-in, sign-up, and onboarding

| Feature | Web today | iOS requirement | Pri |
|---|---|---|---|
| Sign in | Email or username + password with Turnstile; Google via broker | Native form; Sign in with Apple; Google (button hidden until the iOS client ID exists, 2026-09-19); password broker (§6.4). Remember identifier. Face ID gate optional. *2026-10-02:* Apple is also offered on each sign-up form (after the terms toggle), so a new account starts in its role's onboarding; a session whose `/me` has no role and no sign-up in progress gets the in-app **role chooser** (the web's `/` picker: pick Coach, Parent or Athlete, agree to the terms, Continue), never a hand-off to the web. | P0 |
| Coach sign-up | Email + password or Google; promo code field; optional `?invite=` parent code; terms checkbox | Native equivalents; promo code applied via `/me/promo-code`; invite carried from `/i/:code`. | P0 |
| Coach onboarding | Name → sports coached → levels and hours per week per sport → invite code share; sample athlete and starter plan for new figure skating coaches; join a club by search or code | Native multi-step with progress; sport multiselect with the primary-sport cap rule; club join can be skipped and finished in Settings. | P0 |
| Parent sign-up | Email + password, beta code check, athletes (name + birthdate) → goals per athlete → practice schedule per coach; mid-flow recovery; invite coach card | Native multi-step; birthdate picker; schedule editor; resume where left off from `getParentSignupStatus`. | P0 |
| Athlete (minor) sign-up | Enter parent's 8-char code → confirm prefilled identity → choose username (availability check) + password | Native; username availability debounced via `/auth/username/check`; guardian and coach shown for confirmation. *2026-09-24:* the code is issued only after the parent is verified (§6.13 A4). | P0 |
| Adult athlete sign-up | Direct sign-up, then coach link by code, goals, schedule | Native; same server flow. | P0 *2026-09-24 (#30, #31):* the athlete entry asks for the birthdate first. Under 13: a parent-only screen with the share message, nothing stored, remembered for the session. 13–17: a provisional self-managed account with a parent email (§6.13 A4); "Waiting for your parent" state with resend. 18+: unchanged. |
| Athlete onboarding (post sign-up) | Profile → coach → goals | Native. | P0 |
| Invite entry `/i/:code` | Resolves code kind and routes | Universal link handler; manual code entry screen with the 8-char alphabet keyboard rules. | P0 |
| Forgot / reset password | Email link to web reset page | Request from app; complete on web in the P0 wave; in-app in P1. | P0 / P1 |
| Terms acceptance | Blocking when version changes | Blocking sheet; version from `/me`. | P0 |
| Connection celebration | Full-screen moment when a coach–athlete link completes | Native animation with haptic; respects Reduce Motion. | P1 |
| Guardian claim `/g/:token` and team invite `/team/:token` | Claim an athlete as guardian, merge options if a parent account exists | Native flows. | P1 *2026-09-24:* the claim includes the KWS adult-verification step for an unverified parent (§6.13 A1–A2) and completes only after the webhook lands; `/verified` resumes it. |
| Parent adult verification (new, 2026-09-24) | — | "Verify you're an adult" step after account creation in parent onboarding and inside the claim flow: `POST /guardian/verification/start` sends the KWS email; a "check your email" screen with resend; the `/verified` universal link and `GET /guardian/verification/status` resume the flow; `/me` carries `parentVerified`. Until verified: no athlete invite codes, no coach links, no rooms (§6.13 A4). | P0 |

### 7.2 Coach — roster and schedule

| Feature | Web today | iOS requirement | Pri |
|---|---|---|---|
| Roster tabs | Schedule / Athletes / Billing segments; sport filter chips | Roster tab with a segmented control; sport chips; search on Athletes. | P0 |
| Week schedule | Navigable week, lesson occurrences per athlete per day, color from practice flow states, expand row for actions | Native week strip with horizontal paging; day agenda list; occurrence card actions in a context menu and swipe. Cached offline. | P0 |
| Lesson slots | Create, edit, cancel one occurrence, reschedule occurrence, delete recurring; frequencies weekly / biweekly / twice monthly / monthly | Native sheet with date and time pickers; recurrence expansion done client-side with the same rules as `lesson-recurrence.ts` (ported to Swift with shared test vectors). Queued offline. | P0 |
| Athlete detail sheet | Parent, goals, practice and lesson minutes, active plans, trends, AI summary with refresh, also-coached-by list, practice target, competition results section, billing section | Native detail screen; AI summary shows cached copy with "as of" and a refresh action. Competition results and billing sections follow their own priorities. **Mariah's call, 2026-09-20:** each goal says who set it last (parent or athlete, from `athlete_goals_history`) and, when the other person's latest version differs, shows that version too so the coach sees both. | P0 |
| Add athlete with guardian | Coach adds an athlete and invites the guardian by email; name-conflict dialog | Native. *2026-09-24 (#30), amended 2026-10-27 (#59):* the form asks **Under 18 / Over 18**, never a birthdate. Under 18 invites the **parent** (with the parent's name and email); Over 18 invites the athlete directly. The roster row shows "waiting for parent" until the parent verifies and claims; no room opens before that (§6.13 A5–A6). | P0 |
| Remove athlete | With confirmation | Native confirmation dialog. | P0 |
| Invite code | Persistent 8-char coach code, copy and share, rotate | Share sheet with link and code; rotate with confirmation. | P0 |
| Roster settings | Roster limits, default practice expectations | Native. | P0 |
| Practice targets | Set or clear a per-athlete weekly practice target | Native. | P0 |
| Pre-lesson briefing | AI narrative per athlete per date, cached by content hash, refreshable | Shown from the occurrence card; cached offline; refresh needs network. | P0 |
| Lesson wrap-ups | After a slot ends: Edit plan / Redeploy / Dismiss, once per athlete per day | Triggered by push and on foreground; native prompt card at top of Roster. | P0 |
| Coach visibility | See other coaches' plans for a shared athlete; request, respond, disconnect | Native list and actions. | P1 |
| Schedule import | Photograph or upload a lesson schedule; AI parses; review and commit; roster cap handling | Camera and Photos capture; review screen; requires network. | P1 |
| Join a club | Organization search, popular clubs, org invite code, clear link | Native; skippable at onboarding. | P0 (basic) |
| Post-event prompt | After a competition: link athletes to results, draft plans | See §7.11. | P1 |

### 7.3 Coach — plans and move library

| Feature | Web today | iOS requirement | Pri |
|---|---|---|---|
| Plans list | Filters Active / Drafts / Benched / Templates × athlete × sport; plan cards with dismiss X; swipe to delete | Native list with filter bar; swipe actions; search. Cached offline. | P0 |
| Plan detail and editor | Title, athlete, coach notes, moves from library (search), reorder, inline edit of name / description / cue / why / target reps or minutes, save to library, remove; flow-state bars; practice log; AI session summary; share to socials | Native editor with drag-to-reorder, inline sheets for move fields, library picker with search. Edits queued offline. AI summary and share need network. | P0 |
| Status | Activate / Bench / Delete; ~~max-active conflict detection~~ no cap on active plans per athlete since #52 | Native; Activate goes straight through, with no bench or replace prompt. | P0 |
| Bench or remove: "why?" *(added 2026-09-20)* | — (new; §6.7) | On Bench, and on removing a move from an athlete's plan: a native alert with *Goal reached / On hold / No longer needed* plus "…without a reason" (labels renamed 2026-09-27; wire values `landed_it` / `parking_it` / `changed_direction` unchanged). The answer rides on the existing status or removal call as an optional `reason`; Skip sends none. Queued offline with the edit; VoiceOver reads the four options; meets the §8.5 AAA rules. Never shown for templates or for deleting a whole plan. | P1 (§10.7 L2) |
| Templates | Plans without an athlete; clone into real plans | Native. | P0 |
| Move library | Browse, search, edit personal moves; sport and category dropdowns; archive | Native. | P0 |
| New move from the plan editor *(added 2026-10-11, TestFlight feedback)* | The editor's move picker has **New**: name, sport, category, default target, cue (*2026-10-11:* why and description, optional), then **Save to library & add**; a similar name offers the existing move | Parity: the picker opens with **New move** at the top, offers **Create "…"** when the search has no exact match, and offers **New move** on an empty library. Only the name must be typed: sport (the plan athlete's, else the plan's moves', else the coach's first), category (the plan's most used, else the sport's first) and a 10-rep target are prefilled and changeable. **Save to library & add** saves the move and adds it to this plan; a same-name move offers Overwrite, Keep both, or Add the existing one (`.alert`). Coaches only: an athlete's authoring picker stays library-only. | P0 |
| AI drafts for new moves *(added 2026-10-11, #53)* | **Draft with AI** in the library move sheet and the editor's new-move form | The shared move form (library and plan editor) has **Draft with AI** under the name once a name and sport are set: `POST /coach/moves/draft` fills only empty description, cue and why (category only when empty); AI-written fields are marked "Drafted by AI — check it" until edited, Gradus library text is not marked, and nothing says where a draft came from; if all three are filled it asks before replacing them. When Gradus doesn't recognise the move (`recognition` is `unsure` or `unknown`), nothing is filled: an inline message under the button (not a toast; VoiceOver announces it) offers a hint field and **Draft again**. Needs a connection; a 503 or a server that has not been published yet reads "AI drafting isn't available right now." Hidden for athletes. | P1 |
| Starter programs | Adopt the Gradus starter plan (new figure skating coaches) | Native. | P1 |
| Plan sharing | Share token → public `/p/:token` page; import a shared plan; share-to-socials button | Share sheet; import flow from universal link. *2026-10-03 (#35):* the same link is how athletes pass plans to friends; an athlete who opens it gets "Add to my plans" (copy, active). | P1 |
| Draft from competition results | Generate a plan from linked results | See §7.11. | P1 |

### 7.4 Coach — voice

| Feature | Web today | iOS requirement | Pri |
|---|---|---|---|
| Voice FAB | Hold to record up to 90 s with live waveform and timer; ElevenLabs transcription; AI parses into a full plan (create mode) or edits to the open plan (edit mode); AI-touched fields highlighted with diffs | Native press-and-hold button with haptics, `AVAudioRecorder`, live level meter, cancel by slide. Audio saved locally first; if offline, queued and the user is told the draft will appear when online. Diff highlighting preserved. | P0 |
| Voice notes in messages | Push-to-talk recording, playback with progress | See §7.6. | P0 |

### 7.5 Messaging and safety (all roles)

| Feature | Web today | iOS requirement | Pri |
|---|---|---|---|
| Conversations list | Rooms with last message, unread badges; new conversation from targets list; recipient chips for coaches | Native list; unread counts from push and realtime; new-conversation picker. Cached offline. | P0 |
| Room view | Three-way rooms (coach ↔ parent ↔ athlete), direct coach–coach and coach–parent rooms; text, voice notes, plan-tagged messages, "message coach about this plan" pre-tag; read marks; realtime; 500-message cap today | Native thread with cursor pagination, realtime, optimistic send with "Sending…", retry and delete-draft on failure; voice note record and play (§6.7); plan tag chip opens the plan. Keyboard-safe composer. | P0 *2026-09-24:* a room with a minor opens and accepts sends only with a verified adult who is not the coach as a participant; minors get a text-only composer (mic hidden, VoiceOver label says why); a parent-paused coach sees a "paused by the parent" state instead of the composer (§6.13 A6–A7, C). |
| Unread total | Badge on tab | Tab badge and app icon badge. | P0 |
| Reply from a notification | — | *Added 2026-10-11 (#54):* a message notification has a text Reply (iPhone, and the mirrored copy on the watch); the reply sends to that room without opening the app, through the thread's send path, and a local notice says when it didn't go. | P0 |
| Report and block | Report a user or message with reason; block and unblock; blocked users list in Settings | One tap from the room header and the message context menu; blocked list in Settings. | P0 *2026-09-24:* the Safe Sport panel and the listing state a contact address and a response commitment (Guideline 1.2). |
| Report a resource | Parents and athletes can report a resource | With Resources (§7.9). | P1 |
| Competition recaps in messages | Recaps appear in the room | Native rendering of the recap message type. | P1 |

### 7.6 Practice sessions (parent and athlete)

| Feature | Web today | iOS requirement | Pri |
|---|---|---|---|
| Plan detail for the runner | Moves with expandable How / What / Why; flow-state bars; practice log with attribution (who logged) | Native detail; large touch targets; readable at arm's length. | P0 |
| Session timer | Start / pause / resume / end with screen wake lock; one active session across the app (persistent bar) | Timestamp-based timer; Live Activity; local notifications; persistent bar; keep-awake while the timer screen is visible. | P0 |
| Flow-state feedback | 5-point (Frustrated / Pushing / Steady / Locked in / Flowing) + note on end | Native sheet; submission queued offline with idempotency. *2026-09-20:* these five words are canonical everywhere, including every server prompt that reads a session (decision #18). The log measures how practice felt; it is never extended into per-move mastery ratings (§6.7). | P0 |
| Message coach about this plan | Pre-tagged message | Deep link into the room composer with the tag. | P0 |

### 7.7 Parent — athletes, coaches, goals, schedules, team

| Feature | Web today | iOS requirement | Pri |
|---|---|---|---|
| My athletes | Edit name and birthdate; athlete invite code and claim link (minors only); account status; add and remove athletes | Native disclosure per athlete. | P0 *2026-09-24:* shows the athlete's state (`active`, `provisional`, `paused`) and the parent's own verification state; invite codes appear only once the parent is verified. |
| Coaches per athlete | Link by coach invite code with preview; unlink; update sports; primary coach per sport; coach visibility toggles | Native. | P0 (visibility toggles P1) |
| Pause messaging with a coach (new, 2026-09-24) | — | Per coach per athlete: pause and resume (`PUT /parent/athletes/{id}/coaches/{coachId}/messaging`); confirmation alert; the coach is told the room is paused. Honors the MAAPP discontinue-contact rule (§6.13 C). | P0 |
| Goals editor | Per sport: current level, season goal, long-term goal | Native form. Current level and season goal are also self-editable by the athlete regardless of age — see §7.8. | P0 |
| Practice schedule | Per coach: days, times, frequency, start date | Native editor with the same rules as the coach side. | P0 |
| Reset athlete password | Parent-issued | Native with confirmation. | P0 |
| Goals dashboard | Plans / Goals tabs on the Plans screen | Native. **Mariah's call, 2026-09-20:** the primary parent (the athlete's owning account — the Team plan payer, or the sole connected parent without a Team plan) edits current level, season goal, and long-term goal from the goal card here too, not only from Settings → Athletes. Co-guardians see the card read-only; `GET /parent/goals` carries `guardianRole` so the client knows which. | P0 |
| Team plan and guardians | Up to three guardians per athlete; invite, resend, revoke, remove; Team plan status; billing on web | Guardian management native; plan status display; billing link per §6.8. | P1 |
| Guardian activity mirroring | Guardians see the same rooms, plans, and sessions; ~~unclaimed guardians get email copies of coach and athlete messages~~ | Comes for free from the server; verify in QA. *2026-09-24:* the email mirror to unclaimed guardians is retired (§6.13 A6); a guardian sees a minor's rooms only as a verified, claimed participant. | P0 |

### 7.8 Athlete — goals and motivation

| Feature | Web today | iOS requirement | Pri |
|---|---|---|---|
| Plans / Goals tabs | Same as parent minus management | Native. | P0 |
| Motivation card | Editable "What motivates you?" up to 500 chars; editable long-term goal | Native. | P0 |
| Goal editor (self) | Current level and season goal were parent-only in the original scope | **Mariah's call, 2026-09-16: wrong — editable by the athlete too, minor or adult.** Native level/season-goal picker on the athlete's own goal card, same fields as the parent's editor (§7.7). Uses the existing `PUT /adult-athlete/goals`: despite the path name, its RLS check (`athlete_can_self_connect`) is ownership-only (`athletes.user_id = auth.uid()`), not gated on `self_managed` or age — so it already authorizes a minor's own session. No backend change needed, only the iOS client and this doc were behind. | P0 |
| Coaches | Add a coach by code (parent-managed and adult athletes) | Native. | P0 |
| Parent or guardian | Guardian email on file, invite a guardian (adult athletes) | Native. *2026-09-24:* a provisional 13–17 athlete sees "Waiting for your parent" with resend and what unlocks after the claim; a minor's composer is text-only (§6.13 A4, A7). | P1 |
| Own plans *(added 2026-10-03, #35)* | — (new; §6.14) | "+" on the Plans tab creates a draft; the coach editor in authoring mode (moves from the seeded library, inline edits, reorder, notes, activate / bench / delete, share); a "Mine" caption and filter; opening an own plan pushes the editor, any other plan the runner. Edits queue offline. | P0 |
| Voice → own plan *(2026-10-03, #35, #37)* | — | The voice button on the athlete's Plans tab and in the editor, create and edit modes, through `POST /athlete/voice/build-plan`; adult athletes only (#48): hidden for an athlete under 18 or without a birthdate, whose audio the server refuses (§6.13 A7). | P0 |
| Seeded move library *(2026-10-03)* | — | Read-only Library segment: the curriculum for the athlete's sports, grouped by category, searchable; add to a plan from the picker. No personal moves. | P0 |
| Adopt a shared plan *(2026-10-03)* | — | `SharedPlanView` shows "Add to my plans"; the copy lands active and opens. | P1 |

### 7.9 Resources and Ask Gradus

| Feature | Web today | iOS requirement | Pri |
|---|---|---|---|
| Library | Curated PDFs by sport, searchable, signed-URL viewer (iframe) | `PDFKit` viewer; downloads cached; share sheet. | P1 |
| Coach uploads | Upload a resource PDF for their athletes; delete | Files picker upload via signed upload URL. | P1 |
| Ask Gradus | Sport-scoped Q&A; parent persona and youth-athlete persona with safety guardrails; markdown answers | Native chat-style screen; render markdown with `AttributedString`; network required. | P1 |
| Grounded answers and sources *(added 2026-09-20)* | — (new; §6.7) | Each answer shows its sources as tappable rows under the text (title, section, page); a library source opens in the PDF viewer at that page. An answer with `grounded: false` shows the "not from Gradus sources" line the server already put first, styled as a note, not hidden. A safety-routed answer shows the Safe Sport panel inline above the text. Saved answers keep their sources. | P1 (§10.7 L5) |
| Saved answers | Save, view, delete | Native; cached offline. | P1 |
| Safe Sport panel | Hotlines and external reporting links for athletes | Static native panel; links open in Safari; **P0** because it is a safety feature, even though the rest of Resources is P1. | P0 |

### 7.10 Live Board, competition results, and recaps

| Feature | Web today | iOS requirement | Pri |
|---|---|---|---|
| Live Board | See §6.9 | Native tab with Live Activity and widget. | P0 (widget P1) |
| Attendance and recap prompt | Viewing records attendance; next day a recap prompt appears for coaches and parents; recap sheet posts into messages | Attendance P0; recap prompt and sheet P1. | P0 / P1 |
| Competition results linking | Coach links a rostered athlete to a skater in a finished competition; results shown in athlete detail as stacked folders | Native. | P1 |
| Post-event prompt | Coach sees "link your athletes" after a competition; dismiss | Native card. | P1 |
| Generate plan from results | Draft a plan from an athlete's protocol | Native; network required. | P1 |

### 7.11 Billing and invoicing

| Feature | Web today | iOS requirement | Pri |
|---|---|---|---|
| Plan status | Tier, trial, Founding Coach, card-needed nudge, past-due banner | Display only per §6.8; banners preserved with neutral copy. | P0 |
| Choose / change plan, add card, billing portal | Embedded Stripe checkout and portal | **Web only.** US storefront gets a link; others get status only. | P0 (link) |
| Claim / restore Founding Coach tier | Free action | Native. | P1 |
| Athlete rates and invoices | Per-athlete rate (per session or hourly), draft lines from lessons, preview, create, mark paid, delete, share invoice via share sheet | Native invoicing screens; share via native sheet. | P1 |

### 7.12 Settings and account

| Feature | Web today | iOS requirement | Pri |
|---|---|---|---|
| Profile | Name, email (coach: also coaching sports and levels) | Native. | P0 |
| Appearance | Light / Dark / System | Native; respects system by default. | P0 |
| Account & security | Change password, change email, delete account with impact preview | Native; password change through the SDK; delete per §6.4. | P0 |
| Device | Push toggle with permission state; Face ID / Touch ID lock | Native. | P0 |
| Legal | Privacy, terms, licenses | Opens web pages; adds open-source licenses screen. | P0 |
| Support / feedback | Feedback FAB on most screens; feedback list | Feedback from Settings and a shake gesture (optional); no floating button. | P0 |
| Sign out | | Native. | P0 |
| Connections hub (coach) | Enter a code, join a club, coach visibility | Native. | P1 |
| Pending changes (Sync Center) | Not on web | *Removed 2026-09-12 at Mariah's request* (gradus-ios PR #28): no screen and no Settings badge; the outbox engine still runs silently. | — |

### 7.13 Cross-cutting behaviors

- **Presence.** `POST /me/presence` on foreground, at most every 5 minutes (mirrors `useTouchLastSeen`).
- **Feature flags.** From `/meta/config`: paywall enabled, Coach Pro available, Founding cutoff date, minimum client version. Never compiled in.
- **Promo codes.** Pending code captured at sign-up and applied after the profile exists, with the same 5-attempt cap as the web.
- **Error boundaries.** Every tab has a recoverable error state with "Try again"; module-load recovery logic from the PWA is not applicable.
- **Haptics.** Light impact on primary actions, success/warning/error notifications on outcomes, matching the web's `haptic()` call sites.
- **Localization.** English only; strings in a catalog from day one so Kotlin and future locales can reuse them.

### 7.14 Explicitly web-only or dropped

Admin panel, org admin, email admin and previews, dev tools and paywall preview, impersonation, PWA install banner and update prompt, service worker chunk recovery, hydration diagnostics, Turnstile widget, embedded Stripe checkout, the `board` demo mode, and the Capacitor plugins (`@capacitor/*`, `@capgo/capacitor-native-biometric`). *2026-09-19:* the Capacitor iOS project can be removed from the web repo at any time, since the shell will not ship; the Android shell's fate is open (§12 #14), so `android/`, `capacitor.config.ts` and the web's `isNativeApp()` branches stay until that is decided.

---

### 7.15 Apple Watch (added 2026-10-03)

Decision #36; design §6.15. Headphones-first: every screen speaks, every input is one large button or a recorded clip. All text meets the §8.5 contrast and target rules at watch sizes.

| Feature | Roles | Watch requirement | Pri |
|---|---|---|---|
| Session hand-off | all | Signed in on the phone → the watch receives its own session over WatchConnectivity (`POST /auth/companion`); sign-out on either side revokes the other. | P0 |
| Plan → audio | athlete, parent, coach | Pick a plan (spoken list, tap), hear the full read; next / previous / repeat; keeps playing through headphones when the wrist drops; cached for the rink. | P0 |
| Session timer | athlete, parent | Start / pause / end from the wrist, the same timestamp timer and the same flow-state sheet; ownership shared with the phone over WatchConnectivity. | P0 |
| Voice → plan | athlete, coach | One button to record (≤ 90 s, screen awake), spoken read-back of what was built, "Keep it" / "Try again". | P0 |
| Deploy a plan | athlete, coach | Spoken list of drafts; coach picks an athlete and activates, athlete activates their own; ~~the bench conflict is spoken with the two choices~~ activation always goes through (#52). | P0 |
| Pre-lesson briefing | coach | "Up next" shows the athlete and time; tap to hear the briefing; nothing is spoken unprompted. | P0 |
| Post-lesson wrap-up | coach | Pending wrap-ups listed; tap → spoken prompt → record → spoken result → Keep / Re-deploy / Didn't happen / Dismiss. | P0 |
| Messaging | all | *Changed 2026-10-11 (#54):* a tap on a message notification opens that conversation in the watch app: the latest messages (sender, time, text; a voice note says "play it on your iPhone"), marked read; reply by dictation, Scribble, the keyboard or a quick reply, text only for every role; "Try again" keeps a failed reply. A Messages row on the home for every role. Reply on the notification itself runs on the iPhone. | P0 |

---

## 8. Design system on iOS

**Intent.** The coach's-notebook, editorial-print feel carries over: paper backgrounds, translucent cards, serif display type, hyperlegible body text, "pen" accent colors used like highlighters. Navigation, gestures, controls, and motion are native iOS. A coach should recognize Gradus instantly and never feel they are using a web page.

### 8.1 Typography

| Role | Web token | iOS |
|---|---|---|
| Display / headings | `--font-display: EB Garamond` | Bundle **EB Garamond** (OFL). `Font.custom("EBGaramond-Regular", size:, relativeTo:)` mapped to `.largeTitle`, `.title`, `.title2`, `.title3`. Fraunces stays bundled for the Gradus wordmark only. |
| Body / UI | `--font-sans: Atkinson Hyperlegible` | Bundle **Atkinson Hyperlegible** (regular, bold, italics). Mapped to `.body`, `.callout`, `.subheadline`, `.footnote`, `.caption`. |
| Numbers / labels | `--font-mono: JetBrains Mono` | Bundle **JetBrains Mono** for scores, timers, invite codes, start positions. Tabular figures for the timer. |
| Hand accent | `--font-hand` (currently aliased to Atkinson in the app) | Not bundled. If the hand style returns, add Caveat later. |

All text uses Dynamic Type through `relativeTo:` so accessibility sizes work. Minimum body size is 17 pt at the default setting. Line lengths are capped at ~70 characters on iPad.

### 8.2 Color tokens

Tokens are exported from `src/styles.css` by a script in the web repo (`scripts/export-design-tokens.ts`) that converts the OKLCH values to sRGB for light and dark and writes a platform-neutral `docs/api/design-tokens.json`; CI checks it is current. The `gradus-ios` repo vendors that file with the API contract and generates `Colors.xcassets` from it, so web, iOS, and later Android never disagree on a color.

| Token | Light (web) | Dark (web) | iOS usage |
|---|---|---|---|
| `background` | paper `#F5F6FA` (oklch 0.972 0.005 250) | oklch 0.175 0.028 226 | Window and scroll backgrounds |
| `card` | white at 55% | oklch 0.255 0.012 245 at 62% | Cards over paper with `.ultraThinMaterial` beneath |
| `elevated` | oklch 0.982 0.004 250 at 62% | oklch 0.285 0.012 245 | Sheets, popovers |
| `divider` | `#E6E7EB` | oklch 0.36 0.012 245 | Separators |
| `text-primary / secondary / tertiary / disabled` | navy ink scale | warm cream scale | Text hierarchy; secondary is AAA on background |
| `accent` | pen-tennis (chartreuse) | pen-pool (cyan) | Primary actions, active tab; note the accent **changes hue** between modes exactly as on the web |
| `accent-ink` | tennis ink | pool | Text on accent surfaces |
| pen set `tennis / pool / orange / iris / pink`, each with `-wash` and `-ink` | as in styles.css | as in styles.css | Sport and flow-state coding, chips, Live Board lanes |
| `destructive`, `destructive-ink` | oklch 0.58 0.22 25 | oklch 0.7 0.17 25 | Delete, block, errors |
| Radii | 8 / 14 / 20 / 28 / 36 / 44 / pill | | Cards 20, sheets 28, chips pill, buttons 14 |
| Shadow | `shadow-card` | | One soft card shadow; none in dark mode beyond the inset highlight |

Theme follows the user's Appearance setting (Light / Dark / System), persisted locally and mirrored to the profile so web and app agree.

### 8.3 Component mapping

| Web component | iOS equivalent |
|---|---|
| Bottom nav (Roster · Plans · Resources · Messages · Settings; parent and athlete: Plans · Messages · Resources · Settings; Live added for all) | `TabView` with SF Symbols; Live Board tab present signed out |
| Sheet (vaul drawer) | `.sheet` with `.presentationDetents([.medium, .large])` and drag indicator; full-screen cover for editors |
| AlertDialog | `.alert` / `.confirmationDialog` |
| Popover / Dropdown / Context menu | `Menu`, `.contextMenu`, `.popover` on iPad |
| Card, Chip, Tag, Eyebrow | `GradusCard`, `GradusChip`, `GradusTag`, `Eyebrow` views in `GradusDesign` |
| SegmentedToggle | `Picker(.segmented)` restyled, or a custom segmented control where the web's look matters (Live Board) |
| `press` / `press-soft` button utilities | `PressButtonStyle` (scale 0.97, opacity, light haptic) |
| Sonner toasts | `ToastHost` overlay, bottom-anchored, swipe to dismiss |
| Skeleton | `.redacted(reason: .placeholder)` with shimmer |
| Voice FAB, Feedback FAB | Voice: floating record button on the plan editor only. Feedback: Settings row (no floating button) |
| Swipe to delete on plan cards | `.swipeActions` |
| Lucide icons | SF Symbols, with a small custom symbol set for sports and flow states |
| Logo | Vector asset (navy on cream mark already redrawn for the icon) |

### 8.4 Navigation and gestures

- One `NavigationStack` per tab with type-safe routes; deep links push onto the matching stack.
- Back is the system back gesture. No custom back buttons.
- Long lists support pull to refresh, swipe actions, and context menus.
- The composer, timer, and voice recorder respect the keyboard and safe areas; no content hides behind the tab bar.
- iPad: two-column layout for Roster (list → detail) and Messages (rooms → room); everything else is a centered readable column.

### 8.5 Motion, haptics, accessibility

- Motion is short (≤ 250 ms) and purposeful; the connection celebration and skater wheel honor Reduce Motion.
- Haptics as in §7.13. Never haptic on scroll or passive updates.
- VoiceOver labels on every control; the five icon-only buttons the web labeled get the same labels. Live Board lanes announce data age.
- Contrast stays at the web's AAA targets; Increase Contrast switches to opaque cards.
- Minimum hit target 44 × 44 pt. Dynamic Type through accessibility sizes without truncating scores or timers.
- *2026-09-19 (Mariah):* the app passes **WCAG 2.2 Level AAA** before QA starts. The 2026-09-17 audit is the checklist and the order of work is in §10.6. iPhone supports **landscape** (1.3.4). Score-sheet abbreviations (GOE, deductions, factor, IJS) are expanded on first use (3.1.4). Contextual help (3.3.5) is deferred and stays partial by design.

---

## 9. Engineering standards

### 9.1 Repositories and layout

Two repositories, one contract.

| Repo | Holds | Deployed by |
|---|---|---|
| `gradus-coach-start` (existing) | Web app, server logic, `/api/v1`, migrations, the Capacitor shells (`ios/`, later `android/`), and the contract files: `docs/api/openapi.json`, `docs/api/vectors/`, `docs/api/design-tokens.json`; this PRD | Lovable publish |
| `gradus-ios` (new) | The native Swift app, its generated client, and a pinned copy of the contract files | Xcode Cloud → TestFlight → App Store |
| `gradus-android` (later) | The Kotlin app, same pattern | Play Console |

**Why the split.** The web repo is production and Lovable syncs every commit on its `main`. Keeping the Swift codebase out of it means no iOS churn flows through the repo that serves current users, and the iOS repo gets its own macOS CI and release cadence. The backend API cannot move: it runs inside the Worker that Lovable deploys.

**How the contract flows.** `gradus-ios/Contract/` holds `openapi.json`, `vectors/`, and `design-tokens.json` plus a `SOURCE_COMMIT` file. `scripts/sync-contract.sh` fetches those files from `gradus-coach-start` at a given commit (via the GitHub API or a shallow clone), records the commit, and regenerates the Swift client and the color catalog. Updating the contract is a deliberate PR in the iOS repo, reviewed like any other. The iOS CI fails if generated code is stale relative to the vendored contract.

```
gradus-ios/
  Gradus.xcodeproj
  Gradus/                     app target (composition root, AppDelegate for push, scenes)
  GradusWidgets/              WidgetKit extension: Live Board Live Activity + widgets, session-timer activity
  GradusWatch/                watchOS app target (independent; 2026-10-03, §6.15) — spoken plans, briefings, wrap-ups, voice→plan
  Packages/
    GradusAPI/                generated OpenAPI client + auth broker + interceptors + DTOs
    GradusCore/               models, repositories, sync engine, outbox, feature flags
    GradusDesign/             tokens (generated from design-tokens.json), fonts, components, haptics
    FeatureAuth/  FeatureOnboarding/  FeatureRoster/  FeaturePlans/  FeatureVoice/
    FeatureMessages/  FeatureSessions/  FeatureBoard/  FeatureResources/  FeatureSettings/
    FeatureWatch/             the watch screens and narration player (2026-10-03); PlanNarration itself lives in GradusCore
  Contract/                   vendored openapi.json, vectors/, design-tokens.json, SOURCE_COMMIT
  scripts/sync-contract.sh
  Tests/                      unit (Swift Testing), UI smoke (XCUITest), snapshot (optional)
  docs/README.md              points at docs/ios/PRD.md in the web repo; iOS-only notes live here
```

*Amended 2026-09-19:* the native app is versioned `1.0.x`; there are no shell releases. The Capacitor `ios/` project can be deleted from the web repo at any time; `android/`, `capacitor.config.ts`, `native/`, and the `@capacitor/*` dependencies stay until the Android decision (§12 #14) is made. All of it is inert for the web.

### 9.2 Language, frameworks, dependencies

- **Swift 6** language mode with strict concurrency; SwiftUI throughout; `@Observable` view models; async/await; no Combine except where a framework demands it.
- **Deployment target iOS 18.0**, built with the current Xcode. iPhone device family only in 1.0 (decision #50); the iPad layouts stay in the code for a later release.
- **Dependencies (kept minimal, all SPM):** `supabase-swift` (Auth, Realtime, Storage), `swift-openapi-generator` + `swift-openapi-urlsession`, `GoogleSignIn-iOS` (only if the native Google SDK path is chosen). No Firebase, no crash SDK, no UI kit, no analytics SDK (usage analytics are first-party, §6.12 and §12 #19). Markdown via `AttributedString`. PDFs via `PDFKit`. Audio via `AVFoundation`.
- **UIKit** only where SwiftUI lacks coverage (camera capture, share activity items, WKWebView audio fallback).

### 9.3 Architecture inside the app

- **Unidirectional data flow.** Views read from repositories through observable stores; writes go through repository methods that update the local store and enqueue mutations.
- **Repositories** are protocols with live and preview/mock implementations so every screen has SwiftUI previews and tests without a network.
- **Routing** is a single `AppRoute` enum decoded from universal links, push payloads, and in-app navigation.
- **Errors** are typed (`APIError` with the server's code) and mapped to user copy in one place.
- **Feature flags and client policy** are read from `/meta/config` and cached; a force-update screen appears when the client is below `minSupportedVersion`.

### 9.4 Backend engineering rules (in addition to §4)

- API routes contain no business logic; they validate, call the shared function, and serialize.
- Every endpoint has an OpenAPI entry with request and response schemas and at least one example; `bun run openapi` regenerates `docs/api/openapi.json` and CI diff-checks it.
- Every new table: migration with GRANTs and RLS; no service-role-only tables without a written reason in the migration header. Every service-role-only function: explicit `REVOKE … FROM PUBLIC, anon, authenticated` (§4.1 rule 12). After merge: ask Lovable to apply pending migrations, then run the precheck (§4.1 rule 11).
- Secrets (`APNS_KEY_P8`, `APNS_KEY_ID`, `APPLE_TEAM_ID`, `APPLE_SIWA_KEY_P8`, `GOOGLE_IOS_CLIENT_ID`, `AI_PROVIDER`, `GOOGLE_AI_API_KEY`, `API_V1_ENABLED`) are set in Lovable Cloud secrets and read with `process.env`, like the existing ones.
- Idempotency keys expire after 24 h via pg_cron, matching the existing cron pattern.
- *Added 2026-09-20:* knowledge ingestion and skill-event inference run inside the Worker or as pg_cron jobs, never as local scripts (no session holds a service-role key). Every prompt that reads `plan_sessions.state_index` imports `stateLabel` from `session-states.ts`. Every `knowledge_sources` row has a rights basis before its chunks are written.

### 9.5 Testing

| Layer | What | Tool |
|---|---|---|
| Shared server functions | Unit tests on extracted functions with a fake Supabase client; contract tests that the API response matches the OpenAPI schema | `bun test`, zod schema validation |
| Recurrence and formatting parity | Shared JSON test vectors (`docs/api/vectors/*.json` in the web repo, vendored into `gradus-ios/Contract/`) run by both the TypeScript and Swift implementations of lesson recurrence, name normalization, session labels | `bun test`, Swift Testing |
| Sync engine | Outbox ordering, retry, idempotency replay, conflict handling, sign-out wipe | Swift Testing with an in-memory store and a scripted fake API |
| View models | State transitions per screen | Swift Testing |
| Critical flows | Sign in, open roster, open plan, send message, start and end a session, open a board | XCUITest on simulator against a mock API server |
| Manual | Real device, real accounts (the seeded demo coach and parent), the debug-only simulate-offline switch, background and kill scenarios; run by Claude Code, spot-checked by Mariah | Checklist in `docs/ios/QA.md` (created in Phase 4) |

Production is the only Supabase environment (Lovable preview shares it), so automated tests never hit it. Manual testing uses the existing demo accounts and clearly named test rooms.

### 9.6 CI, builds, releases

- **GitHub Actions, web repo.** Existing `Bun CI` (lint, typecheck, build) plus OpenAPI and design-token freshness checks. No macOS jobs here.
- **GitHub Actions, iOS repo.** A macOS job running `xcodebuild test` on every PR, plus a check that the generated client and color catalog match the vendored contract.
- **Builds and TestFlight.** Xcode Cloud (included with the developer program) connects to `gradus-ios`, archives `main` on tag, and uploads to TestFlight; internal testers get every build, external beta gets tagged releases. Fastlane is not required.
- **Versioning.** Marketing version `MAJOR.MINOR.PATCH`; build number auto-incremented by Xcode Cloud. `X-Gradus-Client` carries both.
- **Branching, web repo.** Backend work in short-lived branches merged to `main` by PR. Because Lovable also commits to `main`, PRs are rebased before merge and never left open across a day Mariah is editing in Lovable. Publishing to production remains a deliberate action in Lovable after CI is green.
- **Branching, iOS repo.** Short-lived branches merged by PR; no Lovable involvement. Cloud Claude Code sessions run on Linux and cannot build a SwiftUI app, so iOS work runs in local sessions on the Mac; backend work can run in the cloud.
- **Crash and error visibility.** MetricKit diagnostics and caught errors go to `/errors` and appear in the admin errors dashboard, tagged `platform=ios` with app version and build.

---

## 10. Milestones and delivery

### 10.1 How we work

Milestone-driven, no calendar. Milestones are taken one at a time in the order below; when one meets its definition of done, the next starts. Claude Code builds and verifies its own work (simulator, screenshots, tests, the simulate-offline switch). Mariah gets one short update a day with what changed, screenshots or a recording, and any decision that needs her; she taps through on her phone when she wants to. No time estimates are kept in this document. If a forecast is ever wanted, it is computed from the measured pace of completed milestones, not from benchmarks.

Two external dependencies gate specific milestones and can arrive at any moment: **Apple Developer enrollment** (TestFlight, push, Sign in with Apple, universal links) and **Google Play console setup**. When enrollment lands, the enrollment-gated milestones are taken next, whatever else is in progress.

**Definition of done, for every milestone:** merged to `main` of the right repo; CI green; verified on the simulator and, where behavior depends on it, a device; shown working in the daily update; nothing in §4 violated; judgment calls listed in the PR description.

### 10.2 Milestone sequence

Backend milestones live in the web repo and can run overnight in cloud sessions. iOS milestones live in `gradus-ios` and run on the Mac. Package numbers refer to the scope breakdown in Appendix F; endpoints are in Appendix A and screen requirements in §7.

**Backend**

| # | Milestone | Scope | Done when |
|---|---|---|---|
| B1 | API foundation | Package 0.1: plumbing, kill switch, meta, presence, terms, OpenAPI, tests | Merged and published; `/api/v1/meta/config` answers in production with the flag on; web guardrails (§2) unchanged |
| B2 | Auth broker | 0.2: Apple, Google, password and username, coach sign-up, recover, `auth_identities`, Apple revoke on delete | Each endpoint returns a working Supabase session for a real test account (Apple end to end once the key exists) |
| B3 | Domain endpoints, wave 1 | 0.3: messages, plans and moves, roster and schedule, sessions, settings for three roles, invites and sign-up flows | Every Appendix A endpoint for those domains live; server-function behavior unchanged; OpenAPI committed |
| B4 | Domain endpoints, wave 2, and push | 0.4, 0.5: board, competitions, resources, invoicing, guardians, visibility, org, voice accepting `audio/mp4`; APNs sender, triggers, device and Live Activity tokens, `board_follows` | Remaining endpoints live; a test device receives a push for a new message |

**iOS**

| # | Milestone | Scope | Done when |
|---|---|---|---|
| I1 | Repo and foundation | 1.1–1.5: `gradus-ios`, project and packages, contract sync, tokens and fonts, generated client, auth screens, local store and outbox, tab shell, routing, push registration | Sign in with email or username on a device; role tabs render; sync-engine tests pass; a universal link opens the app |
| I2 | Live Board | 2.11, 2.12 | A real or demo competition renders all three tabs; following persists; a Live Activity appears for a followed skater |
| I3 | Messaging | 2.6 | Text and voice notes exchanged with the web in the other seat; realtime; report and block |
| I4 | Sign-up and onboarding | 2.1 | A new coach, parent, minor athlete, and adult athlete can each sign up and onboard from the app; invite links work |
| I5 | Roster and schedule | 2.2, 2.3 | Week schedule matches the web for the demo coach; slot create, edit, cancel, reschedule round-trip; athlete detail, briefing, wrap-ups |
| I6 | Plans, library, voice | 2.4, 2.5 | Plan editor round-trips every field with the web; templates clone; the voice FAB produces a plan |
| I7 | Sessions and timer | 2.7 | Timer survives lock and kill; Live Activity; feedback submits; the session shows on the web |
| I8 | Settings for all roles | 2.8, 2.9, 2.10 | Parent athlete, coach, goals, and schedule management; athlete goals; account and security including deletion; plan status; Sync Center |
| I9 | Offline and push, end to end | 2.13, 2.14 | Every write in I3–I8 queues offline and drains; push routes to the right screen; badges correct |
| **T1** | **Internal TestFlight** (needs App Store Connect set up; taken after the §10.6 gate) | Xcode Cloud, internal group | A build installs from TestFlight on Mariah's phone; QA begins |
| ~~C1~~ | ~~Capacitor iOS 1.0 to the App Store~~ **Dropped 2026-09-19** | — | — |
| T2 | External TestFlight | I1–I9 complete | Founding Coaches and a few parents are using it |
| I10 | Resources and Ask Gradus | 3.1, 3.2 | Library, PDF viewer, coach upload, Ask Gradus, saved answers |
| I11 | Invoicing | 3.3 | Rates, preview, create, detail, status, share |
| I12 | Competitions and recaps | 3.4 | Results linking, post-event prompt, plan from results, recap flow |
| I13 | Guardians, team, visibility, celebration | 3.5 | Guardian claims and team invites; coach visibility; connection celebration |
| I14 | Import, share, starters, connections hub, in-app reset | 3.6, 3.7 | Schedule import; plan share and import; starter programs; Founding claim; password reset in-app |
| I15 | Widget, lesson reminders, App Attest | 3.8 | Widget shows next up; reminders arrive; App Attest on auth |
| C2 | Capacitor Android 1.0 to Google Play, **reopened 2026-09-19** (§12 #14) | Phase D | Mariah decides whether it ships at all |
| L1–L5 | Athlete learning loop and grounded Ask Gradus *(added 2026-09-20)* | 3.10–3.12; the milestone table is §10.7 | Taken after the §10.6 gate, alongside T1/T2 QA, as TestFlight builds; all five merged before I16 |
| A1–A2 | Usage analytics *(added 2026-09-22)* | §6.12; the milestone table is §10.8 | Taken after the §10.6 gate, alongside L1–L5; both merged before I16 so launch has data |
| I16 | Hardening and submission of native 1.0 (was 2.0) | Phase 4, plus 3.9 preparation; the pre-QA gate in §10.6, the §10.7 milestones L1–L5 and the §10.8 milestones A1–A2 come first | QA checklist passes; crash-free ≥ 99.5% on TestFlight; submitted |
| L | Native 1.0 live | | Approved; first store release, no shell migration |
| K | Kotlin rebuild starts | its own PRD | |
| L6 | Learned pace model *(added 2026-09-20; post-launch, not gating)* | 3.13 | Taken when §12 #17 says the data supports it |

### 10.3 Build order rationale


1. **API first** so no screen is ever blocked on the backend, and so the web-safety refactor happens while attention is highest.
2. **Foundation before features** so offline, auth, and routing are not retrofitted.
3. **Live Board and messaging first among features** because they are the most time-sensitive (competition season), the best demonstration of native value, and the least entangled with the rest of the app.
4. **Plans and roster next** because they are the coach's daily loop and the largest packages, so they need the longest bake in TestFlight.
5. **Settings and sign-up after the daily-loop features** because until external TestFlight, testers can be provisioned on the web.

### 10.4 Web sunset plan (for coaches, parents, athletes)


Sunset is a Mariah decision, made when all of the following hold (the week counts below are measurement windows, not forecasts):

1. Every P1 item is shipped and verified on device, and no P0/P1 bug has been open more than two weeks.
2. Crash-free sessions ≥ 99.5% for four consecutive weeks.
3. iOS accounts for ≥ 90% of weekly-active coaches, parents, and athletes **who use Apple devices** for four consecutive weeks, driven by a "Get the app" banner on the mobile web.
4. **The Android app is live.** The web is sunset for the three roles only once both native apps exist, so Android users are never stranded. Desktop users of those roles go **native only** (decided 2026-09-04): the iOS app runs on Apple-silicon Macs as-is, a Mac build is a modest later addition, and Windows users use their phone.
5. Communications are ready: 30-day notice email, in-web banners, a support article, and an App Store redirect for mobile Safari on the retired routes.

After sunset, the web app keeps: sign-in (for admin and org admin), `/admin/*`, `/org-admin/*`, public pages (`/board/*`, `/p/*`, `/privacy`, `/terms`), the auth email landing pages, and `/api/*`.

**Building in Claude Code instead of Lovable does not by itself require leaving Lovable Cloud.** Lovable Cloud keeps hosting the database and, through Publish, deploying the Worker that serves the admin panel and `/api/v1`. Commits arrive from GitHub whether or not anyone edits in Lovable, and Publish stays a deliberate click. Moving hosting to a Gradus-owned Cloudflare account, or owning the Supabase project outright, are separate later projects (§11, risk 15) with their own runbooks.

### 10.5 Interim store presence with the Capacitor shell

> **Superseded 2026-09-19.** Mariah decided to go straight to native: no Capacitor iOS shell ships, native is 1.0, and the Android shell question is reopened in §12 #14. The section is kept as the record of the earlier reasoning.


**The mechanics.** An App Store app is identified by its bundle ID under a team, and a Play Store app by its application ID and signing key. A new build with the same identifier and a higher version is an update, whatever technology is inside it. So the Capacitor shell (`training.gradus.app`) can go live first and be **replaced by the native app as an ordinary update** later; nothing has to be chosen now. Ratings, reviews, the listing, universal links, and APNs device tokens carry over. Two caveats:

- **Users sign in once more.** The shell keeps the Supabase session in WKWebView local storage, which the native app cannot read. The update should open on a short "Welcome to the new Gradus" screen that leads to sign-in. Nothing else needs migrating; everything lives on the server.
- **The iOS 18 floor leaves older devices behind.** The shell runs on older iOS versions than the native app does. Devices that cannot update keep the last shell version, which keeps working only as long as the web app for their role is live. The sunset plan must count those users (a small population: iOS 18 covers iPhone XS and later).

On Android the same holds for a Kotlin app replacing a Capacitor build, provided the Play upload key is kept (back it up; Play can reset it through support if lost).

**Whether to do it.** Shipping the iOS shell before the native app is possible but not free. The shell still needs Sign in with Apple for Guideline 4.8, a defensible answer to the minimum-functionality rule, and its own review cycle; that is work that does not advance the native app, and users would be asked to sign in again when 2.0 arrives. The App Store Connect record, App ID, keys, and association file are needed for the native app anyway and are set up at enrollment regardless.

Android is the more interesting case: Kotlin starts only after iOS 2.0 is complete, so Android users would otherwise have only the PWA (with no push) until then. Generating the Capacitor Android app is a bounded job (JDK 17, Android Studio, `cap add android`, an AAB, the Play Console listing, `assetlinks.json`) and is fully replaceable by Kotlin later under the same application ID.

**Decision (2026-09-04).** Ship the Capacitor iOS shell as **1.0** at enrollment, then the Capacitor Android shell as the interim Android app right after iOS 1.0 is live (so the Capacitor work happens once, while it is fresh), and ship the native app as **2.0** at full parity. Version numbers: shells are 1.x, native starts at 2.0 so App Store Connect always sees an increase. The 2.0 update opens on a welcome screen that explains the one-time sign-in. Store listings are refreshed with native screenshots at 2.0.

### 10.6 Pre-QA gate and the milestones that close it (2026-09-19)

Mariah's definition of "ready to move to QA," recorded 2026-09-19: **(1) every Apple-developer-gated element is integrated into the app, and (2) the app passes WCAG 2.2 Level AAA** per the 2026-09-17 audit. QA itself starts with T1, the first internal TestFlight install on her phone, and **runs against production with `API_V1_ENABLED` on** (her decision and her action in Lovable Cloud secrets; no Claude session flips that flag). The working plan, sequencing and current state live in `docs/ios/handoff-preQA.md`; this section is the durable summary.

**Account side (Mariah).** App ID `training.gradus.app` with Push Notifications, Associated Domains, Sign in with Apple and App Groups; the widget App ID `training.gradus.app.widgets`; the App Group `group.training.gradus.app`; an APNs key and a Sign in with Apple key; the Team ID; the five Lovable secrets in Appendix D; the App Store Connect record; Xcode Cloud connected to `gradus-ios` with an internal TestFlight group. Later, not blocking: a Google Cloud iOS OAuth client, and the `gradus://reset-password` entry in the Supabase redirect allow-list. After every migration PR merges: ask Lovable to apply pending migrations, then run the `docs/api/SMOKE.md` precheck (§4.1 rule 11).

**Build milestones, in order (no dates, per §10.1):**

| # | Milestone | Repo | Scope | Done when |
|---|---|---|---|---|
| P1 | Docs | web | This amendment; `docs/ios/handoff-preQA.md` | Merged |
| P2 | Apple wiring on iOS | iOS | Sign in with Apple entitlement; `DEVELOPMENT_TEAM` once the Team ID exists; marketing version 1.0.0; Google button hidden until configured; Xcode Cloud scripts; contract re-sync | CI green; archive-able once the Team ID is in |
| P3 | Push, web wave, then a small iOS wave | web, iOS | APNs sender in `src/lib/push.server.ts`, the §6.6 triggers, lesson-reminder delivery, `live_activity_tokens` with `POST /live-activities/tokens`, board push-to-start, update and end, the AASA file with the Team ID; iOS uploads push-to-start and update tokens | A test device receives a message push and a board Live Activity started by the server (verified at T1) |
| P4 | Voice-note transcripts | web, then iOS | Additive `messages.transcript`; transcribe every voice send (WebM and M4A) through the existing ElevenLabs path, plus a sweep for old notes; transcript in room payloads; iOS shows it under the bubble and in the VoiceOver label | A web-recorded note shows its transcript on iOS |
| P5 | Accessibility: reflow, landscape, targets | iOS | Audit items 5, 6, 8: scrolling Terms gate and celebration cover; no single-line truncation of user content; stacked layouts at accessibility sizes; text-style icon fonts; 44 pt targets; landscape enabled and every screen checked in it | The audit harness at AX5 and in landscape shows no truncation and no sub-24 pt targets |
| P6 | Accessibility: tokens, lock screen, hygiene | web token export, then iOS | Audit items 7, 9, 10: light `destructive-ink` ≥ 7:1 and a dark ink on the dark destructive fill (web token change, synced through the contract), an Increase Contrast variant via `colorSchemeContrast`, ink tokens in the widget and Live Activity, `accentInk` toggles and focus rings, dimmed-text fixes, page-title stripe; content hidden behind the biometric lock; celebration identifier moved off the root | The audit's contrast table passes AAA in both appearances |
| P7 | Accessibility: everything else in the audit | iOS | Semantics (picker names, spelled-out codes, `textCase`, expand/collapse values, headings), forms (confirmations, "Error:" prefixes, Report-sheet default, disabled-reason copy, failed-load states), navigation (Safari-bound link labels, sheet titles and close buttons), media (image labels, import-result announcement), readability (jargon expansions, spoken date); contextual help deferred | Audit §6 shows only 3.3.5 as partial |
| P8 | Device pass and re-audit | iOS | Live VoiceOver, Switch Control, Voice Control, Full Keyboard Access and iPad on a device; re-run the audit harness; fix findings | Findings closed; harness clean |
| P9 | QA prep | web, iOS | `docs/ios/QA.md`; `POST /errors` and the MetricKit upload; the real Google provider once the client ID exists; native reset on once the allow-list entry exists | T1 build installs; QA begins |

### 10.7 Athlete learning loop and grounded Ask Gradus (2026-09-20)

Mariah's decision, recorded 2026-09-20: the website's "How it works" promises (Gradus learns each athlete's pace and seasonal trends; competition results feed the next plan) and a source-grounded Ask Gradus are **part of native 1.0**, and a trained model is not. §6.7 has the design; this section is the delivery record. The milestones are taken after the §10.6 gate closes, in parallel with QA on TestFlight (T1, T2), and all of L1–L5 must be merged before I16 begins. Web PR #127 (the flow-state label fix, decision #18) is already open and is a prerequisite for L3.

**Build milestones, in order (no dates, per §10.1):**

| # | Milestone | Repo | Scope | Done when |
|---|---|---|---|---|
| L1 | Skill events and level history | web | Migration for `athlete_skill_events` with GRANTs and RLS; `athlete_goals_history` arrives with web PR #129 and only needs the profile read in L3 to consume it; optional `reason` on `POST /plans/{id}/status` and `DELETE /plans/{id}/moves/{moveId}` (and on the matching web server functions, additive, default absent); protocol-derived events on results linking; OpenAPI and vectors | In Lovable preview: a bench with a reason, a removal with a reason, a level change (via PR #129's helper), and a results link each produce the expected rows; a skipped prompt produces none |
| L2 | Coach "why" prompt | iOS | The alert on Bench and on move removal (§7.3); `reason` on the outbox entry; contract re-sync; VoiceOver and AAA checks in the audit harness | Simulator: each answer round-trips to the preview and appears as an event; Skip sends no reason; offline edits drain with their reason |
| L3 | Athlete profile in the prompts | web | The derived profile read with input-hash caching; the inference job and its precision log; profile injected into plan drafting, the athlete summary, and the briefing; `generatePlanFromResults` reads the full results history and is sport-aware; vectors for each prompt | Prompt snapshots in tests show the profile block; the inference job runs in preview and logs precision against coach labels; web answers unchanged in shape |
| L4 | Knowledge corpus | web | `vector` extension; `knowledge_sources`, `knowledge_pages`, `knowledge_chunks`; the pg_cron-driven ingest hook; admin-panel registration (library PDF, public PDF by URL, text); per-coach ingestion on resource insert; chunkers per source type; `docs/knowledge/SOURCES.md`; corpus v0 ingested (§6.7) with a rights basis for every source and the pending sources cite-only. *Built 2026-09-20: web PR #130.* | Every corpus v0 source has chunks in preview; the known-answer set (admin panel) puts the expected source in the top 3 for ≥ 90% of the cases whose source is registered |
| L5 | Grounded answers | web, then iOS | Retrieval in `askGradus`; citations, `grounded`, safety routing, fallback sentence; saved answers keep sources; OpenAPI; iOS sources rows, PDF deep-open, fallback note, inline Safe Sport panel | A parent question about a rule cites the rulebook; a minor's question about pain routes to the panel; an off-corpus question returns `grounded: false` with the sentence first; all three verified on iOS against preview |
| L6 | Learned pace model *(post-launch)* | web | Scheduled fit of time-to-land per move category; predictions table; the profile reads predictions when present | Taken only when §12 #17 is decided yes; not part of 1.0 |

**What the web gets for free.** Because the grounding and the profile live inside the shared server functions, web users receive the same grounded answers and sharper drafts the moment each milestone publishes. The web shows no citations until a separate web change; that is the only visible difference between the clients, and it is deliberate under §4.1.

### 10.8 Usage analytics (2026-09-22)

Decision #19; the design is §6.12. Taken after the §10.6 gate, in parallel with L1–L5 and TestFlight QA; both merged before I16.

| # | Milestone | Repo | Scope | Done when |
|---|---|---|---|---|
| A1 | Events endpoint, table, admin report | web | Migration `analytics_events` with RLS, GRANTs and the retention cron; `POST /api/v1/analytics/events` (auth, rate limit, size caps, idempotent event ids, server-derived role, age band, club and region, minor de-identification); OpenAPI and an event-schema vector; the admin **Usage** page with the Resources table and the minors-by-club/region view | Tests prove a minor athlete's batch is stored with no user id and no coach id but with its club and region, an athlete with no birthdate on file is stored as a minor, a club with fewer than 10 minor athletes is neither stored in a row nor shown by name, no report cell or region-minus-clubs residual describes fewer than 10 minor athletes, and a retried batch inserts nothing; in Lovable preview a batch is accepted and the Usage page shows it |
| A2 | Tracker and instrumentation | iOS | Contract sync; `AnalyticsTracker` with the disk buffer and flush rules; `.trackedScreen` on every tab root and routed screen; Resources events (open, read time, read depth, share, offline save, search count, Safe Sport, Ask Gradus); ~~Settings → Privacy toggle (AAA, VoiceOver)~~ (built, then removed under #46); privacy manifest `ProductInteraction` / `Analytics`; App Privacy answers updated in `docs/ios/app-store-submission.md` | Simulator against preview: a walk through Resources produces the expected rows with sane durations; ~~toggle off sends nothing~~ a withdrawn account's batch is accepted and discarded (#46); airplane mode buffers and flushes on reconnect; full suite green |

### 10.9 Consent, age assurance and SafeSport (2026-09-24)

Decisions #29–#33; the design is §6.13. Taken after the §10.6 gate, in parallel with the L and A milestones and TestFlight QA. S1 is first; S2 and S3 follow it and can run in parallel; S1–S4 are merged before I16, and S5 is done before submission. Milestone prefix S, since C1/C2 in §10.2 already name the shell milestones.

| # | Milestone | Repo | Scope | Done when |
|---|---|---|---|---|
| S1 | Consent backbone | web | Migrations: the `parent_profiles` verification columns, `guardian_consents`, `athletes.account_state`, `coach_athletes.messaging_paused_at`, `webhook_receipts`, with GRANTs and RLS; the KWS client (token, `send-email`, exponential-backoff retries) and `POST /webhooks/kws` plus the Verification Response channel; `POST /guardian/verification/start`, `GET /guardian/verification/status`, `parentVerified` on `/me`; under-13 refusal and the provisional state in `createSelfManagedAthlete`; the parent-recipient rule in `addAthleteWithGuardian`; the room rule in `ensureRoom*` and `sendMessage`; the mirror retired; gating of invite-code issuance and coach links on verification; the text-only rule for minor senders and their uploads; the pause endpoint; direct-notice copy in the parent invite and KWS emails; the retention cron; the demo seeder marks its parent verified (`admin`); OpenAPI and vectors; the web's verification step and the new states (§4.1) | In Lovable preview against the KWS test environment: a parent verifies with a test card and the webhook flips the row; an under-13 birthdate is refused server-side; a 13–17 sign-up cannot open a room or link a coach until a verified guardian claims; a coach cannot pick a minor as invite recipient; a paused coach cannot send; a minor's voice send and upload are refused; a retried webhook inserts nothing; tests cover each; web guardrails (§2) unchanged |
| S2 | iOS parent and athlete flows | iOS | Contract sync; the "Verify you're an adult" step after account creation in parent onboarding and in the claim flow (send, "check your email", resend, resume on `/verified`, status poll); the provisional and pending states; the birthdate-first athlete entry with the parent-only screen and its session memory; the text-only composer for minors; the roster "waiting for parent" state and the recipient rule; the parent pause control; AAA and VoiceOver checks in the audit harness. *Built 2026-10-03: gradus-ios PR #89; the roster "waiting for parent" row waits on a web wave (the roster DTO has no guardian-claimed field). 2026-10-04: done. The roster DTO carries `claimStatus` (`claimed`, `waitingForParent`, `waitingForAthlete`, `notInvited`), derived to mirror the room rule (web #174), and the roster card shows it on the web and on iOS (gradus-ios #94).* | Simulator against preview: each flow round-trips; the harness passes on every new screen |
| S3 | Apple signals | iOS, web | The Declared Age Range capability and request with the tighten-only rules; the PermissionKit significant-change ask; the StoreKit age-rating watcher; `POST /webhooks/app-store` for `RESCIND_CONSENT` with pause, ledger revocation and both notifications; App Store Server Notifications V2 URL configured; privacy manifest unchanged (no new data types). *Built 2026-10-03: web PR #171 (webhook, `POST /me/app-transaction`, migration `20261003160000_app_store_app_transactions`) and gradus-ios PR #90 (age signals, the significant-change gate, the paused notices). Owed by Mariah: the sandbox device pass (QA §1, §8). Done 2026-10-03: the migration applied, and the App Store Server Notifications V2 URL set for production and sandbox.* | On an iOS 26 device with a Child Account the band routes as §6.13 B1 says and a self-declared adult changes nothing; a sandbox `RESCIND_CONSENT` pauses the athlete and both notifications arrive |
| S4 | SafeSport behaviors and QA | web, iOS | The report contact address and response commitment in the listing copy and the Safe Sport panel; `docs/ios/QA.md` rows for every rule in §6.13; review notes updated; `docs/ios/app-store-submission.md` §5 and §7 updated; the `/support` page on gradus.training (support@gradussports.com plus FAQs), which KWS's go-live review requires (#34), built nearer go-live. *Built 2026-10-03: web PR #172 (`/support`, the "Gradus Support" card in the web Safe Sport panel) and gradus-ios PR #91 (the same card natively); the response commitment "we respond within one business day" is a default for Mariah to confirm (§12 #30); QA rows and the kit in this docs PR.* | The QA rows pass on a device; submission kit matches §6.13; `/support` is live before the KWS production review is requested |
| S5 | Paper | Mariah, counsel | Privacy policy, direct notice, public retention policy, written security program, the App Store age-assurance answer, KWS terms accepted in the Epic developer portal *(done 2026-09-25)*, the production configuration entered (privacy URL, support URL, brand name) and go-live approved. *2026-10-03: decisions #38–#45 taken; `docs/legal/retention-policy.md` and `docs/legal/information-security-program.md` drafted; direct notice in-flow built (web #178 + iOS); dormant and record sweeps built (web `feat/s5-retention-sweeps`). Owed: publish the policy text on both sites, file vendor assurances (#45), set the age-assurance answer to Yes.* | Published; App Store Connect answers match the policy |

### 10.10 Athlete-authored plans (2026-10-03)

Decision #35; design §6.14. One web PR per milestone, off `main`, never bundled with other web work; the iOS PR follows the contract re-sync. Nothing here touches the coach plan modules.

| # | Milestone | Repo | Scope | Done when |
|---|---|---|---|---|
| AP1 | Ownership migration | web | `plans_source_check` gains `'athlete'`; the ownership trigger admits it; athlete INSERT / UPDATE / DELETE policies on `plans` and `plan_moves` for own `source = 'athlete'` rows; `import_shared_plan` athlete branch (copy, `kind = 'plan'`, `athlete_id` = importer, active); `get_shared_plan` author field for "Plan by *first name*" | Migration applied in Lovable; an athlete session can insert and read its own plan through SQL; a coach session cannot touch it |
| AP2 | Athlete authoring API | web | `athlete-authoring.server.ts`; the `/athlete/plans*`, `/athlete/moves`, `/athlete/voice/build-plan` routes (§6.14 B) with idempotency and ETags where the coach twins have them; `GET /plans/{id}` returns `isOwner: true` with library links for the author; `GET /athlete/plans` carries `source`; transcribe-and-discard verified by test (no storage write, no audio in logs); OpenAPI exported | Every route live behind the flag; vectors added; iOS contract re-synced |
| AP3 | iOS authoring | iOS | Athlete paths in `PlansRepository` plus outbox allow-list and mock; own-plan routing to the editor; `PlanDetailModel` authoring mode; "+", voice, "Mine" and the read-only Library segment on the athlete Plans tab; `SharedPlanView` "Add to my plans"; tests for every new branch | Mock walkthrough passes for adult and minor athletes; real pass against preview |
| AP4 | Close-out | iOS, web, docs | AAA pass on the new surfaces; `docs/ios/QA.md` rows; review notes mention athlete-authored plans; this PRD's §7.8 rows checked off | QA rows green on TestFlight |

### 10.11 Apple Watch (2026-10-03)

Decision #36; design §6.15. In the same 1.0 submission, so these land before I16's go/no-go. W1 first (no server change, helps the accessibility gate); W4 waits on AP2. This Mac has the watchOS SDK and the watchOS 27 simulator runtime (confirmed 2026-10-04). QA on Mariah's Apple Watch Series 10.

| # | Milestone | Repo | Scope | Done when |
|---|---|---|---|---|
| W0 | Target and session | iOS, web | `GradusWatch` target in `project.yml`, `FeatureWatch`, watchOS deployment in the shared packages with the five platform guards; `POST /auth/companion`; WatchConnectivity hand-off and revoke; Xcode Cloud builds the watch | A signed-in phone signs the watch in; sign-out on either side signs out both |
| W1 | Plan → audio | iOS | `PlanNarration` in `GradusCore` (full read); the watch player; background audio; plan cache; the iPhone gets "Read this plan aloud" from the same builder | A parent, athlete and coach each hear a full plan through AirPods with the wrist down |
| W2 | Coach briefing and wrap-up | iOS, web | `GET /coach/up-next`; "Up next" screen with tap-to-speak briefing; pending wrap-ups with record → `/voice/build-plan` edit → spoken result → action → `POST /coach/wrap-ups` | A wrap-up recorded on the wrist updates the plan and clears the roster pill on the phone |
| W3 | Coach voice → plan and deploy | iOS | Recorder screen, read-back, drafts list, assign and activate ~~with the spoken conflict~~ (no conflict since #52) | A plan dictated on the wrist is active on the athlete's phone |
| W4 | Athlete voice → plan and deploy | iOS | The same screens on `/athlete/...` (AP2); adult athletes only (#48, withdrawing #37's minors) | An adult athlete builds and activates a plan from the wrist in the mock and on preview; a minor sees Drafts but no "Record a plan" |
| W5 | Sessions | iOS | Timer start / pause / end on the wrist, shared ownership with the phone, the flow-state sheet | A session started on the watch ends on the phone and vice versa, logged once |
| W6 | Close-out | iOS, docs | AAA pass at watch sizes; watch screenshots; App Privacy unchanged (no new collection); `docs/ios/QA.md` rows; review notes | QA rows green on the Series 10 |
| W7 | Watch-face complication (#51, added 2026-10-10) | iOS | `GradusWatchWidgets` extension (circular, corner, rectangular, inline); the coach's next lesson from an App Group snapshot the watch app writes; the mark for everyone else; background refresh; tap opens Up next. **Apple portal first:** register `training.gradus.app.watchkitapp.widgets` with App Groups, and turn on App Groups (`group.training.gradus.app`) for `training.gradus.app.watchkitapp`, before the first Xcode Cloud build | Gradus can be added to a face on the Series 10; a coach's face shows the next lesson and clears on sign-out |

**W0 design notes (2026-10-05).**

- **`POST /auth/companion`** (web, built): authenticated by the phone's bearer token, no body, answers `{accessToken, refreshToken, expiresIn}` for a **second, independent session** of the same account (the same admin magic-link mint the Apple and Google sign-ins use; nothing is emailed). It never takes an email from the request, is limited to 5 per 10 minutes because each call creates a session, and grants nothing the bearer token could not already do. The phone passes the result to the watch over WatchConnectivity (`transferUserInfo`, queued and delivered when the watch is next reachable) and keeps nothing. Role, pause and consent are enforced per route on the watch's requests exactly as on the phone's: it is the same account.
- **Sign-out on either side** is client-driven: the side that signs out ends its own session (the usual GoTrue logout) and tells the other, queued (`transferUserInfo`, no secret in it) and live when it is reachable now; the other side wipes its Keychain session and ends its own, without echoing back. **Limit, stated plainly:** the server cannot end the *other* device's session on its own, because the pairing is not stored and GoTrue has no admin call to end one session by id, so a watch that is away when the phone signs out keeps a live session until it next hears from the phone.
- **Decided 2026-10-05 (Mariah): "C + D" for 1.0.** Keep the client-driven sign-out (C) and add a **lease on the watch** (D): when the watch opens or returns to the foreground it asks the phone "are you still signed in as me?" (`checkIn`, live, no secret). *Alive* renews the lease. *The phone is signed out* ends the watch's session, which covers a queued sign-out that never arrived. *Signed in as another account* replaces the watch's account. *Unreachable* changes nothing. A watch that has not heard from the phone for **14 days** (`WatchLease.defaultDuration`, a product setting) signs itself out locally, without signing the phone out; because that is the watch's own session, it also ends on the server when the watch has a connection. A phone that has not yet read its stored session answers "try later", never "signed out". **Not done for 1.0:** server-side revocation (a `companion_sessions` table plus a `SECURITY DEFINER` function that deletes the paired `auth.sessions` row, called from the phone's sign-out). It is the only option that cuts off a lost watch the moment the phone signs out, and is queued for a point release; a Supabase session time-box was rejected as weak (it applies to every session and needs a Pro plan).
- **No self-replication:** the watch must not call `/auth/companion` itself; the iOS client only exposes it on the phone.

**Messages on the wrist (#54, 2026-10-11).** Not a W milestone: one web PR (the category on message pushes, §6.6) and one gradus-ios PR (the shared category in `GradusCore`, the phone's Reply handler, the watch's notification delegate and the `Messages/` screens in `FeatureWatch`). QA on the Series 10: a real mirrored message notification, tap → the thread, Reply on the notification, Reply in the thread, a quick reply, the voice-note row, and the signed-out watch.

---

## 11. Risks and dependencies

| # | Risk or dependency | Impact | Mitigation |
|---|---|---|---|
| 1 | ~~Apple Developer enrollment slips~~ **Closed 2026-09-19: enrollment approved.** Remaining dependency: App Store Connect setup (App ID, keys, Team ID, Xcode Cloud) | Delays TestFlight, push, Sign in with Apple, and universal-link testing | The §10.6 milestones that need the account are ordered so everything else proceeds meanwhile. |
| 2 | Sign in with Apple through our own broker rather than a Supabase provider | Reviewer questions; token revocation needs the Sign in with Apple key | Standard OIDC verification; generate the key the day enrollment completes; test revocation before submission. If Lovable Cloud later exposes an Apple provider, switch to `signInWithIdToken` with no client change. |
| 3 | Lovable Cloud limits without a Supabase dashboard (Google authorized client IDs, email-confirmation setting, pg_cron access) | Could force the broker path for Google and shape sign-up | Broker path is already the default design; verify settings in Phase 0 week one. |
| 4 | Lovable two-way GitHub sync colliding with Claude Code PRs (backend PRs only; the iOS repo is outside Lovable's sync) | Merge conflicts, accidental publishes | Short-lived branches, rebase before merge, publish deliberately after CI; avoid overlapping edits on the same day (§9.6). |
| 5 | Behavior-preserving refactor accidentally changes web behavior | Web regression | One domain per PR, typecheck and build gates, preview smoke, kill switch, revert-first policy (§4). |
| 6 | Cross-platform voice-note formats | iOS cannot play legacy WebM | WKWebView playback fallback verified in Phase 1; Opus decoder as P1 fallback; web prefers M4A going forward. |
| 7 | Offline conflicts confuse users | Lost or duplicated edits | Idempotency everywhere, append-only design for sessions and messages, last-writer-wins for scalars, visible Sync Center. |
| 8 | App Review pushes back on web-only subscriptions | Rejection or delay | US-only storefront at launch, no purchase CTAs, link-out only in the US, prepared review notes; fallback is removing the link. |
| 9 | Live Activities update budget and entitlement | Stale Dynamic Island | Request frequent-updates entitlement; degrade to foreground updates; 30 s cadence already bounded server-side. |
| 10 | Realtime fan-out on `messages` as the app grows | Supabase Realtime limits | Fine at current scale; move to per-room broadcast from a database trigger if connection counts climb (P2). |
| 11 | Decision latency | Work stalls when a product decision waits | One short review per day; Claude Code verifies on its own and batches decisions into that update. |
| 12 | IJS page structure changes | Board goes stale | Existing server-side risk, unchanged; the app shows data age and degrades visibly. |
| 13 | Founding Coach window closes 2026-11-01, likely before the native launch | New iOS coaches hit the paywall immediately | US link to the web paywall; consider extending the window through the native launch (business decision). |
| 14 | Kotlin rebuild later | Rework if the API is iOS-shaped | OpenAPI as the contract, shared test vectors, platform-neutral string catalog, no iOS-only endpoints. |
| 16 | ~~Capacitor 1.0 rejected under Guideline 4.2~~ **Moot 2026-09-19: the shell does not ship.** | — | — |
| 15 | Leaving Lovable Cloud someday | Auth, DB, storage migration | Out of scope. Lovable now documents an export path ("Export project data" then connect your own Supabase) and third-party migrators preserve auth passwords; the API is the only client that would need re-pointing. Write a runbook before attempting it. |
| 17 | *(2026-09-20)* Rights to quote corpus sources (USFS rulebook is member-gated; SafeSport Code and The Assist's materials carry no stated reuse license) | A source cannot be ingested, or must be linked rather than quoted | `knowledge_sources.rights_basis` is required; §12 #16 owns the confirmations; a source without a basis is listed in the library and cited by title only, never quoted. |
| 18 | *(2026-09-20)* Retrieval quality on rulebooks (tables, numbered clauses) | Confident answers from the wrong clause | Per-source chunkers; the known-answer question set gates L4; answers cite section and page so a coach can check. |
| 19 | *(2026-09-20)* Inferred skill events are wrong | A plan draft targets a skill the athlete has not landed | Inferred events are always "likely", never certain; drafts stay drafts the coach edits; the inference job's precision against coach labels is logged and the rule is switched off if it falls below the bar set in L3. |
| 20 | *(2026-09-20)* Embedding model coupling to the Lovable gateway | A provider switch (§12 #4) silently mixes vector spaces | `embedding_model` recorded per source; the switch re-embeds in the same job; mixed states fail the precheck in `docs/api/SMOKE.md`. |
| 21 | *(2026-09-20)* Minors' data in prompts | More athlete data reaches the model provider | The profile is derived aggregates plus fields the gateway already receives today; no new free text; no third party beyond the existing gateway; covered by the current privacy disclosure (§6.11). |
| 22 | *(2026-09-24)* KWS terms and go-live review | Production verification cannot start until KWS approves the product | Portal setup and terms in S1's first PR; the test environment carries preview and CI; the `admin` method covers demo accounts only and is admin-tool-only. |
| 23 | *(2026-09-24)* Card-check completion: some parents will not complete a card verification for a coaching app | Minors stuck provisional; coaches lose athletes | KWS skips the check for parents already verified in its network; resend from the roster and the athlete's screen; coach↔parent direct rooms work as soon as the parent has an account; completion is measured on the admin Usage page. |
| 24 | *(2026-09-24)* App Review walks the parent flow | Reviewers cannot pass the KWS adult check | The demo parent is seeded verified (#26) and the review note says so. |
| 25 | *(2026-09-24)* Declared Age Range unavailable (iOS 18–25, declined sharing, non-US accounts) | No device signal | The birthdate path stands; the signal only ever tightens. |
| 26 | *(2026-09-24)* Apple's computed rating vs under-13 Child Accounts | A Child Account cannot install a 13+ app without the parent | Ask to Buy now covers free downloads; the listing says a parent installs it; revisit if the computed rating lands above 13+. |
| 27 | *(2026-10-03)* The Apple Watch is on the submission's critical path (#36) | A watch defect or a review question about the watch holds the iPhone release | W1 first and W0–W6 as small additive PRs; a go/no-go at I16 can still cut the watch to the first point release under the same record if Mariah agrees then |
| 28 | *(2026-10-03; closed 2026-10-07 by #48: minors have no voice to plan)* Minor voice to plan (#37) rests on the COPPA audio exception plus existing parental consent | Counsel disagrees, or the policy wording lags the feature | The server never writes audio to storage (tested in AP2); §12 #31 carries the wording; if counsel says no, the fallback is Apple's on-device dictation returning text to a `transcript` input, which Gradus never hears |
| 29 | *(2026-10-03)* watchOS has no speech recognition and no background recording | "Completely in headphones" cannot mean hands-free navigation; a clip needs the screen awake | The §6.15 interaction model (one large button, speak or listen) is the promise; listing copy and screenshots show that, not voice commands |

---

## 12. Open decisions

| # | Decision | Owner | Needed by | Default if undecided |
|---|---|---|---|---|
| 1 | Native release scope | Mariah | — | **Resolved 2026-09-04: full parity in native 2.0** |
| 2 | Pace and staffing | Mariah | — | **Resolved 2026-09-04: milestone-driven, no time estimates; one daytime stream plus overnight backend runs** |
| 3 | Google sign-in: broker in our API vs Lovable Cloud own-credentials with authorized iOS client ID | Claude Code, after checking Lovable Cloud auth settings | Before B2 | Broker |
| 4 | AI provider switch (Lovable gateway → direct Google key) timing | Mariah | Any time | Add behind a flag during B3, flip after the native launch |
| 5 | Coach sign-up email confirmation behavior in Lovable Cloud (on or off) | Verify in Lovable Cloud | Before B2 | Mirror whatever the web does today |
| 6 | Voice-note playback fallback: WKWebView vs bundled Opus decoder | Claude Code, after device verification | During I3 | WKWebView |
| 7 | App Store availability at launch: US only vs worldwide | Mariah | — | **Resolved 2026-09-24: US only** (decision #25) |
| 8 | Extend the Founding Coach window through the native launch | Mariah | Before 2026-11-01 | No change |
| 9 | Desktop use by the three roles after sunset | Mariah | — | **Resolved 2026-09-04: native only** (iOS app on Apple-silicon Macs; Mac build later) |
| 10 | Live Activity for the session timer: local only vs also pushed to guardians' devices | Mariah | During I7 | Local only |
| 11 | Xcode Cloud vs GitHub Actions for TestFlight uploads | Claude Code | During I1 | Xcode Cloud |
| 12 | Whether iPad gets full attention in native 2.0 or "works, not optimized" | Mariah | — | **Resolved 2026-09-24: adaptive one-column layouts in 1.0**, no sidebar or split view (decision #21). **Superseded 2026-10-11: iPhone only in 1.0** (decision #50) |
| 13 | Capacitor iOS shell as interim 1.0 (§10.5) | Mariah | — | **Reversed 2026-09-19: no shell; native ships first as 1.0** |
| 14 | Capacitor Android shell as interim Android app (§10.5) | Mariah | Before the Kotlin decision | **Reopened 2026-09-19:** with no iOS shell there is no "after iOS 1.0 is live" trigger; Mariah decides whether the Android shell ships at all or Android waits for Kotlin |
| 15 | *(2026-09-20)* Which coaching and athlete-development sources join corpus v1 | Mariah | Before L4 | The USOPC American Development Model materials, plus The Assist's Compassionate Coach and Compassionate Parent course materials if licensed; nothing described only as "best practices" without a document behind it |
| 16 | *(2026-09-20)* Rights confirmations for quoting the USFS rulebook, the SafeSport Code and MAAPP, and The Assist's six documents | Mariah | Before Ask Gradus returns to iOS | Ingest only sources with written permission or a public license; the rest are cited by title and linked, not quoted. **Interim 2026-09-24:** Ask Gradus hidden in iOS 1.0 (decision #22) and the iOS library filtered to Gradus-authored or licensed rows (decision #23), so 1.0 ships no third-party content |
| 17 | *(2026-09-20)* Whether and when to start L6, the learned pace model | Mariah, on Claude Code's evidence | After launch, when ≥ 30 athletes have a season of skill events | Not started; the deterministic profile stands in |
| 18 | *(2026-09-20)* Whether athletes or parents ever see their skill history directly | Mariah | Before L2 | Not in 1.0: the coach sees "likely landed" hints in the plan editor; athletes and parents see it only as sharper plans |
| 19 | *(2026-09-22)* Analytics vendor: first-party (own endpoint and table) vs a hosted tool (e.g., PostHog, Amplitude) | Mariah | — | **Resolved 2026-09-22: first-party (in-house).** No SDK; minors' data stays in our database; the admin Usage page is the report |
| 20 | *(2026-09-22)* Whether the web sends the same usage events | Mariah | — | **Resolved 2026-09-22: no.** The web does not send usage events |
| 21 | *(2026-09-22)* Raw analytics event retention | Mariah | — | **Resolved 2026-09-22: 13 months raw**, weekly aggregates kept; counsel confirms the policy §8 wording |
| 22 | *(2026-09-22)* Whether minors' usage (e.g., Safe Sport opens) is ever broken down **per coach** | Mariah, with counsel | Not before a written safeguarding protocol exists | **Not built.** Mariah chose club/region level (§6.12). Per-coach needs counsel review, a written protocol (review trigger, reviewer, the route to the U.S. Center for SafeSport, handling false signals), and policy disclosure first, because small rosters re-identify children and the signal is weak evidence against a coach |
| 23 | *(2026-09-24)* Age-assurance vendor: whether and which third-party provider verifies age | Mariah | — | **Resolved 2026-09-24: KWS Parent Verification for every parent of a minor (decision #29; every KWS method from 2026-10-03, #38), plus Apple's Declared Age Range on device (decision #33).** The App Store age-assurance answer flips to Yes when S1 and S3 ship (§6.13 B5) |
| 24 | *(2026-09-24)* Privacy-policy wording for counsel (photos, providers, personalization, analytics, audio, age assurance) | Mariah with counsel | Before submission | The proposals in `docs/legal/privacy-policy-brief-2026-09-24.md`; *2026-10-11:* the policy and terms are published only on gradussports.com (repo design-friendly-launchpad); this repo's `/privacy` and `/terms` redirect there (web #220, `docs/legal/policy-terms-changes-2026-10-10.md`). *Extended 2026-09-24 (§6.13 D):* KWS as a processor, the COPPA direct notice, the public retention policy, the written security program, text-only messaging for minors, and whether coach voice-note transcription needs its own third-party-disclosure consent. *2026-10-03:* proposals revised (brief, revision section: every KWS method, the SSN qualifier, the retired mirror); retention policy and security program drafted in `docs/legal/`; decisions #39–#45 |
| 25 | *(2026-09-24)* Deletion window for unclaimed provisional accounts and unconsented parent contact details | Mariah with counsel | — | **Resolved 2026-09-24 (Mariah): 3 months from creation**, stated in the direct notice |
| 26 | *(2026-09-24)* PermissionKit ask-a-parent (`CommunicationTopic`) for coach connections on Child Accounts | Mariah | After 1.0 | Not in 1.0; significant-change asks only (§6.13 B2) |
| 27 | *(2026-09-24)* Existing web parents and adult verification | Mariah | — | **Resolved 2026-09-24 (Mariah): left alone.** Parent profiles that exist when S1's migration runs are marked `adult_verification_method = 'legacy'` and are never prompted or gated; verification applies to parent accounts created afterwards |
| 28 | *(2026-10-03)* Existing accounts on a device whose Declared Age Range says under 18 (a coach, parent or adult-athlete profile already exists) | Mariah, with counsel | Before California's DAAA (2027-01-01) | **Not re-gated in 1.0:** S3 tightens only sign-up, on the device. Options: send the band to the server so an adult-flagged athlete gets the minor rules (a new stored data type, privacy manifest and policy change), or block adult profiles on such a device |
| 29 | *(2026-10-03)* Restoring an athlete paused by `RESCIND_CONSENT` | Mariah | Before the first real rescind | **Admin only, on request to support@gradussports.com.** Apple sends no "consent restored" event. *2026-10-03:* web Admin → Membership → **Paused athletes** lists them and restores one at a time with a support-request note: it exempts that athlete, and only that athlete, from the stored withdrawal of their download (so the weekly re-report doesn't pause them again; the withdrawal still applies to siblings and later sign-ups on that download, and a newer `RESCIND_CONSENT` pauses them again), records fresh consent from the parent on file (method `admin`; refused while verification is required and the parent hasn't verified), logs the restore with the note, and returns the account to `active` when a parent is on file, otherwise to the state it had when paused (recorded at the pause; for older pauses, `active` for a known adult, else `provisional` only for accounts created after S1 reached production, so the unclaimed-account sweep never takes an old account). The list flags a withdrawal newer than the pause, and a restore is refused if Apple withdrew again after the admin looked or while it ran. No migration: the records live in `webhook_receipts` |
| 30 | *(2026-10-03)* The response commitment for reports (Guideline 1.2) | Mariah | Before submission | **"We respond within one business day"** (S4 default), shown on `/support`, in both Safe Sport panels and in the listing. Every report already emails the team at once and minor-safety reports are flagged urgent; the commitment is the reply time |
| 31 | *(2026-10-03; not needed since #48, 2026-10-07: no audio is collected from athletes under 18)* Privacy-policy and direct-notice sentence for minor voice→plan under the audio exception (#37) | Mariah with counsel | Before AP2 ships to production | Extends §12 #24: "a child's voice clip used to build their own practice plan is transcribed and deleted immediately; only the words are kept"; the processor named is the transcription provider already in the policy |
| 32 | *(2026-10-03)* Public share page attribution for athlete authors: first name only, or full name as for coaches | Mariah | Before AP1 | **First name only** |
| 33 | *(2026-10-03)* Whether an athlete's own active plans are capped | Mariah | Before AP2 | **No cap** (the two-plan rule was per coach pairing, #35; since #52 there is no cap for coaches either) |
| 34 | *(2026-10-03)* Dormant **adult** athlete accounts and accounts with **no birthdate**: the three-year sweep covers athletes whose birthdate makes them under 18 (#41) | Mariah | Before the first annual review (2026-11-01) | **Adults resolved 2026-10-11 (Mariah): kept until the owner deletes them**, active or not (coaches, parents, athletes 18+; policy §7 says so, web #220 / design-friendly-launchpad#2). **No-birthdate accounts resolved 2026-10-11 (Mariah): kept the same way, until the account is deleted** (a small number of coach-added accounts from the PWA prototype); the three-year rule stays under-18 only. **Closed.** |
| 35 | *(2026-10-06)* A custom cloud narration voice for read-aloud (for example ElevenLabs, a voice described as a woman from Michigan), after 1.0 | Mariah | Before the first point release that wants it | **Not in 1.0** (#47). If taken: plan text goes to the vendor (privacy-policy line and counsel check, minors included), audio generated once per plan version and stored with a retention rule, per-character cost, on-device voice as the offline fallback |
| 36 | *(2026-10-18)* Build the coach's **Today** widget from data the app already has, instead of fetching it again | Claude Code; Mariah picks the moment | After 1.0, or sooner if launch still feels slow with the two-hour rule (#57) | **Parked, by Mariah.** *Why it's worth doing:* the Roster screen already loads everything the widget shows: each athlete's lesson slots with their cancellations and reschedules (`CoachRoster.athletes[].slots[].overrides`) and this week's practice minutes and targets (`GET /coach/roster/practice-summaries`). Today the app runs a second loader (`CoachTodayLoader`) that asks the server for the same facts a different way, 8 `GET /coach/up-next` calls plus one per student plus one per active plan, which is what caused the build 98 slowdown. Building the widget's snapshot after each roster load would cost **zero extra requests** and make the widget current the moment the roster is, which also removes the two-hour staleness #57 accepted. *Why it was parked:* it's a structural change to how the snapshot is built, with its own tests (recurrence cadences, overrides, "a student appears once at their next lesson"), and the two-hour rule already takes the load off; it wasn't worth risking before the submission build. The widget extension's own fallback fetch (when the stored snapshot is over two hours old) stays either way. |
| 37 | *(2026-10-18)* Server side of the same incident: the `GET /coach/up-next` rate limiter doesn't count concurrent requests, and the route returned HTTP 500s in groups under load | Claude Code (web repo); Mariah applies the migration in Lovable | After 1.0; before any load that looks like build 98 again | **Parked, by Mariah.** *What was found:* the route allows 30 calls a minute per user, but the limiter (`src/lib/api/rate-limit.ts`) reads the count and then writes count + 1 as two separate steps, so eight requests arriving together all read the same number and the limiter undercounts; that's why the phone saw 500s and never a 429. The fix is one atomic Postgres step (`INSERT … ON CONFLICT … DO UPDATE … RETURNING`, called as an RPC), a migration Mariah applies through Lovable, with the same fail-open behavior if the function is missing. *What wasn't found:* why 6–8 up-next calls at once each took 10–13 s and then failed with 500 (each call is about six database round-trips plus two for the limiter; candidates are the Supabase connection pool per Worker, a statement timeout, or a client fetch timeout). It needs the Cloudflare and Supabase logs from 2026-10-18 12:42–12:50 MDT, which this repo can't see. *Why it was parked:* with the iOS bursts gone (#57) the route is under a fraction of the load, and the limiter undercounting only matters under bursts; neither blocks the submission. |

---

## Appendix A — Server function → API v1 endpoint map

Every user-facing `createServerFn` and its `/api/v1` counterpart. Admin, org-admin, email, impersonation, dev, and Turnstile functions are intentionally absent. "Pri" is the client priority from §7; the endpoint itself is built in Phase 0 regardless, since wrapping is cheap and Kotlin will need it. `[pub]` = no auth. `[idem]` = accepts `Idempotency-Key`. `[etag]` = supports `If-None-Match`. `[page]` = cursor pagination.

### Auth and session (new; no web equivalent)

| Endpoint | Source | Pri |
|---|---|---|
| `POST /auth/apple` `[pub]` | new (Apple JWKS verify → identity → session mint) | P0 |
| `POST /auth/google` `[pub]` | new | P0 |
| `POST /auth/password` `[pub]` | new; uses `resolveAthleteLogin` logic for usernames | P0 |
| `POST /auth/signup/coach` `[pub]` | new; mirrors web `supabase.auth.signUp` | P0 |
| `POST /auth/recover` `[pub]` | new; `resetPasswordForEmail` with admin credentials | P0 |
| `POST /auth/username/resolve` `[pub]` | `resolveAthleteLogin` | P0 |
| `POST /auth/username/check` `[pub]` | `checkAthleteUsername` | P0 |
| `GET /me` `[etag]` | composite: `getMyRole`, `getCoachProfile` / `getParentSettings` (summary) / `getAthleteSettings`, `getTermsStatus`, `getMyGuardianStatus`, `getUnreadTotal`, `getTeamPlanStatus`, flags | P0 |
| `GET /me/terms` · `POST /me/terms/accept` | `getTermsStatus`, `acceptTerms` | P0 |
| `POST /me/presence` | `touchLastSeen` | P0 |
| `GET /me/deletion-impact` · `DELETE /me` | `getDeletionImpact`, `deleteMyAccount` (+ Apple revoke) | P0 |
| `POST /me/promo-code` · `POST /promo-codes/validate` | `applyPromoCodeToMyProfile`, `validatePromoCode` | P0 |
| `GET /me/celebrations` · `POST /me/celebrations/{id}/ack` | `getPendingConnectionCelebrations`, `acknowledgeConnection` | P1 |
| `POST /devices` · `DELETE /devices/{token}` | `registerDeviceToken`, `unregisterDeviceToken` | P0 |
| `POST /live-activities/tokens` | new | P0 |
| `POST /auth/companion` *(2026-10-03, §6.15)* | new; `mintSessionForEmail` for the paired watch, handed over by WatchConnectivity | P0 |
| `POST /errors` | `reportClientError` | P0 |
| `POST /feedback` | `submitFeedback` (`listFeedback`, `setFeedbackResolved` are admin) | P0 |
| `GET /meta/config` `[pub]` · `GET /meta/client-policy` `[pub]` | new (env flags: paywall, Coach Pro, Founding cutoff, min client version) | P0 |

### Invites and connections

| Endpoint | Source | Pri |
|---|---|---|
| `POST /invites/resolve` `[pub]` | `resolveInviteCode` | P0 |
| `GET /coach/invite-code` · `POST /coach/invite-code/rotate` | `getCoachInviteCode`, `rotateCoachInviteCode` | P0 |
| `POST /invites/coach/lookup` `[pub]` | `getCoachByInviteCode`, `previewCoachByInviteCode` | P0 |
| `GET /parent/invite-code` · `GET /parent/athletes/invite-codes` | `getOrCreateParentInviteCode`, `listAthletesWithInviteCodes` | P0 |
| `POST /invites/parent/lookup` `[pub]` · `POST /invites/parent/claim` | `getParentByInviteCode`, `claimParentInvite` | P0 |
| `GET /athlete/invite-code` · `POST /invites/adult-athlete/lookup` `[pub]` · `POST /invites/adult-athlete/claim` | `getOrCreateAdultAthleteInviteCode`, `getAdultAthleteByInviteCode`, `claimAdultAthleteInvite` | P0 |
| `POST /guardian/claim/summary` `[pub]` · `GET /guardian/claim/context` · `POST /guardian/claim` · `POST /guardian/claim/merge-options` · `POST /guardian/claim/merge` · `POST /guardian/claim/self` · `POST /guardian/invites/{id}/resend` · `GET /guardian/status` | `getGuardianClaimSummary`, `getGuardianClaimContext`, `claimGuardianAthlete`, `getGuardianClaimMergeOptions`, `mergeGuardianClaim`, `claimAthleteSelf`, `resendGuardianInvite`, `getMyGuardianStatus` | P1 |
| `POST /guardian/verification/start` · `GET /guardian/verification/status` *(new, 2026-09-24)* | new: KWS `send-email` for the signed-in parent (60 s resend cooldown, 6/hour); verification state incl. `required` (the `PARENT_VERIFICATION_REQUIRED` switch) and `available` (KWS configured) (§6.13 A1–A2) | P0 |
| `GET /parent/team/guardians` · `POST /parent/team/guardians/invites` · `DELETE /parent/team/guardians/invites/{id}` · `DELETE /parent/team/guardians/{id}` · `POST /team-invites/preview` `[pub]` · `POST /team-invites/claim` | `listTeamGuardians`, `inviteGuardian`, `revokeGuardianInvite`, `removeGuardian`, `previewGuardianInvite`, `claimGuardianInvite` | P1 |
| `GET /coach/visibility` · `PUT /coach/visibility` · `GET /coach/visibility/mine` · `POST /coach/visibility/{id}/respond` · `DELETE /coach/visibility/{id}` | `listCoachVisibility`, `setCoachVisibility`, `listMyCoachVisibility`, `respondToCoachVisibility`, `disconnectCoachVisibility` | P1 |
| `GET /coach/athletes/{id}/other-plan` | `getOtherCoachPlanForMessage` | P0 |

### Consent webhooks (new, 2026-09-24)

| Endpoint | Source | Pri |
|---|---|---|
| `POST /api/public/webhooks/kws` (outside the `/api/v1` kill switch) · `POST /guardian/verification/complete` `[pub]` | new: KWS `parent-verified` (HMAC over `timestamp.rawBody`, idempotent on transaction id, `webhook_receipts`), and the Verification Response: KWS's signed redirect to `/verified` (`status`, `externalPayload`, `signature` query; HMAC over `status:externalPayload`), which the web page and the iOS app forward to `complete` (§6.13 A2) | P0 |
| `POST /api/public/webhooks/app-store` (outside the `/api/v1` kill switch) | new: App Store Server Notifications V2, signed JWS verified against Apple Root CA - G3; `RESCIND_CONSENT` pauses every athlete bound to the download, revokes ledger scopes, pushes the parent and linked coaches; other types acknowledged and ignored; idempotent on `notificationUUID` (§6.13 B4) | P0 |
| `POST /me/app-transaction` | new: an athlete session's signed `AppTransaction` (StoreKit's JWS), verified against Apple and bound in `app_store_app_transactions`; `bound: false` for coaches, parents, other bundles and Xcode builds; 422 `invalid_app_transaction` when it does not verify (§6.13 B4) | P0 |

### Sign-up and onboarding

| Endpoint | Source | Pri |
|---|---|---|
| `GET /coach/profile` · `PUT /coach/profile` · `PUT /coach/levels` · `POST /coach/onboarding/complete` | `getCoachProfile`, `saveCoachProfile`, `saveCoachLevels`, `completeOnboarding` | P0 |
| `POST /orgs/search` · `GET /orgs/popular` · `POST /orgs/lookup-code` · `POST /orgs/verify-code` · `POST /orgs/join` · `POST /orgs/claim-code` · `DELETE /coach/org` · `POST /orgs/lead` · `POST /org-invites/resolve` · `POST /org-invites/accept` | `searchOrganizations`, `getPopularOrganizations`, `getOrganizationByInviteCode`, `verifyOrgCodeForOrg`, `joinOrganization`, `claimOrganizationInviteCode`, `clearOrganizationLink`, `recordSilentClubLead`, `resolveOrgCoachInvite`, `acceptOrgCoachInvite` (`listOrganizations`, `createOrganization`, `updateOrganization`, `rotate/setOrganizationInviteCode`, `getOrganizationStats` are admin) | P0 basic / P1 full |
| `POST /signup/parent/validate-code` `[pub]` · `POST /signup/parent/start` · `GET /signup/parent/status` · `POST /signup/parent/athletes-for-code` · `POST /signup/parent/link-coach` · `POST /signup/parent/goals` · `POST /signup/parent/schedule` | `validateSignupCode`, `startParentSignup`, `getParentSignupStatus`, `listAthletesForCode`, `linkAthletesToCoach`, `saveAthleteGoals`, `saveAthleteSchedule` | P0 |
| `POST /signup/athlete/invite-summary` `[pub]` · `POST /signup/athlete/claim` · `POST /signup/athlete/username` `[pub]` · `GET /athlete/me` | `getAthleteInviteSummary`, `claimAthleteInvite`, `signupAthleteWithUsername`, `getMyAthlete` | P0 |
| `POST /signup/adult-athlete` · `POST /adult-athlete/coach/preview` · `POST /adult-athlete/coach/link` · `GET /adult-athlete/onboarding` · `PUT /adult-athlete/goals` · `GET /adult-athlete/coaches` · `DELETE /adult-athlete/coaches/{id}` · `PUT /adult-athlete/coaches/{id}/sports` · `POST /adult-athlete/coach/sports-offered` · `GET /adult-athlete/schedules` · `PUT /adult-athlete/schedules/{coachId}` | `createSelfManagedAthlete`, `previewCoachForAdultAthlete`, `linkAdultAthleteToCoach`, `getAdultOnboardingStatus`, `saveAdultAthleteGoals`, `listAdultAthleteCoaches`, `unlinkAdultAthleteFromCoach`, `updateAdultAthleteCoachSports`, `getCoachOfferedSportsForAdult`, `getAdultAthleteSchedules`, `saveAdultAthleteScheduleForCoach` | P0 |
| `POST /coach/starter-plans/adopt` | `adoptStarterPlan` | P1 |

### Coach roster and schedule

| Endpoint | Source | Pri |
|---|---|---|
| `GET /coach/roster` `[etag]` · `GET /coach/home?week=` (composite) | `getCoachRoster` (+ `getRosterPracticeSummaries`, `getPendingLessonWrapUps`, `getCoachPostEventItems`) | P0 |
| `GET /coach/roster/practice-summaries?from&to` | `getRosterPracticeSummaries` | P0 |
| `POST /coach/roster/athletes` · `DELETE /coach/roster/athletes/{athleteId}` | `addAthleteWithGuardian`, `removeAthleteFromRoster` | P0 |
| `POST /coach/lesson-slots` `[idem]` · `PATCH /coach/lesson-slots/{id}` · `DELETE /coach/lesson-slots/{id}` · `POST /coach/lesson-slots/{id}/occurrences/{date}/cancel` · `POST .../reschedule` · `DELETE .../override` | `addLessonSlot`, `updateLessonSlot`, `deleteLessonSlot`, `cancelLessonOccurrence`, `rescheduleLessonOccurrence`, `clearLessonOverride` | P0 |
| `GET /coach/athletes/{id}` · `GET /coach/athletes/{id}/ai-summary?refresh` | `getCoachAthleteDetail`, `getCoachAthleteAiSummary` | P0 |
| `PUT /coach/athletes/{id}/practice-target` · `DELETE ...` | `setPracticeTarget`, `clearPracticeTarget` | P0 |
| `GET /coach/athletes/{id}/briefing?date&refresh` | `getPreLessonBriefing` | P0 |
| `GET /coach/wrap-ups/pending` · `POST /coach/wrap-ups` `[idem]` | `getPendingLessonWrapUps`, `recordLessonWrapUp` | P0 |
| `POST /coach/schedule-import/parse` (multipart) · `POST /coach/schedule-import/commit` `[idem]` | `parseScheduleImage`, `commitScheduleImport` | P1 |
| `GET /coach/athletes` · `GET /coach/sports` | `listCoachAthletes`, `listCoachSports` | P0 |

### Plans, moves, sessions, voice

| Endpoint | Source | Pri |
|---|---|---|
| `GET /coach/plans?status&athleteId&sport` `[etag]` · `POST /coach/plans` `[idem]` | `listPlans`, `createPlan` | P0 |
| `GET /plans/{id}` (role-aware) · `PUT /plans/{id}` · `PATCH /plans/{id}` · `POST /plans/{id}/status` (*2026-09-20:* optional `reason`: `landed` / `parked` / `dropped`) · `DELETE /plans/{id}` | `getPlan` / `getParentPlan` / `getAthletePlan`, `savePlan`, `updatePlan`, `setPlanStatus`, `deletePlan` | P0 |
| `POST /plans/{id}/moves` · `POST /plans/{id}/moves/from-library` · `PATCH /plans/{id}/moves/{moveId}` · `DELETE ...` (*2026-09-20:* optional `reason`, same values) · `PUT /plans/{id}/moves/order` | `addMoveToPlan`, `addLibraryMovesToPlan`, `updatePlanMove`, `removePlanMove`, `reorderPlanMoves` | P0 |
| `GET /coach/athletes/{id}/active-plans` | `getAthleteActivePlans` | P0 |
| `GET /coach/moves` `[etag]` · `PUT /coach/moves` · `POST /coach/moves/{id}/archive` · `POST /coach/moves/from-plan-move` · `POST /coach/moves/{id}/update-from-plan-move` · `POST /coach/moves/fork-from-plan-move` · `POST /coach/moves/draft` (*2026-10-11, #53:* AI, rate-limited, writes nothing) | `listMoves`, `upsertMove`, `archiveMove`, `addPlanMoveToLibrary`, `updateLibraryMoveFromPlanMove`, `forkPlanMoveToLibrary`, `draftMove` | P0 |
| `GET /parent/plans?status&coachId&sport` `[etag]` · `GET /athlete/plans` `[etag]` | `listParentPlans`, `listAthletePlans` | P0 |
| `GET /plans/{id}/sessions` `[page]` · `POST /plans/{id}/sessions` `[idem]` · `GET /plans/{id}/sessions/summary` | `getPlanSessions` + `listPlanSessions`, `submitPlanSession` / `submitAthletePlanSession` (by role), `getPlanSessionsSummary` | P0 |
| `POST /voice/transcribe` (multipart) · `POST /voice/build-plan` | `voiceTranscribe`, `voiceBuildPlan` | P0 |
| `POST /plans/{id}/share-token` · `GET /public/plans/{token}` `[pub]` · `POST /plans/import/{token}` | `getOrCreateShareToken`, `getSharedPlanPublic`, `importSharedPlan` | P1 |

### Athlete-authored plans (new, 2026-10-03; §6.14)

Parallel to the coach routes above; the coach modules are untouched. `[idem]` and `[etag]` where the coach twin has them.

| Endpoint | Source | Pri |
|---|---|---|
| `POST /athlete/plans` `[idem]` · `PATCH /athlete/plans/{id}` · `DELETE /athlete/plans/{id}` · `POST /athlete/plans/{id}/status` | new `athlete-authoring.server.ts` (own plans only, `source = 'athlete'`) | P0 |
| `POST /athlete/plans/{id}/moves/from-library` · `PATCH /athlete/plans/{id}/moves/{moveId}` · `DELETE ...` · `PUT /athlete/plans/{id}/moves/order` | new | P0 |
| `GET /athlete/moves` `[etag]` | new; read-only `seed_moves` for the athlete's sports | P0 |
| `POST /athlete/voice/build-plan` (multipart; create and edit) | new; transcribe and discard (#37); adult athletes only, 403 `text_only` under 18 (#48) | P0 |
| `GET /plans/{id}` (author: `isOwner: true`, any status, `coach: null`, `source`, `authorFirstName`) · `GET /athlete/plans` (`source` on each row, plus `drafts`) · `GET /public/plans/{token}` (`authorKind`, `authorFirstName`) · `GET /coach/athletes/{id}` (plans carry `source`, `authorFirstName`) · `POST /plans/import/{token}` (athlete branch: copy, active; migration AP1) | amended | P0 |
| `GET /coach/up-next` *(watch, §6.15)* | **built (W2)**: today's lessons that have not ended, soonest first (default 3, `?limit` to 20; the watch asks 10, the coach's Today widget 20): athlete name, start and end minute, `minutesUntilStart` (negative once started), `inProgress`, `briefingCached` (a `pre_lesson_briefings` row exists; the briefing call may still regenerate), `activePlanId`. The client sends its local `?lessonDate&dayOfWeek&currentMinute` like `/coach/wrap-ups/pending`; recurrence and canceled/rescheduled overrides use the same helpers as the lesson reminders. Rate-limited 30/min per user; the coach's Today widget asks for it at most every two hours, three days in flight at a time (#57); the limiter's concurrency gap and the grouped 500s are parked in §12 #37 | P0 |

### Messaging and safety

| Endpoint | Source | Pri |
|---|---|---|
| `GET /rooms` `[etag]` · `GET /rooms/{id}` `[page]` · `POST /rooms/{id}/messages` `[idem]` · `POST /rooms/{id}/read` · `GET /messages/unread-total` · `GET /rooms/{id}/active-plans` · `GET /message-targets` · `POST /rooms/ensure` (discriminated body) | `listMyRooms`, `getRoom`, `sendMessage`, `markRoomRead`, `getUnreadTotal`, `getRoomActivePlans`, `listMyMessageTargets`, `ensureRoom` / `ensureRoomForAthlete` / `ensureDirectRoom` / `ensureRoomForTarget` | P0 |
| voice-note upload | direct to Storage `voice-notes/{roomId}/{uuid}.m4a` (RLS) | P0 |
| `POST /safety/blocks` · `DELETE /safety/blocks/{userId}` · `GET /safety/blocks` · `POST /safety/reports` `[idem]` | `blockUser`, `unblockUser`, `listMyBlocks`, `submitReport` (`adminListReports`, `adminUpdateReportStatus` are admin) | P0 |

### Parent and athlete settings

| Endpoint | Source | Pri |
|---|---|---|
| `GET /parent/settings` `[etag]` · `PATCH /parent/profile` · `POST /parent/athletes` · `PATCH /parent/athletes/{id}` · `DELETE /parent/athletes/{id}` · `PUT /parent/athletes/{id}/goals` · `POST /parent/athletes/{id}/reset-password` · `POST /parent/athletes/{id}/coaches` · `DELETE /parent/athletes/{id}/coaches/{coachId}` · `PUT .../coaches/{coachId}/sports` · `PUT /parent/athletes/{id}/primary-coach` · `PUT /parent/athletes/{id}/schedule` | `getParentSettings`, `updateParentProfile`, `addAthlete`, `updateAthlete`, `removeAthlete`, `updateAthleteGoals`, `resetAthletePassword`, `linkAthleteToCoach`, `unlinkAthleteFromCoach`, `updateCoachAthleteSports`, `setPrimaryCoach`, `replaceAthleteSchedule` | P0 *2026-09-24:* plus `PUT /parent/athletes/{id}/coaches/{coachId}/messaging` (pause and resume, §6.13 C); `addAthlete` and `linkAthleteToCoach` refuse for an unverified parent (`parent_unverified`, 403) |
| `GET /parent/goals` | `getParentGoalsDashboard` | P0 |
| `GET /parent/team` | `getTeamPlanStatus` | P0 (display) |
| `GET /athlete/settings` · `PATCH /athlete/me` · `GET /athlete/goals` · `PUT /athlete/goals/long-term` · `PUT /athlete/goals/motivation` | `getAthleteSettings`, `updateAthleteSelf`, `getAthleteGoalsDashboard`, `updateAthleteLongTermGoal`, `updateAthleteMotivation` | P0 |

### Resources and Ask Gradus

| Endpoint | Source | Pri |
|---|---|---|
| `GET /resources` (role-aware) · `POST /resources/{id}/signed-url` · `POST /coach/resources` · `POST /coach/resources/upload-url` · `DELETE /coach/resources/{id}` | `getParentResources` / `getAthleteResources` / `listCoachResources`, `getResourceSignedUrl`, `createCoachResource`, `createCoachResourceUploadUrl`, `deleteCoachResource` | P1 |
| `POST /ask` (*2026-09-20:* response adds `grounded` and `sources[]`) · `GET /saved-answers` · `POST /saved-answers` · `DELETE /saved-answers/{id}` | `askGradus`, `listSavedAnswers`, `saveAnswer`, `deleteSavedAnswer` | P1 |

### Live Board and competitions

| Endpoint | Source | Pri |
|---|---|---|
| `GET /public/boards` `[pub]` · `GET /public/boards/{slug}` `[pub][etag]` · `GET /boards/my-skaters` | `listBoards`, `getBoard`, `getMySkaterNames` | P0 |
| `PUT /boards/{slug}/follows` · `DELETE /boards/{slug}/follows/{name}` | new (`board_follows`) | P0 |
| `POST /competitions/{id}/attendance` | `recordCompetitionAttendance` | P0 |
| `GET /recaps/pending` · `POST /recaps/{id}/dismiss` · `GET /recaps/coaches?athleteId` · `POST /recaps` `[idem]` · `GET /athletes/{id}/recaps` | `getPendingCompetitionRecap`, `dismissCompetitionRecap`, `getRecapCoaches`, `submitCompetitionRecap`, `getAthleteCompetitionRecaps` | P1 |
| `GET /competitions/finished` · `POST /competitions/{id}/skater-matches` · `POST /athletes/{id}/competition-links` · `DELETE /athletes/{id}/competition-links/{linkId}` · `GET /athletes/{id}/competition-results` · `POST /athletes/{id}/competition-results/{resultId}/generate-plan` · `GET /coach/post-event` · `POST /coach/post-event/{id}/dismiss` · `GET /coach/competitions/{id}/roster` | `listFinishedCompetitions`, `listSkaterMatches`, `linkAthleteToSkater`, `unlinkAthleteCompetition`, `getAthleteCompetitionResults`, `generatePlanFromResults`, `getCoachPostEventItems`, `dismissCoachPostEvent`, `listCoachRosterForCompetition` | P1 |

### Billing and invoicing

| Endpoint | Source | Pri |
|---|---|---|
| `GET /coach/billing` (entitlement summary) | derived from `getCoachProfile` | P0 |
| `POST /coach/founding/claim` · `POST /coach/founding/restore` | `claimFoundingCoachTier`, `restoreFoundingCoachTier` | P1 |
| — (web only) | `startCoachCheckout`, `createCoachBillingPortalSession`, `changeCoachSubscription`, `verifyCheckoutSession`, `startTeamCheckout`, `createParentBillingPortalSession` | never |
| `PUT /coach/athletes/{id}/rate` · `GET /coach/invoices` `[page]` · `GET /coach/athletes/{id}/billing` · `GET /coach/invoices/{id}` · `POST /coach/invoices/preview` · `POST /coach/invoices` `[idem]` · `PATCH /coach/invoices/{id}/status` · `DELETE /coach/invoices/{id}` | `setAthleteRate`, `getCoachInvoices`, `getAthleteBilling`, `getInvoiceDetail`, `previewInvoice`, `createInvoice`, `setInvoiceStatus`, `deleteInvoice` | P1 |

---

## Appendix B — Tables by domain and what iOS caches

| Domain | Tables | Cached on iOS |
|---|---|---|
| Identity and roles | `coach_profiles`, `parent_profiles`, `athletes`, `user_roles`, `org_admins`, `admin_allowlist`, `terms_acceptances`, `soft_deleted_users`, `deleted_accounts`, new `auth_identities`, new `guardian_consents` (2026-09-24); `parent_profiles.adult_verified_at` / `adult_verification_method` / `adult_verification_ref` and `athletes.account_state` (2026-09-24) | Own profile summary via `/me`, including `parentVerified` and the athlete state |
| Connections and invites | `coach_athletes`, `coach_athlete_sports`, `athlete_primary_coaches`, `athlete_guardians`, `guardian_invites`, `coach_invite_codes`, `parent_invite_codes`, `athlete_invite_codes`, `adult_athlete_invite_codes`, `invite_lookup_attempts`, `athlete_coach_visibility`, `coach_visibility_links`; `coach_athletes.messaging_paused_at` (2026-09-24) | Roster and coach lists (derived DTOs) |
| Organizations | `organizations`, `organization_invite_codes`, `organization_leads`, `org_coach_invites`, `org_admin_actions` | Own org name only |
| Schedule | `athlete_lesson_slots`, `lesson_slot_overrides`, `lesson_wrap_ups`, `coach_athlete_practice_targets`, `pre_lesson_briefings` | Slots and overrides for ±8 weeks; briefings as fetched |
| Plans | `plans` (*2026-10-03:* `source = 'athlete'` rows), `plan_moves`, `moves`, `seed_moves` (read by athletes from 2026-10-03), `plan_sessions`, `athlete_goals`, new `athlete_skill_events`, new `athlete_goals_history` (PR #129) | All own plans and moves; sessions for opened plans; skill events and goals history are read only through the profile, not cached |
| Messaging | `message_rooms`, `direct_rooms`, `messages`, `message_reads`, `user_blocks`, `user_reports` | Rooms; newest 200 messages per room; blocks |
| Resources and AI | `resources`, `resource_sports`, `parent_saved_answers`, new `knowledge_sources`, new `knowledge_chunks` | Lists; downloaded PDFs; saved answers with their sources; knowledge tables are server-only |
| Competitions | `competitions`, `competition_snapshots`, `competition_attendance`, `competition_recaps`, `athlete_competition_results`, `athlete_competition_skaters`, new `board_follows`, new `live_activity_tokens` | Board history and follows; last snapshot per visited board |
| Billing | `billing_events`, `coach_athlete_rates`, `invoices`, `invoice_lines`, `promo_codes`, `user_applied_promo_codes` | Entitlement summary; invoices for opened athletes |
| Platform | `device_tokens`, `client_errors`, `error_group_explanations`, `feedback`, `impersonation_events`, new `api_idempotency_keys`, new `webhook_receipts` (2026-09-24) | Nothing |
| Email (server only) | `email_send_log`, `email_send_state`, `email_template_overrides`, `email_template_override_history`, `email_unsubscribe_tokens`, `lifecycle_email_jobs`, `suppressed_emails` | Nothing |
| Usage analytics *(2026-09-22, §6.12)* | new `analytics_events` | Unsent events only, in the per-user buffer (≤ 1,000, ≤ 7 days) |

---

## Appendix C — Web route → iOS screen

Size: S < 200 lines, M 200–500, L 500–1000, XL > 1000 lines of TSX in the web route (components excluded).

| Web route | iOS screen (module) | Size | Pri |
|---|---|---|---|
| `/` (role picker / redirect) | Launch router → role home | S | P0 |
| `/login`, `/forgot-password`, `/reset-password` | `SignInView`, `ForgotPasswordView` (FeatureAuth) | M | P0 |
| `/signup/coach` | `CoachSignUpView` | M | P0 |
| `/signup/parent`, `/signup/parent/athletes`, `/goals`, `/schedule` | `ParentSignUpFlow` (4 steps) | L total | P0 |
| `/signup/athlete`, `/confirm`, `/account`, `/signup/athlete/adult` | `AthleteSignUpFlow`, `AdultAthleteSignUpView` | M | P0 |
| `/i/:code` | `InviteEntryView` | M | P0 |
| `/g/:token`, `/team/:token` | `GuardianClaimFlow`, `TeamInviteView` | M | P1 |
| `/p/:token` | `SharedPlanView` (*2026-10-03:* athletes get "Add to my plans") | M | P1 |
| `/coach` (redirect), `/coach/onboarding` | `CoachOnboardingFlow` | M | P0 |
| `/coach/roster` (+ `week-schedule-view`, `lesson-slot-sheet`, `athlete-detail-sheet`, `roster-card`, `schedule-import-sheet`) | `RosterView`, `WeekScheduleView`, `LessonSlotEditor`, `AthleteDetailView`, `ScheduleImportFlow` (FeatureRoster) | M route + 3.5k components | P0 (import P1) |
| `/coach/plans`, `/coach/plans/:planId` (+ `move-sheet`, `move-field`, `voice-fab`) | `PlansListView`, `PlanDetailView`, `PlanEditor`, `MoveLibraryView`, `VoiceCaptureView` (FeaturePlans, FeatureVoice) | XL | P0 |
| `/coach/messages`, `/coach/messages/:roomId` (shared with parent and athlete) | `RoomsListView`, `RoomView`, `NewConversationView` (FeatureMessages) | M + 1k components | P0 |
| `/coach/resources` | `ResourcesView` (coach variant with upload) | M | P1 |
| `/coach/settings`, `/coach/settings/account` | `SettingsView` (coach), `AccountSecurityView` | L | P0 |
| `/coach/paywall` | **Web only**; app shows `PlanStatusView` | XL (web) | — |
| `/parent` (redirect), `/parent/plans`, `/parent/plans/:planId` | `RunnerPlansView`, `RunnerPlanDetailView`, `SessionTimerView`, `SessionFeedbackSheet` (FeatureSessions) | M | P0 |
| `/parent/settings`, `/parent/settings/account` | `SettingsView` (parent) with athlete, coach, goals, schedule editors | XL | P0 (team P1) |
| `/parent/team` | `TeamPlanView` (guardians; billing link) | M | P1 |
| `/parent/resources` | `ResourcesView`, `AskGradusView`, `SavedAnswersView` | M | P1 |
| `/athlete` (redirect), `/athlete/onboarding` | `AthleteOnboardingFlow` | L | P0 |
| `/athlete/plans`, `/athlete/plans/:planId` | shared runner views + `MotivationCard`; *2026-10-03:* own plans open `PlanDetailView` in authoring mode, plus the read-only Library segment | M | P0 |
| `/athlete/settings`, `/athlete/settings/account` | `SettingsView` (athlete) | L | P0 |
| `/athlete/resources` | `SafeSportPanel` (P0), `AskGradusView` (P1) | M | P0 / P1 |
| `/board`, `/board/:slug` (+ 14 board components) | `BoardIndexView`, `BoardView`, `RinkPanel`, `ScheduleBoard`, `FollowingView`, `ScoreSheetView`, `EventResultsView`; `BoardLiveActivity` (FeatureBoard, GradusWidgets; the Home Screen widget was removed, #55) | M + 2k components | P0 |
| `/privacy`, `/terms` | Open in Safari from Settings → Legal | — | P0 |
| `/admin/*`, `/org-admin/*`, `/dev/*`, `/email/*`, `/lovable/*`, `/api/*` | Not in app | — | — |

---

## Appendix D — App Store submission checklist

Carried over from `docs/mobile/submission.md` and updated for the native app.

**Content (2026-09-22):** the listing copy, App Privacy answers, age rating, review notes, and screenshot plan are drafted in `docs/ios/app-store-submission.md`, ready to paste once App Store Connect is active.

**One submission (amended 2026-09-19).** The native app is the only iOS submission, at version 1.0. Nothing from the shell plan applies: no Capacitor Sign in with Apple plugin, no welcome screen for a one-time sign-in, no version ordering against 1.x builds. The Android shell notes in `docs/mobile/submission.md` stay until §12 #14 is decided.

**Before enrollment completes (do now)**
- [ ] App name, subtitle, keywords, description, support URL, marketing URL, privacy policy URL (`https://www.gradussports.com/privacy`).
- [ ] iPhone 6.9" screenshots (1320 × 2868), plus iPad 13" once the app runs on iPad (not in 1.0, decision #50); sizes and the proposed set are in `docs/ios/app-store-submission.md` §8. App Preview video optional.
- [ ] App Privacy questionnaire answers matching the policy (athlete email and commercial information are the load-bearing answers; add Diagnostics for crash reports, and Usage Data → Product Interaction → Analytics once A2 ships).
- [ ] Review notes draft (below) and demo accounts confirmed working: `mariah.slone+1@gmail.com` (parent) and `alyson.stemas@gmail.com` (coach); add a demo athlete username.
- [ ] Age rating questionnaire (no Kids Category; "Age assurance" is Yes once S1 and S3 ship, §6.13 B5).
- [ ] Decide storefront availability (default US only).

**At App Store Connect setup (enrollment approved 2026-09-19)**
- [ ] App ID `training.gradus.app` with Push Notifications, Associated Domains, Sign in with Apple, and App Groups (`group.training.gradus.app`, shared with the widget's App ID `training.gradus.app.widgets`).
- [ ] APNs key (`.p8`, Key ID), Sign in with Apple key (`.p8`, Key ID), Team ID → Lovable Cloud secrets `APNS_KEY_P8`, `APNS_KEY_ID`, `APPLE_TEAM_ID`, `APPLE_SIWA_KEY_P8`, `APPLE_SIWA_KEY_ID`; the Team ID also goes into gradus-ios `project.yml` and the AASA file.
- [ ] `apple-app-site-association` published with the Team ID and the paths in §6.10; verify with Apple's CDN check.
- [ ] Xcode Cloud workflow; internal TestFlight group.
- [ ] Live Activities frequent updates: already declared in Info.plist (`NSSupportsLiveActivitiesFrequentUpdates`); nothing to request.
- [ ] *(2026-09-24)* Declared Age Range capability on the App ID; App Store Server Notifications V2 URL set to `/api/v1/webhooks/app-store`; KWS terms accepted in the Epic developer portal, production go-live approved, and the five `KWS_*` secrets in Lovable Cloud (`KWS_CLIENT_ID`, `KWS_API_KEY`, `KWS_API_HOST`, `KWS_WEBHOOK_SECRET`, `KWS_VERIFICATION_SECRET`; §6.13 A2). *2026-09-25:* test set first, with the KWS test environment's webhook (`/api/public/webhooks/kws`) and redirect (`/verified`) pointed at gradus.training; production set swapped in after KWS approval. Test emails must belong to an Epic org admin or be a `+alias` of one; `+verified` simulates a pre-verified parent; Stripe test cards complete the card check. `/support` live before the production review is requested (#34). *2026-09-26:* KWS refuses `send-email` with `ERR_INVALID_REQUEST` until **Branding** is published for the environment (Kids Web Services → Branding: brand name `Gradus`, privacy policy `https://gradus.training/privacy`, optional support URL, banner 720×250, accent `#d0f000`); publish it for production too before go-live. The test environment passed end to end on 2026-09-26 (email → Stripe test card → webhook and `/verified` redirect → parent row verified). *2026-10-03:* every KWS method is on in production (#38); the test environment still offers card only, which is why a verification run before the secret swap shows one option.
- [ ] *(2026-10-03)* Privacy policy published with the revised children's and retention sections (brief revision 2026-10-03; `docs/legal/retention-policy.md` §A) on gradussports.com/privacy (the repo's `/privacy` redirects there since web #220); App Store Connect age-assurance answer set to **Yes** (S1 and S3 live).
- [ ] *(2026-10-03)* Vendor assurances filed (decision #45): the agreements listed in `docs/legal/information-security-program.md` §7, in Drive → Legal → Security program, with dates.

**Review notes (draft)**
1. Gradus is a multiplatform coaching service. Coach and Team subscriptions are purchased on our website; the app unlocks access to previously purchased subscriptions. There is no purchase flow in the app. On the US storefront the app links to our website to manage a plan, per Guideline 3.1.1(a); no entitlement is required.
2. Coaches can create invoices for lessons they teach in person; this is a real-world service consumed outside the app (Guideline 3.1.3(e)). No payment is processed in the app.
3. Sign in with Apple is offered alongside Google and email sign-in (Guideline 4.8).
4. User-generated content: every conversation offers Report and Block; blocked users are hidden immediately (Guideline 1.2).
5. Account deletion is in Settings → Account & security → Delete account (Guideline 5.1.1(v)); it deletes the account and revokes the Sign in with Apple token.
6. Athlete accounts for minors are created by a parent, or (13–17 only) stay provisional until a parent claims them; every parent linked to a minor is verified as an adult through Kids Web Services before any coach can be linked or any conversation opened. Under-13 athletes cannot create accounts themselves. Minors sign in with a username and can only send text. There are no channels between a coach and a minor that exclude the parent, and a parent can pause a coach's messaging at any time. The demo parent is pre-verified for review. We are not in the Kids Category.
7. Demo accounts are in the notes field; a live competition board is available at the URL provided (or the demo board if no competition is running).

**Before each submission**
- [ ] Version and build bumped; release notes written.
- [ ] `docs/ios/QA.md` checklist run on a real device with airplane mode scenarios.
- [ ] Crash-free rate on the last TestFlight build ≥ 99.5%.
- [ ] Web guardrails (§2) unchanged since the last backend publish.

---

## Appendix E — Glossary

| Term | Meaning |
|---|---|
| **Plan** | A coach-authored practice plan: title, athlete, notes, ordered moves; status active, draft, benched, or template |
| **Move** | One exercise in a plan or a coach's library: name, category, sport, what / how (cue) / why, target reps or minutes |
| **Session** | One logged practice run of a plan by a parent or athlete, with duration and a flow state |
| **Flow state** | Five-point rating: Frustrated, Pushing, Steady, Locked in, Flowing |
| **Lesson slot** | A recurring lesson between a coach and athlete (weekly, biweekly, twice monthly, monthly) with per-date overrides |
| **Wrap-up** | The post-lesson prompt asking the coach to edit, redeploy, or dismiss |
| **Briefing** | AI narrative for a coach before a lesson, built from plans, sessions, and messages since the last lesson |
| **Room** | A message thread: three-way (coach, parent, athlete) or direct (coach–coach, coach–parent) |
| **Guardian** | A parent-role account linked to an athlete; up to three per athlete on the Team plan |
| **Founding Coach** | A coach onboarded before 2026-11-01; free for life |
| **Live Board** | Public competition scoreboard built from IJS results; lanes are Just scored, On the ice (inferred), Up next |
| **Snapshot** | The cached board payload one Worker refresh produces for all viewers |
| **Broker** | A server endpoint that verifies a third-party identity token and mints a Supabase session |
| **Outbox** | The on-device queue of pending mutations, drained when online |
| **Sync Center** | Settings screen listing pending or failed changes with retry and discard |

---

## Appendix F — Work packages (scope reference)

The package numbers used by the milestones in §10.2 and by the briefs in `docs/ios/briefs/`. Scope only; no sizing.

**Phase 0 — Backend API (this repo)** — Web untouched; deploys via Lovable publish

- **0.1** API scaffolding: routing, auth middleware, error shape, idempotency table, rate limiting, OpenAPI registry, kill switch, `/meta/*`, `/me` composite
- **0.2** Auth broker: Apple, Google, password (email or username), coach sign-up, recover; `auth_identities`; Apple token revocation on delete (Needs the Sign in with Apple key to test revocation)
- **0.3** Extract and expose: messages, plans and moves, roster and schedule, sessions, settings (3 roles), invites and sign-up flows (Largest refactor; one PR per domain)
- **0.4** Extract and expose: board, competitions and recaps, resources and Ask Gradus, invoicing, guardians and team, visibility, org join, voice (accept `audio/mp4`)
- **0.5** APNs sender, triggers in shared functions, token pruning, `board_follows`, `live_activity_tokens`, push-to-start for boards (Send path testable only after enrollment)

**Phase 1 — iOS foundation** — Can run in parallel with Phase 0 after 0.1

- **1.1** Create `gradus-ios`; Xcode project, SPM packages, contract sync script, macOS CI, Xcode Cloud, color catalog generation, fonts, core components
- **1.2** Generated API client, interceptors, client policy, error mapping
- **1.3** Auth screens: sign in, Apple, Google, password and username, Keychain, biometric gate, terms sheet
- **1.4** Local store, repositories, outbox, sync engine, connectivity, Sync Center
- **1.5** App shell: tabs per role, routing, universal links, push registration and routing, error states, force-update

**Phase 2 — P0 features**

- **2.1** Sign-up and onboarding for coach, parent, minor athlete, adult athlete; invite entry
- **2.2** Coach roster: segments, week schedule, lesson slot sheet, recurrence port with shared vectors, add and remove athlete, invite code, roster settings, practice targets
- **2.3** Athlete detail with AI summary; pre-lesson briefing; lesson wrap-ups
- **2.4** Plans: list and filters, detail and editor, move library, templates, status rules, sessions view, AI session summary (Biggest screen in the app)
- **2.5** Voice FAB end to end with offline capture
- **2.6** Messaging: rooms, thread with pagination, realtime, composer, voice notes (record, play, WebM fallback), plan tags, new conversation, report and block
- **2.7** Sessions: runner plan detail, timer, Live Activity, feedback, persistent active bar
- **2.8** Parent settings: athletes, coaches, primary coach, goals, schedule editor, reset athlete password; goals dashboard
- **2.9** Athlete: plans, goals and motivation, coaches; Safe Sport panel
- **2.10** Common settings: profile, appearance, account and security with deletion, device, legal, feedback, plan status with US link, sign out
- **2.11** Live Board: index, board with three tabs, rink panel and lanes, score sheet, results, schedule, follow search, history, attendance, universal link and QR
- **2.12** Live Activity and Dynamic Island for the board, including server push-to-start
- **2.13** Offline hardening across features: per-entity policies, queued mutations, conflict UX, background refresh
- **2.14** Push: content, routing, badges, permission UX; end-to-end QA of triggers

**Phase 3 — P1 features** — Part of native 2.0

- **3.1** Resources: library, PDF viewer, coach upload, report a resource
- **3.2** Ask Gradus and saved answers
- **3.3** Invoicing: rates, preview, create, detail, status, share
- **3.4** Competition results linking, post-event prompt, plan from results, recap prompt and sheet, recap messages
- **3.5** Guardian claims, team guardians, connection celebration, coach visibility management, athlete guardian
- **3.6** Schedule import with camera and AI review
- **3.7** Plan share and import, starter programs, Founding tier claim, connections hub, in-app password reset
- **3.8** Home Screen widget (*the Live Board widget was removed 2026-10-17, #55; the practice and Today widgets replace it*), lesson reminders, App Attest
- **3.9** Web voice-note format preference; the Capacitor iOS removal PR (can merge any time since 2026-09-19; the 2.0 welcome screen is no longer needed)
- **3.10** *(2026-09-20)* Skill events, the coach "why" prompt, protocol-derived events; level history comes from `athlete_goals_history` (L1, L2)
- **3.11** *(2026-09-20)* Athlete profile, inference job, profile-fed prompts, sport-aware plan drafting from full results history (L3)
- **3.12** *(2026-09-20)* Knowledge corpus, ingestion path, grounded Ask Gradus with citations and safety routing, iOS sources UI (L4, L5)
- **3.13** *(2026-09-20)* Learned pace model, post-launch (L6)
- **3.14** *(2026-10-03)* Athlete-authored plans: ownership migration and RPC branches, the parallel `/athlete/...` authoring routes with transcribe-and-discard voice, the iOS authoring mode, read-only library and adopt flow (AP1–AP4)
- **3.15** *(2026-10-03)* Apple Watch: `GradusWatch` target and companion session, `PlanNarration` and the player, spoken briefing and wrap-up, voice→plan and deploy for coaches and athletes, sessions on the wrist (W0–W6)

**Phase C — Capacitor iOS 1.0 to the App Store** — **Dropped 2026-09-19** (no shell ships)

- **C.1** Sign in with Apple in the shell via the broker; App ID, certificates, APNs and Sign in with Apple keys; AASA with Team ID
- **C.2** Listing, screenshots, App Privacy answers, review notes; archive, TestFlight sanity, submit; one review round

**Phase D — Capacitor Android 1.0 to Google Play** — **Reopened 2026-09-19** (§12 #14)

- **D.1** JDK 17 and Android Studio, `cap add android`, icons and splash, keystore and Play App Signing, AAB, Play listing and Data safety, `assetlinks.json` with the Play SHA-256, one review round (Keep the upload key backed up)

**Phase 4 — Hardening and launch (native 2.0)**

- **4.1** Accessibility and Dynamic Type pass, performance, iPad layouts, QA checklist runs, TestFlight feedback, screenshots, privacy labels, review notes, submission (Plus App Review wait (typically 1–7 days, allow two rounds)). *2026-09-19:* the accessibility pass is pulled forward into the §10.6 gate (P5–P8) and the QA checklist into P9.
