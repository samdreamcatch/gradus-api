# Gradus iOS — QA checklist (T1 onward)

The manual pass for every TestFlight build, run by Claude Code and spot-checked by Mariah (PRD §9.3, §10.6 P9). Build under test: a Release archive from `main` against **production with `API_V1_ENABLED` on**. Record results as `✅ / ❌ + note` per line, in a copy of this file named for the build number.

## 0. Accounts and setup

| Item | Value |
|---|---|
| Demo parent | `mariah.slone+1@gmail.com` (password in the shared vault) |
| Demo coach | `alyson.stemas@gmail.com` (cofounder's test coach) |
| Demo athlete (minor) | claim with the parent's athlete code from **Settings → My athletes**; username of your choice |
| Adult athlete | sign up fresh with a `+tag` email, link to the demo coach by code |
| Devices | Mariah's iPhone 17 Pro (primary), an iPad if available; the simulator only for the accessibility harness |
| Before starting | Delete the app, install the build, allow notifications when asked, keep Wi-Fi on |
| Age assurance (S3) | An iPhone on iOS 26.4 or later with Developer Mode on: Settings → Developer → Sandbox Apple Account → sign in → Manage → **Age Assurance** picks the scenario (under 13, 13–15, 16–17, 18+ self-declared or confirmed); **Revoke App Consent** sends `RESCIND_CONSENT` for `training.gradus.app`. Needs the App Store Server Notifications V2 sandbox URL set (submission kit §1). The simulator has no Declared Age Range; there, use `-GradusAgeRange under13\|teen\|teen16\|adult\|declined` |

Test-user rule: the demo accounts are flagged as test users on the server, so their errors do not reach the admin errors dashboard; use a fresh account when checking §8.

## 1. Sign-in, sign-up, onboarding (PRD §7.1)

- [ ] Sign in with email + password; wrong password shows "Error: …" inline and is announced.
- [ ] Sign in with username (athlete) + password.
- [ ] **Sign in with Apple** from the sign-in screen on a fresh Apple ID (hide-my-email on): lands on "Finish setting up" (the role chooser), not a web hand-off and not a Terms sheet; Continue stays disabled with its hint until a role is picked and the terms toggle is on; Continue as a coach → coach onboarding with the relayed email; sign out, sign in again → same account, straight to the tabs.
- [ ] **Sign up with Apple** from a sign-up form (Create an account → Parent → setup → the Apple button under Create account): dimmed with the hint until the terms toggle is on; a fresh Apple ID lands straight in parent onboarding with the athletes entered before the account. The same button with an Apple ID that already has a Gradus account signs in and says so; it does not open onboarding.
- [ ] An account with no profile (started on the web, or Apple as above) signing in with email + password: role chooser; "Sign out" there returns to sign-in; the chooser is never shown to a coach, parent or athlete.
- [ ] **No Terms sheet mid sign-up** (regression, 2026-10-02): parent and adult-athlete email sign-ups reach their onboarding with no "Our terms have changed" sheet in the way; after onboarding, Settings → Legal shows the terms accepted. The sheet still appears for an existing coach, parent or athlete after the terms version is bumped.
- [ ] Google button is hidden (no client ID yet) — confirm it does not appear.
- [ ] "Remember me" keeps the identifier after sign-out; Face ID lock (Settings → Device) locks on background after the chosen delay; passcode fallback works; nothing behind the lock is reachable.
- [ ] Coach sign-up: promo code applied (Settings → Plan shows it); terms checkbox required; onboarding: name → sports → levels/hours → invite code; sample athlete and starter plan appear for figure skating; club join skippable.
- [ ] Parent sign-up: athletes (name + birthdate) → goals → schedule per coach; kill the app mid-flow and reopen → resumes at the same step.
- [ ] Minor athlete sign-up with the parent's code: identity confirmed, username availability check debounces, password set, lands in the athlete app.
- [ ] Adult athlete sign-up → coach link by code → goals → schedule.
- [ ] **Athlete entry, birthdate first (S2, PRD §6.13 A4):** Create an account → Athlete → "I'm signing up myself" asks for the date of birth before anything else. Under 13: "Ask your parent to set you up" with "Send my parent an invite" (share sheet) and "I already have my parent's code"; back out and come in again in the same launch → still the parent-only screen; nothing is created server-side. 13–17: name plus the parent's email with the waiting-mode note; after sign-up the coach step says a coach connects once the parent confirms and Skip works; Settings → Profile shows "Waiting for your parent". 18+: name only, no email field.
- [ ] **Parent verify step in onboarding (S2, switch on):** after the parent's name and athletes, "Verify you're an adult" appears before the athletes are created; "Email me the verification link" → "Check your email…" with "Resend in 60s"; finishing the KWS check in the email (card or SSN; or opening the `/verified` link on the phone) moves the wizard to goals on its own and the athletes exist. Switch off or an already-verified parent: no step. The explanation says "a payment card or the last four digits of your Social Security number"; nothing says "card check" (decision #38).
- [ ] **Guardian claim with an unverified parent (S2):** `/g/<token>` as a signed-in, unverified parent shows the verify step above the claim button (button disabled); verified → the claim runs by itself. A `parent_unverified` refusal from the claim opens the same step instead of an error.
- [ ] **Direct notice in the flow (S5, decision #40):** the parent sign-up athletes step shows "What Gradus keeps for <first name>…" under the athlete fields ("your athletes" with two or more), ending "By continuing, you give your consent…"; "our privacy policy" opens gradus.training/privacy. The same block sits on the guardian claim above the verify step and is absent for an adult invite. Settings → My athletes → Add an athlete shows it without the consent sentence. VoiceOver reads the block as one element.
- [ ] **Declared Age Range, 13–15 or 16–17 scenario (S3, PRD §6.13 B1):** Create an account shows Apple's age-range sheet once, then only Athlete and the note "The Apple Account on this device is set up for someone under 18…"; gradus.training/signup/coach and /signup/parent links land on "Coach and parent accounts are for adults" with "Sign up as an athlete"; the athlete entry refuses an 18+ date of birth with "The Apple Account on this device says you're under 18…" and accepts a minor one (waiting mode). Sign in with Apple as a new user: the role chooser offers Athlete only; a `/g/<token>` or `/team/<token>` link shows the same block with Sign out.
- [ ] **Under-13 scenario (S3):** Athlete → "I'm signing up myself" opens straight on "Ask your parent to set you up"; a /signup/athlete/adult link does the same; "I already have my parent's code" still works.
- [ ] **18+ and decline (S3):** 18+ (self-declared or confirmed): everything as before, and a minor's typed birthdate still gets the minor flow (never loosened). Decline the sheet (or a device on iOS 18–25): the birthdate path exactly as in the S2 rows, nothing blocked. A second Create an account in the same launch does not ask again.
- [ ] Forgot password: request from the sign-in sheet (email prefilled if typed), email arrives, link completes on the web (native reset stays off until the allow-list entry exists).
- [ ] Terms gate: bump the terms version (Mariah, via admin) → blocking sheet appears on next foreground, scrolls at the largest text size, accept clears it.
- [ ] Connection celebration after a coach–athlete link; Reduce Motion → no confetti.

## 2. Universal links and invites

- [ ] `https://gradus.training/i/<coach code>` from Messages opens the app on the invite screen (signed out → sign-up carries the code; signed in as parent → connect flow).
- [ ] `/g/<token>` guardian claim and `/team/<token>` team invite open their native flows; expired tokens show the friendly state.
- [ ] `/p/<token>` shared plan opens read-only; import into the coach's library.
- [ ] `gradus://reset-password` link (once native reset is on) opens the reset cover in every phase.
- [ ] Manual code entry: the 8-character alphabet keyboard rules (no O/0/I/1 confusion), paste works.

## 3. Coach: roster, schedule, plans, voice (PRD §7.2–7.4)

- [ ] Roster week strip pages by week; today is outlined; a day's agenda lists occurrences with the athlete's flow state colour.
- [ ] Create a lesson slot (weekly / biweekly / twice monthly / monthly); edit recurring; reschedule one occurrence; cancel one; delete the series. Each change is visible on the web within a minute.
- [ ] Athlete detail sheet: title bar + Close; parent, goals, minutes, active plans, AI summary "as of" + refresh, competition results, billing.
- [ ] Add athlete with guardian email; name-conflict dialog; remove athlete (confirmed).
- [ ] **Invite recipient rule (S2, PRD §6.13 A5):** New athlete has an optional date of birth; "Who should we email?" appears only once a birthdate of 18+ is entered, otherwise the email field is the parent's and the note explains why. The roster "waiting for parent" state is not in this pass (the roster API has no guardian-claimed field yet; follow-up web wave).
- [ ] Invite code: share sheet, copy, rotate (confirmed) → old link stops working.
- [ ] Practice targets set/clear; roster limits and default expectations in Roster settings.
- [ ] Pre-lesson briefing loads, caches, refreshes.
- [ ] Lesson wrap-up prompt after a slot ends (push while backgrounded, card on foreground): Edit plan / Re-deploy / Dismiss, once per athlete per day.
- [ ] Schedule import: photograph a printed schedule → review screen announces the athlete count → commit adds slots.
- [ ] Plans list filters (Active / Drafts / Benched / Templates × athlete × sport); swipe to delete a draft (confirmed); Bench asks for confirmation; two-active-plans cap gives the friendly message.
- [ ] Plan editor: add moves from the library, reorder, inline edits, save to library, remove; template → clone.
- [ ] Voice FAB: hold to record ≤ 90 s, cancel by slide, transcript → new plan with AI-touched fields highlighted; edit mode on an open plan.
- [ ] Starter program adopt; share plan → `/p/<token>`.

## 4. Messaging (PRD §7.5) — all roles

- [ ] Rooms list unread badges match the tab badge and the app icon badge.
- [ ] Send text, receive on the web in realtime; read marks update.
- [ ] Record and send a voice note (M4A); it plays on the web; its **transcript** appears under the bubble within a minute (or "Transcript coming").
- [ ] A voice note recorded on the web (WebM) shows its transcript on iOS even though it cannot play.
- [ ] Plan-tagged message from "Message coach about this plan"; tapping the tag opens the plan.
- [ ] Report a message (reason, note; "Also block" is off by default); block from the room header; blocked list in Settings; unblock.
- [ ] Airplane mode: send a message → "Waiting for a connection", reconnect → sends; delete an unsent message (confirmed).
- [ ] **Minors send text only (S2, decision #32):** signed in as a minor athlete, the composer has no microphone; VoiceOver's hint on the message field says voice notes are off for athletes under 18. A coach or parent in the same room still sees the mic.
- [ ] **Report to Gradus (S4, Guideline 1.2):** the Safe Sport panel (athlete Resources, and Settings → Safe Sport) has "Gradus Support" between the disclosures and the hotlines: Report this message, support@gradussports.com (opens Mail), "We respond within one business day", and that Gradus isn't an emergency service. Same card on the web panel. Long-press a message → Report this message → the report email reaches the team; a minor-safety reason is marked [URGENT].
- [ ] **Parent pause (S2, PRD §6.13 C):** parent pauses a coach from My athletes → that athlete's room shows the paused notice instead of the composer for the parent, the coach and the athlete; a send attempted from the web answers with the server's own words; Resume restores the composer on the next open.

## 5. Sessions (parent and athlete) (PRD §7.6)

- [ ] Start a session: timer runs, screen stays awake on the timer screen, the persistent bar follows to other tabs.
- [ ] **Live Activity** appears on the Lock Screen and Dynamic Island; pause/resume update it; End removes it.
- [ ] Background the app for 10 minutes, kill it, reopen → the timer resumes from the timestamp.
- [ ] Discard × asks for confirmation; End → feedback sheet: the submit button says why it is disabled until a state is picked; Cancel asks before discarding.
- [ ] Submit feedback offline → queued; reconnect → the coach's plan shows the flow state.

## 5a. Athlete-authored plans (PRD §6.14, §10.10 AP4, decision #35)

Run on a build that carries web AP1/AP2 (migration applied, API published) and iOS AP3. Use an adult athlete, then a 13–17 athlete, then a parent and a coach linked to each.

- [ ] **Create:** Plans tab → "+" opens an empty editor with the title being edited; the Activate button is disabled and says why ("Give the plan a name…", then "Add at least one move…"). Name it, add moves from the library → Activate → back on the list, captioned **Mine**, with no coach line.
- [ ] **Library:** the Library segment lists only the curriculum for the athlete's sport(s), grouped by category, searchable, read-only; an athlete with no sport on their goals sees the empty state that points to Goals. No way to create, edit or archive a library move.
- [ ] **Editor:** edit title, notes, a move's target/cue/why, reorder, remove a move (no "why?" prompt), bench (no prompt, no cap: activate three plans, none is benched), delete a draft or benched plan; an active plan asks to be benched first. There is no assignment row, no template option and no "save to library".
- [ ] **Drafts and filters:** a draft shows under Status → Drafts and opens in the editor; "Mine" filters to the athlete's own plans; the coach filter never lists the athlete as a coach.
- [ ] **Practice:** an own active plan opens the runner (timer, feedback sheet) with an Edit button; the timer toast never says "Coach …"; there is no "Message coach".
- [ ] **Voice (adult, then minor):** the mic on the Plans tab and in the editor builds a draft / edits the plan; the overlay says the recording isn't kept; the plan shows "What you dictated" with the same promise; a spoken athlete name is ignored. Offline: the clip waits on the device and is sent when back online, then is gone. **Server:** nothing in the logs but counts (`[voice] applied (athlete)`), no audio in storage.
- [ ] **Share and adopt:** an active own plan → Share → a link whose public page reads "Plan by *first name*" (no last name anywhere). Open it signed in as another athlete → "Add to my plans" → the copy lands **active**, titled "… (from *first name*)". As a coach → "Save to my library" (a benched template, as before). A coach rostered to the author **cannot** mint a link for the athlete's plan.
- [ ] **Coach and parent views:** a rostered coach sees the plan on the athlete's detail captioned "By *first name*", read-only, only while active or benched (never a draft); a parent sees it as "By *first name*" and can log practice on it. Nothing here appears on the web (PWA unchanged).
- [ ] **Offline:** edit title, notes and moves offline → "Saved — it syncs when you're back online"; reconnect → the edits land once each. Activating offline queues the status change; creating a plan and adding moves from the library need the network and say so.
- [ ] **Paused athlete** (sandbox `RESCIND_CONSENT`): they can still read their plans; creating, editing, activating, sharing and voice are refused with the paused message; their old share links stop resolving.
- [ ] **Accessibility:** VoiceOver reads each control with a label and state; the blocker text is read; at the largest text size nothing is cut off (move names wrap, the action bar and the voice overlay stack, the overlay scrolls); Increase Contrast and dark appearance keep every control legible; targets are at least 44 pt; Reduce Motion shows no animation.

## 5b. Read this plan aloud (PRD §6.15, W1 iPhone; decision #47)

Any role, any plan with moves. On the device, download one Premium American English voice first (Settings → Accessibility → Spoken Content → Voices → English), then repeat the voice rows without it.

- [ ] **Interrupted sample:** start a sample, then trigger Siri or a call → the button goes back to Play; a sample also stops when Gradus goes to the background.
- [ ] **Read:** plan detail → "Read this plan aloud" → the player bar pins to the bottom; the title, then each move with its target, cue and why, in order; the move being read is highlighted and scrolled to; Previous, Pause/Resume, Next, Repeat and the three speeds work; Done closes it and VoiceOver returns to the start button.
- [ ] **Automatic voice:** with no voice chosen, Settings → Device → Read-aloud voice shows "Automatic (*name* · *quality*)"; the most natural American English voice installed is the one that reads, a woman's when a natural (Enhanced or Premium) woman's voice is installed, even if a man's voice is Premium. With only Standard voices, the Automatic row says to download a Premium voice.
- [ ] **Choose a voice:** pick another voice → the checkmark moves, the Device row shows its name and quality, and the next read uses it. Each row's play button speaks a short sample in that voice; tapping it again (or leaving the screen) stops it. Automatic goes back to the default.
- [ ] **Voice removed:** delete the chosen voice in iOS Settings, return to Gradus → the Device row and the picker fall back to Automatic, and reads use the Automatic voice (not the system default).
- [ ] **Accessibility:** VoiceOver reads each voice as its name, quality and language, with "Selected" on the chosen one, and each sample button as "Play a sample of *name*, *quality*" (two qualities of one name, such as Samantha Standard and Enhanced, are told apart); at the largest text size the rows wrap and nothing is cut off.

## 6. Parent and athlete settings (PRD §7.7–7.8)

- [ ] My athletes: edit name/birthdate, invite code + claim link (minors), add/remove athlete (confirmed).
- [ ] Coaches per athlete: link by code with preview, unlink (confirmed), update sports, primary coach per sport, coach visibility toggles.
- [ ] Goals editor (parent) and the athlete's own level/season-goal editor; motivation card ≤ 500 chars.
- [ ] Practice schedule per coach; reset a minor athlete's password (confirmed).
- [ ] Team plan status; guardians: invite, resend, revoke (confirmed), remove; a guardian sees the same rooms, plans and sessions.
- [ ] **Verification in parent Settings (S2, decision #34):** switch on and unverified → a "Verification" group with the required copy; switch off but KWS configured → the opt-in copy ("Soon, every parent…"); verified (including legacy parents) → no group. "Email me the verification link" → waiting state → the group disappears when the webhook lands, without leaving the screen. KWS not configured → the step says it isn't switched on yet and offers no button.
- [ ] **Login code waits for verification (S2):** with the switch on, an unverified parent's minor shows "…login code appears here once you've verified" instead of a code; after verification the code appears.
- [ ] **Pause/Resume messaging per coach (S2):** the coach's ⋯ menu on My athletes → athlete has "Pause messaging"; the row shows a "Messaging paused" tag; "Resume messaging" clears it. Offline → "You're offline" and nothing changes.

## 7. Resources, Live Board, billing, settings (PRD §7.9–7.12)

- [ ] Library PDFs open in the viewer, cache for offline, share; coach upload and delete.
- [ ] Ask Gradus (parent persona and youth persona); save an answer; remove (confirmed); minors cannot reach Ask Gradus.
- [ ] Safe Sport panel: call/text/website actions say they leave the app.
- [ ] Live Board: open a live competition by code; follow a skater; attendance is recorded (recap prompt next day); **Live Activity** for a followed skater starts from a push without the app open, updates on scores, ends with the event.
- [ ] Home Screen widget shows the followed skater's lane; tapping opens the board.
- [ ] Competition results linking, post-event card ("No one competed" confirmed), generate a plan from results.
- [ ] Billing: plan status banners; "Manage your plan" opens Safari; athlete rates, draft invoice from lessons, create, mark paid, share, delete unpaid (confirmed).
- [ ] Settings: profile, appearance (light/dark/system), account & security (change password, change email, **delete account** — the impact preview lists everything, typed confirmation, and for a Sign in with Apple account the Apple credential is revoked: Settings → Apple ID → Sign in with Apple no longer lists Gradus), device (push toggle reflects the permission state), legal (opens Safari, licenses screen), feedback, sign out, connections hub, pending changes.

## 8. Cross-cutting

- [ ] **Push:** new message, new/activated plan, invite accepted, lesson reminder, wrap-up prompt, recap prompt each arrive with the right copy and deep-link to the right screen; tapping while the app is killed opens the target.
- [ ] **`RESCIND_CONSENT` (S3, PRD §6.13 B4), sandbox:** sign in on a TestFlight build as a minor athlete on the sandbox device (that sign-in binds the download), then Sandbox Apple Account → Revoke App Consent → `training.gradus.app`. Within minutes: the parent and every linked coach get "…'s Gradus account is paused" pushes (parent → My athletes, coach → Roster); the athlete's Settings → Profile shows "Your account is paused"; the parent's athlete page shows "Account paused"; sends in that athlete's rooms are refused with the server's message; Lovable → Cloud → Logs has no `[app-store] … refused` line. Revoking again sends no second push (the athlete is already paused).
- [ ] **Restore after `RESCIND_CONSENT` (PRD §12 #29), sandbox:** after the row above, open web Admin → Membership → **Paused athletes**. The athlete is listed with the pause date, the parent and "restores to active". **Restore account** stays disabled until the support-request note has 3+ characters; restore. The row disappears; the athlete's Settings no longer shows "Your account is paused" and their rooms accept sends again. Sign out and back in on the same device (the app re-reports the download): the athlete is **not** paused again. A sibling on the same download, if any, stays listed until restored. Revoke App Consent again from the sandbox account: the restored athlete is paused again.
- [ ] **Significant change (S3, PRD §6.13 B2–B3):** 1.0 ships no significant change, so on a device this only appears after an App Store age-rating change. Under-13/13–17 sandbox scenario with a pending change: "Ask a parent to approve this update" covers the app; "Ask my parent" sends Apple's request; approving on the parent's device opens the app; declining shows the declined line and "Ask again". 18+ "significant change applicable": Apple's acknowledgment sheet once. Simulator check: `-GradusSignificantChange "<text>"`.
- [ ] **No Apple Account prompt (S3 regression):** on a device or simulator signed out of the App Store, launching the app as any role never shows "Sign in to Apple Account".
- [ ] Badge count clears when the rooms are read.
- [ ] Presence: coach shows as recently seen on the web after the app foregrounds.
- [ ] Feature flags from `/meta/config` (paywall, Coach Pro, Founding cutoff, minimum version); the force-update screen appears when the minimum version is raised and its button opens Safari.
- [ ] Error boundaries: pull the network mid-load on each tab → "Try again" recovers.
- [ ] **Error reporting:** trigger a caught error on a non-test account (e.g. open a plan link with a bad token) → it appears in the admin errors dashboard tagged `platform=ios` with version and build; after a forced crash (debug menu), the MetricKit diagnostic arrives on the next launch.
- [ ] Haptics on primary actions and outcomes; none on scroll.
- [ ] Landscape on every tab and in the Live cover; iPad: Live is a tab, split-screen reflows.

## 9. Offline scenarios (airplane mode)

- [ ] Launch with no network: cached roster, plans, rooms, library render with the offline banner; the Live Board shows the last snapshot with its age.
- [ ] Make changes offline (lesson slot, plan edit, message, feedback) → Pending changes screen lists them → reconnect → they sync in order, conflicts surface as toasts.
- [ ] Kill the app while offline with pending changes → reopen → still pending → sync on reconnect.
- [ ] Sign out while offline is refused with a clear message (pending changes would be lost).

## 10. Accessibility spot checks

Run `docs/device-accessibility-script.md` (gradus-ios repo) once per build: VoiceOver, Switch Control, Voice Control, Full Keyboard Access, largest text size, Increase Contrast, Reduce Motion, iPad.

## 11. Sign-off

| Build | Date | Sections passed | Blockers | Signed |
|---|---|---|---|---|
| | | | | |
