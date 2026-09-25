# Privacy policy: proposed changes for counsel (2026-09-24)

Prepared for counsel ahead of the iOS 1.0 App Store submission. The published policy is <https://www.gradussports.com/privacy> (Effective June 26, 2026; last updated August 30, 2026); this repo's `/privacy` route mirrors it verbatim and changes only after counsel publishes. Section numbers below refer to the published policy.

Each item states what the product does today, the wording problem, and the proposal Mariah chose on 2026-09-24. Counsel decides the final language.

## 1. Photographs (§2.3, §5.3)

**Today.** The policy says Gradus does not collect photographs from or about athletes. Coaches can upload a photo of their lesson schedule (parsed into lessons, then kept as a file), image and PDF resources for their athletes, and the iOS app requests photo-library _add_ permission so a shared resource can be saved. None of these flows asks for a photo of an athlete, and uploads are not scanned.

**Proposal (keep the promise, add a coach rule).** Keep §2.3 and §5.3 as written. Add to the Terms of Service, and to the upload screens as a one-line notice, that coaches must not upload images or video of athletes; describe schedule photos and resource files in §2.1 as documents the coach provides ("schedule images and instructional files you upload for your athletes"). Consider a short sentence in §2.1 that uploaded files are visible only to the coach's connected athletes and their parents.

## 2. Service providers (§4.2, §6)

**Today.** The list names Supabase, Stripe, Cloudflare, ElevenLabs, Lovable Cloud and Google LLC (Workspace, Gemini). Since it was written:

- **Apple Inc.** delivers push notifications (APNs) and provides Sign in with Apple; a user who chooses Apple's private relay gives Gradus a relay email address rather than their own.
- **OpenAI** (through the Lovable AI gateway) computes text embeddings for Ask Gradus questions and library documents on the web. Ask Gradus is hidden in the iOS 1.0 app but stays live on the web.
- **Google** is also a sign-in provider (Google OAuth) on the web and, once its client ID exists, on iOS, in addition to Workspace and Gemini.
- ElevenLabs stays on the list (Mariah did not remove it).

**Proposal.** Add Apple (push delivery, Sign in with Apple), OpenAI via the Lovable AI gateway (embeddings for Ask Gradus retrieval; question text and document text only, no account identifiers), and Google sign-in to §4.2; mention Apple and OpenAI in §6 alongside Google and ElevenLabs. Keep the sentence that AI providers do not train on athlete personal information.

## 3. Personalization of practice plans (§3, §5.3, §6)

**Today.** Gradus records per-athlete _skill events_ (a move landed, parked or dropped, with the coach's optional reason) and runs a nightly job that infers an athlete's pace and seasonal trends from practice sessions and results. That profile shapes the plan drafts a coach sees and the prompts behind AI summaries. It is shown only to connected coaches, never to advertisers, and never leaves the coaching relationship. §5.3 currently promises that athlete information is not used for "behavioral profiling".

**Proposal (disclose as coaching personalization).** In §3 add a purpose: "To tailor practice plans and coaching suggestions to an athlete's own practice history and progress, for the athlete's connected coaches." In §6 describe the practice-history analysis as part of the AI-assisted features, note it is derived only from activity inside the Service, and that outputs go only to connected coaches and parents. Reword §5.3's bullet to "Do not use Athlete information for advertising, for profiling unrelated to coaching, or for any purpose unrelated to providing the Service," so plan personalization is clearly inside the Service.

## 4. Usage analytics (§2.4, §3, §7)

**Today (from iOS 1.0).** The app records which areas of the app a user spends time in (screen views and durations, Resources activity), sent to Gradus's own endpoint and stored in Gradus's own database; no third-party analytics SDK. Raw events are kept 13 months, then only weekly aggregates. Events from under-18 athletes are stored without any user identifier, carrying only the club and region of their coaches' organizations, and are reported only in groups of ten or more athletes. Users can turn analytics off in Settings on iOS. The web app sends no such events.

**Proposal.** In §2.4, name "in-app usage events (which screens you use and for how long)" and say they are collected by Gradus directly, not by an advertising or analytics vendor. Add the opt-out in Settings and the 13-month raw retention (weekly aggregates thereafter) to §7. Add to §5.3 that minors' usage events are de-identified at the point of collection and reported only in aggregate.

## 5. Voice messages (§2.1–§2.3)

**Today.** Messaging supports voice notes: audio recordings stored with the conversation and playable by the connected coach, parent(s) and athlete. Coach voice input for plan building is transcribed (already covered as speech-to-text of coach input).

**Proposal.** Add "voice messages (audio recordings) you send in the in-app messaging thread" to the communications bullets in §2.1–§2.3, and state in §7 that they are deleted with the account like other communications.

## 6. Age assurance (§5, new)

**Today.** Age is a parent-entered birthdate at athlete creation; nothing is verified. **Decided 2026-09-24 (PRD §6.13, decisions #29–#33):** every parent account linked to a minor is verified as an adult once through Kids Web Services (KWS) Parent Verification, payment card only; the iOS app also reads Apple's Declared Age Range signal on device.

**Proposal.** In §5.2: "Before a parent can connect a coach to, or message about, an athlete under 18, we confirm that the parent is an adult through Kids Web Services (Epic Games), which performs a nominal payment-card check. Gradus receives only the result and a transaction reference, never the card details." Add Kids Web Services to §4.2 as a processor (adult verification of parents; receives the parent's email address). On the device, the iOS app may request an age range from Apple; Gradus receives an age band, never a birthdate, and uses it only to route sign-up to the right flow.

## 7. Minor items counsel may want to align

- **Sign in with Apple relay emails** are a form of email address; §2 needs no change unless counsel wants "or an anonymized relay address" noted.
- **Guardian email carbon copies** (§5.2) describe the current behaviour for minors whose parent has not yet created an account; unchanged.
- **Crash reports** (§2.4) come from Apple's own crash reporting (TestFlight and App Store) rather than a third-party SDK; no change needed.
- **Location.** The app collects no device location. Only organizations (clubs) carry a city and region; "region" in the analytics section refers to those.
- **Scope.** The app is offered on the United States storefront only; §1's "within the United States" stands.

## 8. Children's accounts, consent and retention (added 2026-09-24, PRD §6.13)

**Today.** The policy says athlete accounts for under-18s require a parent's input and that parents give verifiable consent. The product did not back that: a minor of any age could sign up with any typed "parent" email and the account was live at once.

**Decided.** Under-13 athletes never create their own account; a parent creates it after adult verification. Ages 13–17 may start a provisional account that cannot connect a coach or open a conversation until a verified parent claims it. Coaches invite the parent, never the athlete, for anyone under 18. A conversation with a minor exists only with a verified adult (not the coach) as a participant, and a parent can pause a coach's messaging. Under-18 athletes send text only: no voice recordings of minors are stored or transcribed.

**Proposals for counsel.**
- §2 (what we collect from athletes): add username, messages, goals and practice logs; state that no audio is collected from athletes under 18.
- §5 (children): describe the flows above; state that the parent invite email is the COPPA direct notice; state that a provisional account or a parent's contact details are deleted if consent does not arrive within the window in PRD §12 #25 (default 30 days).
- §7 (retention): publish the written retention policy the amended COPPA Rule requires (messages, practice logs, voice notes from coaches, verification records, analytics per §4), with the deletion windows.
- Internal, not policy text: the written information-security program the amended rule requires (owner, annual risk assessment, safeguards, vendor confirmations). Counsel to advise on scope.
- Confirm whether coach voice-note transcription (ElevenLabs) needs a separate third-party-disclosure consent, or is integral to the service (Mariah's reading: integral, coach-side input only).

## What the app declares to Apple

The App Store "App Privacy" answers in `docs/ios/app-store-submission.md` §4 and the iOS privacy manifest (gradus-ios PR #58) are drafted to match the proposals above: contact info, user content (messages, audio, uploaded files), identifiers, usage data (product interaction, first-party analytics), diagnostics (crash data), none used for tracking. If counsel changes a proposal, those two must change with it.
