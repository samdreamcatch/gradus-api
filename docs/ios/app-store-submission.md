# App Store submission kit — Gradus 1.0 (iOS)

**Written:** 2026-09-22. **Status:** Apple Developer enrollment is submitted and waiting for its payment to clear. Nothing exists in App Store Connect yet.
**Use:** everything App Store Connect will ask for, drafted so it can be pasted in when the account is active. PRD Appendix D is the checklist; this file is the content. Keep the App Privacy answers (§4) in step with `gradus-ios/Gradus/PrivacyInfo.xcprivacy` (gradus-ios PR #58) and the published policy.

---

## 1. What blocks what, in order

| #   | Step                                                                                                                                                                                                             | Who                                        | Unblocks                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 1   | Enrollment payment clears; membership shows **Active**                                                                                                                                                           | Apple / Mariah                             | Everything below                                                                                         |
| 2   | Identifiers: App ID `training.gradus.app` (Push Notifications, Associated Domains, Sign in with Apple, App Groups), App ID `training.gradus.app.widgets` (App Groups), group `group.training.gradus.app` on both | Mariah                                     | Signing any device build                                                                                 |
| 3   | Keys: APNs (`.p8` + Key ID) and Sign in with Apple (`.p8` + Key ID)                                                                                                                                              | Mariah                                     | Push, Live Activities, Apple revoke on delete                                                            |
| 4   | Team ID sent to the session                                                                                                                                                                                      | Mariah                                     | `DEVELOPMENT_TEAM` in gradus-ios `project.yml`; the AASA file in this repo (one small PR each, same day) |
| 5   | Lovable secrets `APNS_KEY_P8`, `APNS_KEY_ID`, `APPLE_TEAM_ID`, `APPLE_SIWA_KEY_P8`, `APPLE_SIWA_KEY_ID`                                                                                                          | Mariah                                     | Server push sender, App Attest, Apple revoke                                                             |
| 6   | App Store Connect app record (§2)                                                                                                                                                                                | Mariah                                     | Xcode Cloud, TestFlight                                                                                  |
| 7   | Xcode Cloud: connect `mariah-gill/gradus-ios`, workflow "archive `main` → TestFlight internal group"                                                                                                             | Mariah (the session can walk through it)   | **T1**, the first TestFlight build on her phone                                                          |
| 8   | `API_V1_ENABLED=true` in Lovable secrets, then Publish                                                                                                                                                           | Mariah                                     | The TestFlight build talking to production                                                               |
| 9   | QA on TestFlight (`docs/ios/QA.md`), the device accessibility pass (gradus-ios `docs/device-accessibility-script.md`), and L1–L3 + L5 merged (PRD §10.7: all before I16)                                         | Mariah + sessions                          | **I16**, submission                                                                                      |
| 10  | Listing, privacy, age rating, review info (§3–§7), screenshots (§8)                                                                                                                                              | Mariah pastes; session drafts and captures | Submit for review                                                                                        |
| 11  | App Store Server Notifications **Version 2**, production and sandbox URL `https://gradus.training/api/public/webhooks/app-store` (App Store Connect → the app → App Information → App Store Server Notifications), after the S3 web PR is published | Mariah | `RESCIND_CONSENT` pauses the athlete (PRD §6.13 B4, S3); the sandbox QA row in `docs/ios/QA.md` §8 |

Not blocking, but needed before the Google button and native password reset appear: a Google Cloud iOS OAuth client for `training.gradus.app` (client ID → session + secret `GOOGLE_IOS_CLIENT_ID`), and `gradus://reset-password` in the Supabase Auth redirect allow-list.

---

## 2. App record (App Store Connect → Apps → +)

| Field              | Value                                                                               |
| ------------------ | ----------------------------------------------------------------------------------- |
| Platform           | iOS                                                                                 |
| Name               | **Gradus** (if taken on the store, fallback: _Gradus: Coach & Practice_)            |
| Primary language   | English (U.S.)                                                                      |
| Bundle ID          | `training.gradus.app`                                                               |
| SKU                | `gradus-ios-1` (internal only; any unique string)                                   |
| User access        | Full access                                                                         |
| Version            | **1.0.0**: must equal `MARKETING_VERSION` in gradus-ios, or uploads do not attach   |
| Primary category   | Sports                                                                              |
| Secondary category | Education                                                                           |
| Price              | Free                                                                                |
| Availability       | United States only (PRD §12 #7 default)                                             |
| Copyright          | 2026 Gradus Sports, Inc.                                                            |
| Privacy policy URL | https://www.gradussports.com/privacy                                                |
| Support URL        | https://gradus.training/support (S4; until its PR is published, https://www.gradussports.com/contact) |
| Marketing URL      | https://www.gradussports.com                                                        |

---

## 3. Listing copy

Character limits are Apple's. Counts were checked when this file was written.

**Subtitle** (30 max): `Practice made perfect` (21). The tagline, verbatim; no other tagline is allowed.

**Promotional text** (170 max, editable without a new build):

> Structured practice between lessons. Coaches build the plan, athletes and parents follow it, and everyone sees how practice is going before the next lesson.

**Keywords** (100 max, comma-separated, no spaces after commas; don't repeat the app name, the category, or words already in the subtitle):

```
coach,figure skating,tennis,golf,training plan,lesson,drills,athlete,parent,skate,club,timer,goals
```

**Description** (4,000 max):

> Most of an athlete's development happens between lessons. Gradus gives that time a plan.
>
> FOR COACHES
> • Build between-lesson practice plans from your move library, or talk a plan out loud and let Gradus draft it.
> • Keep your roster, lesson schedule, and invoices in one place. Photograph a paper schedule to import it.
> • Get a briefing before each lesson on how practice has actually gone.
> • Message athletes and their parents in shared threads. A minor athlete's conversations always include their parent.
>
> FOR PARENTS
> • See what your child's coach is working on, with talking points and drills you can use at home without playing coach.
> • Track practice sessions, goals, and progress for each athlete in your family.
> • Follow competitions live and get recaps when results post.
>
> FOR ATHLETES
> • Your plan, your goals, and a practice timer that logs every session.
> • Check in after practice so your coach knows how it felt.
>
> BUILT FOR YOUTH SPORT
> • Athlete accounts for minors are created with a parent. There are no private coach–minor athlete channels.
> • Report and block in every conversation, and Safe Sport resources built in. Every report reaches our team at once and we respond within one business day: support@gradussports.com.
> • Works offline: sessions, notes, and messages sync when you're back online.
> • Live Activities for the practice timer and for competitions you follow, plus a Home Screen widget.
>
> Coach and Team plans are managed on our website. Existing subscriptions unlock in the app.
>
> Practice made perfect.

Before pasting, check the description against the build. Every claim above is built, but only mock-verified until QA. Remove anything that fails QA rather than shipping a claim the reviewer can't find (Guideline 2.3.1).

---

## 4. App Privacy ("nutrition label")

**Tracking:** No. No data is used to track users across other companies' apps or websites. No ad or analytics SDKs.

For each type below, answer: **collected — yes; linked to the user's identity — yes; used for tracking — no; purpose — App Functionality.**

| Apple category → type                                                           | Why it is collected                                                                                                   |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Contact Info → Name                                                             | Account profiles; athlete name                                                                                        |
| Contact Info → Email Address                                                    | Sign-in; guardian email for under-18 athletes                                                                         |
| Identifiers → User ID                                                           | Account id                                                                                                            |
| Identifiers → Device ID                                                         | APNs push token, App Attest key id                                                                                    |
| User Content → Audio Data                                                       | Voice notes in messages; voice plan capture                                                                           |
| User Content → Photos or Videos                                                 | Coach schedule-import photos (resource images are public web links, not uploads, since 2026-09-26)                    |
| User Content → Other User Content                                               | Messages, plans, notes, goals, Ask Gradus questions                                                                   |
| Health & Fitness → Fitness                                                      | Practice session duration and the post-session flow check-in                                                          |
| Purchases → Purchase History                                                    | Subscription status (bought on the website, shown in the app)                                                         |
| Other Data → Other Data Types                                                   | Athlete date of birth                                                                                                 |
| Diagnostics → Crash Data                                                        | MetricKit crash reports → `POST /api/v1/errors`                                                                       |
| Diagnostics → Performance Data                                                  | MetricKit hang reports                                                                                                |
| Diagnostics → Other Diagnostic Data                                             | Client error reports → `POST /api/v1/errors`                                                                          |
| Usage Data → Product Interaction (purpose **Analytics**, not App Functionality) | Screen time and Resources activity → `POST /api/v1/analytics/events` (A1/A2); minor athletes' events carry no user id |

Not collected: phone number, physical address, location, contacts, browsing/search history, health (non-fitness), financial info, sensitive info, advertising data.

**Product interaction (built in A1/A2):** answer _Usage Data → Product Interaction_ as linked to the user (adults; minor athletes' events are stored without a user id), not used for tracking, purpose **Analytics**. The iOS privacy manifest declares `NSPrivacyCollectedDataTypeProductInteraction` with `NSPrivacyCollectedDataTypePurposeAnalytics` (gradus-ios A2). First-party analytics isn't tracking under App Tracking Transparency, so there's no ATT prompt; users can turn it off in Settings → Device → Privacy. The published policy's §2.4 already covers usage data.

Judgment calls, conservative on purpose (over-declaring is safe, under-declaring gets apps pulled): _Fitness_ for practice logs, _Device ID_ for push tokens, _Purchase History_ for subscription status the app only reads.

---

## 5. Age rating

Apple's questionnaire (updated in 2025) computes the rating from the answers. Proposed answers:

| Question                                                                               | Answer                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Violence, sexual content, profanity, horror, gambling, alcohol/tobacco/drugs, contests | None                                                                                                                                                                                                                       |
| Mature or suggestive themes                                                            | **None** (Mariah, 2026-09-24). The Assist's documents and the safety PDFs are out of the iOS 1.0 library (PRD decision #23); the Safe Sport panel is hotlines and reporting links only                                     |
| Medical or treatment information                                                       | **None** (Mariah, 2026-09-24). Ask Gradus is hidden in iOS 1.0 (PRD decision #22) and no library PDF gives injury or treatment guidance                                                                                    |
| Unrestricted web access                                                                | No (links open specific pages in Safari; there is no in-app browser)                                                                                                                                                       |
| User-generated content                                                                 | Yes: messages and uploaded resources, with Report and Block                                                                                                                                                                |
| Messaging and chat                                                                     | Yes: restricted to connected coaches, parents, and athletes                                                                                                                                                                |
| Parental controls                                                                      | Yes: parents create and oversee under-18 athlete accounts, are verified as adults before any coach link or conversation, and can pause a coach's messaging with their athlete (PRD §6.13)                                                                                          |
| Age assurance                                                                          | **Yes once S1 and S3 ship** (S1 live; S3 built 2026-10-03, answer Yes once its PRs are merged and published; PRD §6.13 B5, 2026-09-24): every parent of a minor is verified as an adult through Kids Web Services (a payment card or the SSN check, on KWS's own pages; decision #38), and the app reads Apple's Declared Age Range on device. Until then the answer stays **No** (parent-entered birthdate only). Earlier note, for the record: "No" (Mariah, 2026-09-24), vendor under evaluation (PRD §12 #23, now resolved) |
| Advertising                                                                            | No                                                                                                                                                                                                                         |
| Made for Kids                                                                          | **No** (the Kids Category forbids external links, and billing links out)                                                                                                                                                   |

Expect the result above 4+ because of messaging and user content. That matters for youth athletes whose parents use Screen Time age limits. **Decided 2026-09-24:** accept Apple's computed rating; no upward override.

---

## 6. Other App Store Connect questions

- **Export compliance:** answered by the build. `ITSAppUsesNonExemptEncryption = false` (HTTPS/TLS only), so App Store Connect won't ask.
- **Content rights:** "Does your app contain, show, or access third-party content?" For 1.0 the answer is **No** (Mariah, 2026-09-24): Ask Gradus is hidden for every role (PRD decision #22) and the library lists only rows marked Gradus-authored or licensed (decision #23; Admin → Content → Library rights, every existing row starts pending). Before submission, confirm in that admin page that nothing marked _licensed_ lacks a written permission or public licence on file. When Ask Gradus returns, the answer becomes Yes and PRD §12 #16 must be closed first.
- **Sign in with Apple:** Guideline 4.8 applies only when a third-party login is offered. Google is hidden until its client ID exists, but Sign in with Apple ships regardless.
- **Advertising identifier (IDFA):** No.

---

## 7. App Review information

**Contact:** Mariah (first/last name, phone, mariah@gradussports.com).
**Demo accounts** (Mariah enters passwords in App Store Connect; never in this repo):

| Role    | Username                                                     | Notes                                                                 |
| ------- | ------------------------------------------------------------ | --------------------------------------------------------------------- |
| Coach   | `alyson.stemas@gmail.com`                                    | Needs an active Coach or Team plan so the reviewer sees full features |
| Parent  | `mariah.slone+1@gmail.com`                                   | Linked to the coach above, with at least one athlete                  |
| Athlete | _to create_: a username-login athlete under the parent above | PRD Appendix D asks for one; it doesn't exist yet                     |

**Decided 2026-09-24 (PRD decision #26):** the review set becomes a dedicated coach, parent and minor athlete (username login) created and seeded by the admin-only demo-account tool (Admin → Membership → Demo accounts), with invented names and a gradussports.com mailbox Mariah provides. Replace the two personal accounts above with the seeded ones once the tool has run against production; passwords go into App Store Connect only.

All three must be tested on the TestFlight build against production before submission.

**Notes** (paste; update if anything changes in QA):

> 1. Gradus is a coaching service for coaches, parents, and athletes. Coach and Team subscriptions are purchased on our website; the app unlocks subscriptions bought there and has no purchase flow. The app is offered on the United States storefront only, where the Guidelines allow a link to our website to buy or manage a plan.
> 2. Coaches can create invoices for in-person lessons they teach; this is a real-world service consumed outside the app (Guideline 3.1.3(e)). No payment is processed in the app.
> 3. Sign in with Apple is offered alongside email sign-in.
> 4. User-generated content: every conversation offers Report and Block (message long-press → Report this message; conversation menu → Block). Blocked users are hidden immediately (Guideline 1.2).
> 5. Account deletion: Settings → Account & security → Delete account (Guideline 5.1.1(v)). It deletes the account and revokes the Sign in with Apple token.
> 6. Athlete accounts for minors are created by a parent, or (ages 13–17 only) stay provisional until a parent claims them. Every parent linked to a minor is verified as an adult through Kids Web Services before any coach can be linked or any conversation opened; under-13 athletes cannot create accounts themselves. Minors sign in with a username and can only send text. There are no channels between a coach and a minor that exclude the parent, and a parent can pause a coach's messaging at any time. The demo parent account is pre-verified for review. On iOS 26 the app also reads Apple's Declared Age Range as a tighten-only check: a device whose Apple Account is under 18 can create only an athlete account, and declining to share never blocks anything. A parent's withdrawal of consent through Apple (`RESCIND_CONSENT`) pauses the athlete's account. Reports reach our team at once (support@gradussports.com, a reply within one business day; see gradus.training/support). The app is not in the Kids Category.
> 7. Demo accounts: coach, parent, and athlete are provided above. The Live Board works with any public competition code; [add a live or demo board code at submission].
> 8. Live Activities are used for the practice timer and for competitions the user follows.

Note 1 deliberately doesn't call Gradus a multiplatform service. Guideline 3.1.3(b) (Multiplatform Services) allows unlocking web-bought subscriptions only when they are also sold as in-app purchases, and Gradus sells none. The note relies on the US-storefront exception instead, so availability must stay US-only (§2). Check the current wording of that exception in the App Review Guidelines before pasting, and add its guideline number then.

---

## 8. Screenshots

- **iPhone 6.9" (required):** 1320 × 2868 portrait. The automated simulator (iPhone 17 Pro Max) captures exactly this size. 3–10 per locale; Apple scales these for smaller iPhones.
- **iPad 13" (required while the app runs on iPad):** 2064 × 2752. `TARGETED_DEVICE_FAMILY` is `1,2` today, so App Store Connect will require iPad screenshots. **Decision for Mariah:** keep iPad (PRD §12 #12 chose "works, not optimized") and capture iPad screenshots, or ship iPhone-only for 1.0.
- **Proposed set (6.9"):** coach roster/schedule · plan editor with voice capture · parent dashboard with goals · athlete practice timer (with the Live Activity) · messages thread · Live Board following a skater.
- **Data:** capture from the `-GradusMock` data with the harness in gradus-ios `Tools/AppStoreScreenshots` (`run.sh` writes both sizes, clean status bar). *2026-10-04:* every person in mock data is invented; the founders' and their families' real names were removed from the mocks (decision: real people never appear in mock, demo, test or screenshot data). Do **not** use gradus-ios PR #31's demo mode: it uses real names and is to be closed.
- App Preview video: optional; skip for 1.0.

---

## 9. Findings to resolve before submission (not account-gated)

1. **Privacy manifests:** added in gradus-ios PR #58 (neither target had one; App Store uploads need them for UserDefaults). Also adds `NSPhotoLibraryAddUsageDescription`, because the share sheet's Save Image on a shared resource would otherwise terminate the app.
2. **Policy vs app (counsel):** the policy says Gradus doesn't collect photographs from or about athletes. Coaches can upload schedule photos; resource images are links to public web addresses, never uploads (2026-09-26); confirm that wording still holds. §4.2's provider list doesn't name Apple (push delivery, Sign in with Apple). Once L5 ships, Ask Gradus questions are embedded through the Lovable gateway's OpenAI model (`openai/text-embedding-3-small`), and the policy names only Google for AI inference. Counsel decides wording; this repo's `/privacy` mirrors the published text verbatim.
3. **Support page:** `/support` is a 404 on both domains; `/contact` works and is used above.
4. **Demo accounts:** create the three seeded accounts with the admin tool against production (§7) and verify each on the TestFlight build.
5. **Library rights:** apply migration `20260924120000_resources_rights` and mark each curated document in Admin → Content → Library rights; unmarked rows stay off the iOS library.
6. **Names in dummy data:** the "Gradus Demo Invitational" competition was inserted by hand through Lovable; if its rows carry real names, replace them the way web #143 did for the demo board.
7. **Scope before I16** (PRD §10.7): L1, L2, L3, and L5 are part of 1.0 and not yet built. L4 is merged.
