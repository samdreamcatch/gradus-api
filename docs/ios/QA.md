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

Test-user rule: the demo accounts are flagged as test users on the server, so their errors do not reach the admin errors dashboard; use a fresh account when checking §8.

## 1. Sign-in, sign-up, onboarding (PRD §7.1)

- [ ] Sign in with email + password; wrong password shows "Error: …" inline and is announced.
- [ ] Sign in with username (athlete) + password.
- [ ] **Sign in with Apple** on a fresh Apple ID (hide-my-email on): lands on onboarding with the relayed email; sign out, sign in again → same account.
- [ ] Google button is hidden (no client ID yet) — confirm it does not appear.
- [ ] "Remember me" keeps the identifier after sign-out; Face ID lock (Settings → Device) locks on background after the chosen delay; passcode fallback works; nothing behind the lock is reachable.
- [ ] Coach sign-up: promo code applied (Settings → Plan shows it); terms checkbox required; onboarding: name → sports → levels/hours → invite code; sample athlete and starter plan appear for figure skating; club join skippable.
- [ ] Parent sign-up: athletes (name + birthdate) → goals → schedule per coach; kill the app mid-flow and reopen → resumes at the same step.
- [ ] Minor athlete sign-up with the parent's code: identity confirmed, username availability check debounces, password set, lands in the athlete app.
- [ ] Adult athlete sign-up → coach link by code → goals → schedule.
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

## 5. Sessions (parent and athlete) (PRD §7.6)

- [ ] Start a session: timer runs, screen stays awake on the timer screen, the persistent bar follows to other tabs.
- [ ] **Live Activity** appears on the Lock Screen and Dynamic Island; pause/resume update it; End removes it.
- [ ] Background the app for 10 minutes, kill it, reopen → the timer resumes from the timestamp.
- [ ] Discard × asks for confirmation; End → feedback sheet: the submit button says why it is disabled until a state is picked; Cancel asks before discarding.
- [ ] Submit feedback offline → queued; reconnect → the coach's plan shows the flow state.

## 6. Parent and athlete settings (PRD §7.7–7.8)

- [ ] My athletes: edit name/birthdate, invite code + claim link (minors), add/remove athlete (confirmed).
- [ ] Coaches per athlete: link by code with preview, unlink (confirmed), update sports, primary coach per sport, coach visibility toggles.
- [ ] Goals editor (parent) and the athlete's own level/season-goal editor; motivation card ≤ 500 chars.
- [ ] Practice schedule per coach; reset a minor athlete's password (confirmed).
- [ ] Team plan status; guardians: invite, resend, revoke (confirmed), remove; a guardian sees the same rooms, plans and sessions.

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
