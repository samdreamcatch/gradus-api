# Privacy policy and terms: the 2026-10 revision

Drafted on Mariah's instruction (2026-10-10: "update the terms and the privacy policy with items we've been needing to update"; 2026-10-11: "keep all policies in sync" and double-check the PRD and other notes for owed items). Decision D3 (2026-10-03): Claude drafts, no counsel at this stage. Section numbers are unchanged, so every existing reference (the retention policy, the brief, the PRD) still points to the right section.

**Where the text lives (decided 2026-10-11).** One copy, on gradussports.com: `src/routes/privacy.tsx` and `src/routes/terms.tsx` in **mariah-gill/design-friendly-launchpad**. This app's `/privacy` and `/terms` now 307-redirect there (`src/lib/legal-urls.ts`), so links in emails, the iOS app, the direct notice and the sign-up pages keep working and the two sites can't drift. Edit the wording in the site repo only; when the terms change, bump `CURRENT_TERMS_VERSION` (`src/lib/terms.ts`) to the new "Last Updated" date.

**Publish order.** The site first (new text live), then this app (redirects and the version bump). The iOS app asks everyone to accept the terms again on its next launch after the app publish, and its sheet opens the site's page.

Every statement was checked against `main` on 2026-10-10/11 (code paths in brackets).

## Privacy policy

| § | Change | Source |
|---|---|---|
| Header | Last Updated: October 11, 2026 (change to the day you publish) | — |
| 0 | Retention pointer fixed: "Section 8" → "Section 7". Contact email privacy@ (no such mailbox) → support@gradussports.com. New category: audio (voice recordings from coaches, parents, athletes 18+; never under 18) | Typo; Mariah 2026-10-10; #48 |
| 1 | Names the apps: iPhone, Apple Watch, and the web app (no iPad in 1.0) | Watch in 1.0 (#36); iPhone only (#50) |
| 2.1 | Coaches: reasons recorded when changing a plan; lesson schedules, rates, invoices; schedule images and PDFs; images and video by public link only, and no images or video of athletes they coach; voice recordings and transcripts | Brief §1, §3, §5 [`athlete_skill_events`, `invoicing.server.ts`, `coach-resources.server.ts`] |
| 2.2 | Parents: athlete's *name* (the form takes first and last), adult-verification result, the parent's choices (consent, pauses, coach plan visibility), voice messages | Brief §6, §8 [`signup.parent.athletes.tsx`] |
| 2.3 | Athletes: username, goals and level, plans they write, competition results, messages (voice only 18+). **"Gradus never collects photos or video of Athletes"** in bold, with the reasons (no profile pictures, messages can't carry media, no upload place), and no audio from under-18s | Brief §8; AP1–AP3; the direct-notice change (web #219) |
| 2.4 | Crash reports via Apple; push tokens; Apple Declared Age Range band; App Store transaction id for athlete accounts; minors' usage events stored without identifiers and reported in groups of 10+ | Brief §4, §6, §7 [`app_store_app_transactions`, `device_tokens`] |
| 3 | New purposes: tailoring plans to an athlete's own history (for connected coaches); verifying parents and keeping consent records; acting on safety reports; **aggregated, de-identified data from practice activity and AI outputs to improve recommendations for all users**. Transcription now covers coaches, parents and adult athletes | Brief §3, §8; #48; Mariah 2026-10-11 |
| 4.1 | Every conversation with an under-18 includes a verified adult who is not the coach. Other coaches' plan visibility (Club; double opt-in plus parent permission). Share links: anyone with the link sees the plan and the author's name (athlete first name only), and the link works until the plan is deleted | #161 rules; AP1–AP3 [`coach-plan-access.server.ts`, `plan-share.server.ts`] |
| 4.2 | Providers: **added** Apple (push, Sign in with Apple + relay email, App Store notifications, Declared Age Range), Google sign-in, OpenAI (Ask Gradus embeddings, text only), Kids Web Services with Stripe and Veratad, and **Anthropic, PBC (Claude) for coach move drafts** (Mariah 2026-10-11; receives only what the coach types about the move: name, sport, any hint or partly written description, plus Gradus library examples; never account identifiers or athlete information; may search the web for the move name) [web #224, `move-draft-claude.server.ts`, `move-draft-brief.server.ts`]. Lovable Cloud now says email delivery and AI gateway. **ElevenLabs corrected**: speech-to-text only (the old "speech synthesis" was wrong: read-aloud uses each device's built-in text-to-speech, #47), coaches/parents/adults only, its own retention applies | Brief §2, Revision §1; #48 owed line |
| 5.2 | Rewritten: under-13 parent-created; 13–17 provisional; coaches invite the parent; KWS verification with every method (card or SSN last four via Veratad), Gradus gets result + reference only; direct notice in the invite email and in-app; 3-month deletion of unclaimed accounts; **the retired email carbon copy removed**; verified adult in every minor conversation, text only, parent pause; Apple age range and consent withdrawal through Apple | Brief §6, §8, Revision §1, §3, §6 |
| 5.3 | Identifiers list updated; no photos, video, or under-18 audio; share-link exception to "no public profiles"; profiling bullet reworded to "profiling unrelated to coaching"; minors' usage de-identified; Ask Gradus not available under 18 | Brief §3, §4; #87 [`ask-gradus-audience.server.ts`] |
| 5.4 | Parent may refuse further collection by deleting the athlete or writing to us (COPPA requires saying so) | 16 CFR 312.4(d) |
| 6 | Lists the AI features and their providers (move drafts for coaches by Anthropic's Claude added 2026-10-11); practice-history personalization disclosed (own activity only, shown only to connected coaches); Ask Gradus closed to under-18s; outputs go to the practice relationship or the person who asked; **read-aloud uses the device's own text-to-speech, no speech provider**; **new paragraph: aggregated, de-identified datasets from practice information and AI outputs improve the Service and recommendations for all users, kept de-identified with no attempt to re-identify** (matches the site's "How does Gradus use AI?" answer, which Mariah kept; the de-identification commitment is what the CPRA asks of a business that uses de-identified data) | Brief §2, §3; #47; Mariah 2026-10-10/11 |
| 7 | Replaced by the retention list from `docs/legal/retention-policy.md` §A (every window), plus how to delete; **messages row adds that a deleted coach's or parent's messages stay in the conversation with their contents removed** [trigger `tombstone_message_on_sender_delete`, migration 20260921044318; matches gradussports.com/privacy-requests] | Brief Revision §7; #41–#43 |
| 9 | Mentions the written information security program, reviewed yearly | #44 |
| A.1 | Username and audio categories; inferences from practice activity; Social Security and card wording qualified (Gradus collects neither; KWS and its processors may, during verification) | Brief Revision §2 |

## Terms of Service

Mariah kept the Common Paper Cloud Service Agreement (2026-10-11) and the Gradus Service Terms added to its Cover Page. The long-form draft Alyson quoted from Drive (**Gradus_Terms_of_Service_DRAFT_v2**, June 27) was never published; its §3.1 "Account Types" and §9 "Privacy and Children's Data" are carried into Service Terms §1 and §2 below, corrected (athletes aged 13–17 can start their own account; verified parents; four account types).

| Where | Change | Source |
|---|---|---|
| Last Updated | October 11, 2026 | — |
| Framework Terms | Says the Gradus Service Terms are among the Cover Page modifications that control | — |
| Cloud Service | "all communications are mirrored with the athlete's parents" (retired 2026-09-25) → every conversation with an under-18 includes their parent, who can read every message and pause a coach | Brief Revision §3 |
| Gradus Service Terms (part of the Cover Page) | 1 **Account types and who may use Gradus**: coaches; parents and guardians (18+); athletes (18+ own account, 13–17 limited until a parent claims it, under 13 parent-created); club or organization administrators, who work under a separate agreement their organization signs (enterprise sale, DocuSign; Mariah 2026-10-11); the parent accepts for the athlete. No age rule for coaches (Mariah 2026-10-10). 2 **Privacy and children's data**: Privacy Policy incorporated; COPPA; verified-parent consent before a minor connects or messages; parent in every minor conversation; parents review/correct/delete; usage-data consent bundled with acceptance, withdraw by email. 3 **No photos or video of athletes**: no uploading, attaching or linking images or video of athletes you coach or who use Gradus. 4 Your content and shared plans (license for share links; copies stay with adopters). 5 Safety and conduct (no off-platform contact with minors, reporting, enforcement; Gradus does not vet coaches, except where it says otherwise for coaches who sell plans, matching the site's marketplace promise). 6 Not medical advice. 7 Closing your account | #46; brief §1; AP decisions; S4 Report; consent decisions; Alyson's draft §3.1/§9 |
| Apple App Store | Apple's minimum EULA terms | Apple's instructions for developer EULAs |

## Other gradussports.com pages fixed in the same site PR

| Page | Was | Now | Why |
|---|---|---|---|
| /safesport "Parents control the account" | "can't join without a parent or guardian's verified email address" | under-13s can't create an account; 13–17 can't connect or message until a verified-adult parent claims it | Consent flows (S1); the email isn't what's verified |
| /safesport "Can a coach message a minor athlete privately?" | "always includes a minor athlete's listed parent or guardian email and/or Gradus account" | always includes the verified parent in every conversation; the parent can pause a coach | The email mirror was retired 2026-09-25 |
| /athlete-welfare "Early flags when something's off" | flags a run of hard sessions "to the coach, the parent and the club" | the AI summary on the coach's view of the athlete recommends easing the plan | Not built; only `getCoachAthleteAiSummary`'s "reduce" verdict exists. Sending a minor's mood pattern to a club would need a policy disclosure (Mariah 2026-10-11: reword to what exists) |
| /athlete-welfare "Early flags come to you" (adults) | flags hard sessions "or a pattern associated with burnout or injury" to the athlete and coach | the coach's AI summary recommends easing the plan | Not built; "burnout or injury" reads as a health inference the policy says Gradus doesn't make |

## Decisions (all resolved by Mariah)

1. **Re-acceptance (2026-10-10): bump.** The iOS app has never been published, so re-prompting every iOS user is fine. `CURRENT_TERMS_VERSION` is now `2026-10-11`. After the app publish, every iOS user with a role sees the blocking `TermsSheet` (`AppModel.termsNeeded`) once; the web records the new version at sign-up and never re-asks existing web users. This also closes the #46 follow-up (bundled usage-data consent for existing iOS accounts). If you publish on a later day, change the version and both "Last Updated" dates together.
2. **Material change email (2026-10-10): no email.** Nearly none of today's parents are active, and they will see the new terms when they move to the iOS app. Consistent with #39 A2.
3. **Publish timing (2026-10-10): publish without waiting for `PARENT_VERIFICATION_REQUIRED`.** Gradus is pre-launch; what is live today is a prototype with very few users.
4. **Coaches 18+ (2026-10-10): no age rule for coaches** (teen assistant coaches are allowed).
5. **privacy@ vs support@ (2026-10-10):** privacy@gradussports.com does not exist; §0 says support@. The "Your Privacy Choices" footer link is live (`/privacy-choices`).
6. **Terms base (2026-10-11): keep Common Paper + Gradus Service Terms**; Alyson's long-form draft stays unpublished (its two sections are carried over, corrected).
7. **Sync (2026-10-11): one copy on gradussports.com**; the app redirects.
8. **Early-flags claim (2026-10-11): reword to what exists.**
9. **AI "aggregated and anonymized" claim (2026-10-11): keep it, and disclose it** (policy §3 and §6).
10. **Clubs (2026-10-11): enterprise sale.** Clubs sign a separate agreement by DocuSign and never pay or sign up in the app; Service Terms §1 says club administrators work under it.
11. **Inactive adult accounts and athlete accounts with no birthdate (2026-10-11): kept until the account is deleted** (§12 #34 closed).
12. **Coach PDFs with pictures (2026-10-11): held for human review, no AI scan** (web #227); review requests go to support@gradussports.com.

## Still open (found in the 2026-10-11 audit; not policy text unless marked)

- ~~Share links~~ **Closed 2026-10-11 (Mariah): not a problem.** Sharing is deliberate, and an athlete's first name alone identifies no one.
- ~~Upload-screen notice~~ **Replaced 2026-10-11 by a structural rule (Mariah: prevent it structurally, human review, no AI scan): web #227.** Every coach PDF is checked on the server; one with any picture (or that can't be read with confidence) stays hidden from athletes and parents until a person releases it in Admin → Uploads to review, and each hold emails support@gradussports.com. Policy §2.1/§2.3 and Terms §3 say so (site PR #2).
- ~~Sign-up pages with no terms checkbox~~ **Resolved 2026-10-11 (Mariah): not a gap.** Clubs are an enterprise sale: they sign a separate agreement by DocuSign and never pay or sign up through the app, so club administrators are covered by that signed agreement (the terms' opening "separate Cover Page" clause, and Service Terms §1 now says so). `signup.athlete.account.tsx` is covered by the parent accepting for the athlete.
- ~~Dormant adult accounts (§12 #34)~~ **Resolved 2026-10-11 (Mariah): adult accounts are kept until their owner deletes them**, active or not; policy §7 gained an "Adult accounts" row. **No-birthdate accounts (2026-10-11, Mariah): kept the same way** (a small number of PWA-prototype accounts); they join the same row. #34 closed.
- **Android launch (policy text, when it ships):** add Firebase Cloud Messaging (Google) for push, Google Play's age signals and revoked-approval reports, Play Integrity, and Google Play in §2.4/§4.2/§5.2; the Data safety form must match (docs/android/PRD.md AD-10, AD-11, §6.13).
- **Cloud narration voice (§12 #35):** if a vendor voice (for example ElevenLabs) replaces on-device read-aloud, §6 and §4.2 need a line first, minors included.
- **Existing accounts on minor-band devices (§12 #28):** decide before California's DAAA (2027-01-01); storing the age band server-side would be a new data type for the policy and the privacy manifest.
- **Per-coach breakdown of minors' usage (§12 #22):** not built; needs a written safeguarding protocol and a policy disclosure first.
- **App Store "App Privacy" answers:** the Feedback sheet may need the Customer Support data type in the iOS privacy manifest and kit §4 (open since 2026-09-22); recheck the answers against this revision before submission.
- ~~Drive drafts~~ **Dropped 2026-10-11 (Mariah): don't worry about the Drive files.**
