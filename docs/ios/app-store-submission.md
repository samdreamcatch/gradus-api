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
| Support URL        | https://www.gradussports.com/contact (live; `/support` returns 404 on both domains) |
| Marketing URL      | https://www.gradussports.com                                                        |

---

## 3. Listing copy

Character limits are Apple's. Counts were checked when this file was written.

**Subtitle** (30 max): `Practice made perfect` (21). The tagline, verbatim; no other tagline is allowed.

**Promotional text** (170 max, editable without a new build):

> Structured practice between lessons. Coaches build the plan, athletes and parents follow it, and everyone sees how practice is going before the next lesson.

**Keywords** (100 max, comma-separated, no spaces after commas; don't repeat the app name or category):

```
coach,figure skating,tennis,golf,practice plan,lesson,drills,athlete,parent,training log,skate,club
```

**Description** (4,000 max):

> Most of an athlete's development happens between lessons. Gradus gives that time a plan.
>
> FOR COACHES
> • Build between-lesson practice plans from your move library, or talk a plan out loud and let Gradus draft it.
> • Keep your roster, lesson schedule, and invoices in one place. Photograph a paper schedule to import it.
> • Get a briefing before each lesson on how practice has actually gone.
> • Message athletes and their parents in shared threads. Every conversation includes the parent.
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
> • Report and block in every conversation, and Safe Sport resources built in.
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

| Apple category → type               | Why it is collected                                           |
| ----------------------------------- | ------------------------------------------------------------- |
| Contact Info → Name                 | Account profiles; athlete name                                |
| Contact Info → Email Address        | Sign-in; guardian email for under-18 athletes                 |
| Identifiers → User ID               | Account id                                                    |
| Identifiers → Device ID             | APNs push token, App Attest key id                            |
| User Content → Audio Data           | Voice notes in messages; voice plan capture                   |
| User Content → Photos or Videos     | Coach schedule-import photos and resource uploads             |
| User Content → Other User Content   | Messages, plans, notes, goals, Ask Gradus questions           |
| Health & Fitness → Fitness          | Practice session duration and the post-session flow check-in  |
| Purchases → Purchase History        | Subscription status (bought on the website, shown in the app) |
| Other Data → Other Data Types       | Athlete date of birth                                         |
| Diagnostics → Crash Data            | MetricKit crash reports → `POST /api/v1/errors`               |
| Diagnostics → Performance Data      | MetricKit hang reports                                        |
| Diagnostics → Other Diagnostic Data | Client error reports → `POST /api/v1/errors`                  |

Not collected by the 1.0 build: phone number, physical address, location, contacts, browsing/search history, health (non-fitness), financial info, sensitive info, advertising data, product interaction.

**Adding product-interaction analytics later is allowed.** In the same PR that starts sending events: add `NSPrivacyCollectedDataTypeProductInteraction` (purpose `NSPrivacyCollectedDataTypePurposeAnalytics`) to the app's privacy manifest, and update App Privacy in App Store Connect to _Usage Data → Product Interaction → Analytics_ (answers can change without a new build, but must be accurate before the collecting build ships). First-party analytics isn't _tracking_ under App Tracking Transparency, so no ATT prompt, as long as events are never combined with third-party data for ads or shared with data brokers. The published policy already covers it (§2.4: features accessed, session duration, usage patterns). For minor athletes, keep events to internal product use only, never profiling or ads (policy §5.3, COPPA's internal-operations exception); the PRD's "no third-party analytics SDK" rule (§6.11, §9.2) favours first-party events through `/api/v1`, like `/errors`, over an SDK.

Judgment calls, conservative on purpose (over-declaring is safe, under-declaring gets apps pulled): _Fitness_ for practice logs, _Device ID_ for push tokens, _Purchase History_ for subscription status the app only reads.

---

## 5. Age rating

Apple's questionnaire (updated in 2025) computes the rating from the answers. Proposed answers:

| Question                                                                               | Answer                                                                                                                                       |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Violence, sexual content, profanity, horror, gambling, alcohol/tobacco/drugs, contests | None                                                                                                                                         |
| Mature or suggestive themes                                                            | **Mariah decides:** the Safe Sport panel and The Assist's documents discuss abuse prevention. Proposed: _Infrequent/Mild_                    |
| Medical or treatment information                                                       | **Mariah decides:** Ask Gradus can answer injury and pain questions (minors are routed to the Safe Sport panel). Proposed: _Infrequent/Mild_ |
| Unrestricted web access                                                                | No (links open specific pages in Safari; there is no in-app browser)                                                                         |
| User-generated content                                                                 | Yes: messages and uploaded resources, with Report and Block                                                                                  |
| Messaging and chat                                                                     | Yes: restricted to connected coaches, parents, and athletes                                                                                  |
| Parental controls                                                                      | Yes: parents create and oversee under-18 athlete accounts                                                                                    |
| Age assurance                                                                          | No                                                                                                                                           |
| Advertising                                                                            | No                                                                                                                                           |
| Made for Kids                                                                          | **No** (the Kids Category forbids external links, and billing links out)                                                                     |

Expect the result above 4+ because of messaging and user content. That matters for youth athletes whose parents use Screen Time age limits. **Decision for Mariah:** accept Apple's computed rating, or override it upward. You can't set it lower than computed.

---

## 6. Other App Store Connect questions

- **Export compliance:** answered by the build. `ITSAppUsesNonExemptEncryption = false` (HTTPS/TLS only), so App Store Connect won't ask.
- **Content rights:** "Does your app contain, show, or access third-party content?" **Yes**: rulebooks, SafeSport materials, and The Assist's documents in Resources and Ask Gradus. You then confirm you have the rights. This ties to PRD §12 #16, which is still open. Until rights are confirmed, those sources stay cite-only (title + link), as L4 built them.
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

All three must be tested on the TestFlight build against production before submission.

**Notes** (paste; update if anything changes in QA):

> 1. Gradus is a multiplatform coaching service for coaches, parents, and athletes. Coach and Team subscriptions are purchased on our website; the app unlocks previously purchased subscriptions. There is no purchase flow in the app. On the US storefront the app links to our website to manage a plan (Guideline 3.1.1(a)).
> 2. Coaches can create invoices for in-person lessons they teach; this is a real-world service consumed outside the app (Guideline 3.1.3(e)). No payment is processed in the app.
> 3. Sign in with Apple is offered alongside email sign-in.
> 4. User-generated content: every conversation offers Report and Block (message long-press → Report this message; conversation menu → Block). Blocked users are hidden immediately (Guideline 1.2).
> 5. Account deletion: Settings → Account & security → Delete account (Guideline 5.1.1(v)). It deletes the account and revokes the Sign in with Apple token.
> 6. Athlete accounts for minors are created by a parent, or require a parent's email, and sign in with a username. There are no private channels between a coach and a minor that exclude the parent. The app is not in the Kids Category.
> 7. Demo accounts: coach, parent, and athlete are provided above. The Live Board works with any public competition code; [add a live or demo board code at submission].
> 8. Live Activities are used for the practice timer and for competitions the user follows.

---

## 8. Screenshots

- **iPhone 6.9" (required):** 1320 × 2868 portrait. The automated simulator (iPhone 17 Pro Max) captures exactly this size. 3–10 per locale; Apple scales these for smaller iPhones.
- **iPad 13" (required while the app runs on iPad):** 2064 × 2752. `TARGETED_DEVICE_FAMILY` is `1,2` today, so App Store Connect will require iPad screenshots. **Decision for Mariah:** keep iPad (PRD §12 #12 chose "works, not optimized") and capture iPad screenshots, or ship iPhone-only for 1.0.
- **Proposed set (6.9"):** coach roster/schedule · plan editor with voice capture · parent dashboard with goals · athlete practice timer (with the Live Activity) · messages thread · Live Board following a skater.
- **Data:** capture from the marketing demo mode (gradus-ios PR #31, still open and stacked on an old branch). It needs rebasing onto `main` first. Mock data from `-GradusMock` is the fallback; neither shows real users.
- App Preview video: optional; skip for 1.0.

---

## 9. Findings to resolve before submission (not account-gated)

1. **Privacy manifests:** added in gradus-ios PR #58 (neither target had one; App Store uploads need them for UserDefaults). Also adds `NSPhotoLibraryAddUsageDescription`, because the share sheet's Save Image on a shared resource would otherwise terminate the app.
2. **Policy vs app (counsel):** the policy says Gradus doesn't collect photographs from or about athletes. Coaches can upload schedule photos and resource images; confirm that wording still holds. §4.2's provider list doesn't name Apple (push delivery, Sign in with Apple). Once L5 ships, Ask Gradus questions are embedded through the Lovable gateway's OpenAI model (`openai/text-embedding-3-small`), and the policy names only Google for AI inference. Counsel decides wording; this repo's `/privacy` mirrors the published text verbatim.
3. **Support page:** `/support` is a 404 on both domains; `/contact` works and is used above.
4. **Demo athlete account** doesn't exist yet (§7).
5. **Scope before I16** (PRD §10.7): L1, L2, L3, and L5 are part of 1.0 and not yet built. L4 is merged.
