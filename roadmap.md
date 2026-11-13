
## Open
- [x] Part 2 Group A: coach profile, Users and Roster sections/person cells/dates/numbers and confirmation sheets complete; both themes, 390px/1280px and destructive-confirm cancellation verified. Nine tests and targeted lint pass; automatic build OK, full lint timed out. Admin identity remains unavailable in the existing DTO; no data or emails changed. Stop for review before Group B.
- [x] Part 1 club visual pass: shared layout, sidebar, table/grid/toolbar and presentation components; Coaching light/dark and mobile checked, Columns/week/profile controls verified; stop for visual review. No data or email changes. Full-project lint exceeded runner timeout; targeted lint has no errors.
- [x] Apply 20261102120000_notifications_collapse_key.sql byte-for-byte as 0033_notifications_collapse_key; column, unique index and service-only function verified. All journal migrations applied; 26 notification/push tests pass, lint zero errors; no emails or pushes sent.
- [x] Apply pending migrations: app notification inbox applied as 0032_notifications; club notifications already applied. Owner-only permissions and nightly 90-day cleanup verified; 20 notification tests pass, no emails or pushes sent.
- [x] Replace club calendar coach/day summaries with individual lessons, recorded student/guardian contacts, and accurate schedule/invite tracking; nine lessons and details verified as club admin, ten tests pass. Missing contacts are explicit; club invite delivery remains the separate Stage 5 integration below.
- [x] Review two monitoring findings: coach starting-level attribution evidence is absent in this draft, marked stale without edits; fixed voice Make/Take/Have/Note collisions while retaining existing protections and name masking. 54 regression tests pass; lint zero errors and automatic checks build OK.
- [x] Continue Org admin draft: build Schedule CSV upload, seated-coach matching, editable review, club-scoped review history and aggregate calendar; consolidate Library navigation. Authorized upload/unmatched-coach blocking and real recurring calendar verified; 62 tests pass, lint zero errors. Storage and seated matching await acceptance; no invites sent.
- [x] Continue the Gradus Club plan: add Coaches directory/profile, per-admin device-saved coach views and aggregate-only Home practice strip; investigate remaining stage dependencies without activating emails or payments.
- [x] Gradus Club redesign: reviewed uploaded PDF Settings/People layouts; preserve existing components and both themes.
- [ ] Gradus Club Stage 1: seats, contract, independent admins, People seat controls and Settings (database changes apply on draft acceptance).
  - [x] Stage seat inventory/contract columns and cross-path seat/capacity guards; add read-only Settings and internal contract editor.
  - [x] Add People seat/admin tables, guarded admin removal, and transactional coach invite acceptance.
  - [ ] Finish People role/invite/reallocation controls and saved views; new-data flow verification waits on draft acceptance. No live database changes or invite emails sent.
- [ ] Gradus Club Stage 2: notifications, safeguarding evidence, aggregate-only Home and saved table views.
  - [x] Build persistent Notifications, private append-only evidence notes, per-admin read state and aggregate-only Home notification counts; stage new storage for acceptance.
  - [ ] Verify Notifications source refresh, read receipts and note save/readback after acceptance; new storage is unavailable in this draft. Weekly practice/development rollups, saved views, acknowledgement/seat-grace feed entries and approved nightly refresh remain unfinished.
- [ ] Gradus Club Stage 3: versioned Library acknowledgements; email reminder delivery waits on Mariah choosing an existing template (none identified). No new templates or push reminders added.
  - [x] Consolidate Resources, Acknowledgements, Moves, Template plans and Levels under shared Library navigation; preserve all existing URLs.
- [ ] Gradus Club Stage 4: Coaches analytics and full coach profile pages.
  - [x] Build searchable Coaches table, week/sport/sort filters, device-saved views, CSV, full coach profile with levels and 8-week practice, and aggregate-only Home practice totals. Buddy search/profile and saved-view reload verified; 18 tests passed, lint has zero errors, latest checks report build OK.
  - [ ] Verify weekly refresh/readback after draft acceptance; new aggregate storage is unavailable here. Development/mastery/effort and prior-season metrics require reliable source definitions (session mood is not effort/mastery). Full seat/policy/template sections and cross-page saved views remain.
- [ ] Gradus Club Stage 5: club schedule import, matching, review and explicit invite sending.
  - [x] CSV upload/template, seated-coach matching, editable review with age/parent/adult validation, CSV export, transactional review snapshots and existing recurring-lesson calendar. Review storage applies on acceptance; nothing creates lessons or sends invites.
  - [ ] Complete existing-athlete matching and final lesson/invite delivery after seat/import storage acceptance; add photo/PDF/XLSX parsing, unmatched coach waiting flow, saved views and notification linkage. No safe club-scoped final delivery integration exists yet; do not reuse coach commit as an impersonation shortcut.
- [ ] Gradus Club Stage 6: storefront read side blocked on marketplace listings/sales/payout/review tables; none identified. No payment activation or fabricated revenue.
- Coach post-event competition linking workflow (in progress)
- Audit hand-rolled buttons in coach week schedule view -> shared Button (done for expanded row)
- [ ] Verify stale-chunk recovery on live after next publish
- [x] Move the coach getting-started checklist into an anchored lower-right bubble and fix dark-mode counter contrast
- [ ] Turn on email verification + raise auth email rate limit (waits on Mariah publishing the sender-name fix)
- [ ] Sign-up confirmation links via /auth/confirm so they open the iOS app (see ios-email-verification-handoff.md)

- [ ] Trust Center phase 2+: People readiness, Communications safety, Cases, Season campaigns
- [x] Implement Phase 1 club-scoped policy requirements, PDF proof packets, guardian sign-offs, and shared deadline tracking; defer naming and visual tweaks.
- [ ] Verify the policy flow as Buddy and a club member on desktop/phone after accepting the draft (requires the staged policy storage).
- [x] Build People with existing coach roster, sports, levels, CSV export and policy detail; verified Buddy's roster/detail/search. Policy read-back waits on draft acceptance.
- [ ] Add People credentials and expiry tracking next; Communications, Cases and campaigns remain later milestones.

- [x] Social plans: implement published-plan editing and coach attribution with stable links; clipboard fallbacks verified signed in.
- [ ] Verify social-plan edit/save and public coach-name read-back after draft acceptance (requires staged attribution column and transactional update).
- [x] Org admin Stage 2: template plans (build, CSV import, send by sport/level)
- [~] Club custom levels in coaches' level pickers — SKIPPED by decision (Mariah, Nov 1 2026); club levels stay admin-side defaults only
- [x] Stage 3: branded PDF resource builder (Library → Builder)
- [x] Resource builder AI writing: Anthropic workspace ID added; writing verified

## Club admin Airtable-style once-over
- [x] Step 1: Schedule Grid/Calendar (week + month), coach/invite filters, linkable views, record panel
- [x] Step 2: People and Resources (incl. Gallery) on shared grid toolbar
- [x] Step 3: Policies, Notifications, Moves, Levels, Templates on shared toolbar + ClubTable
- [x] Column show/hide, sort menu, grouping controls
- [x] Diagnose failing Bun CI runs on main (stale lesson-reminder test fake)
- [x] Club grid: Fields / Sort / Group controls (shared), Schedule lessons + Roster converted
- [x] Club panel follows device light/dark
- [x] Lesson invite sending wired (reuses family invite email); NOT test-sent per Mariah (all club data is demo)
- [x] Shared grid on People, Moves, Templates, Resources, Policies, Notifications; row click opens side panel on Resources/Moves/Templates. Levels keeps manual order (reordering conflicts with sorting)
- [x] Coaching page on shared grid (Fields/Sort/Group, totals footer, row opens coach profile); verified as Buddy
- [x] Bulk-select bar on Resources (archive/restore/export) and Templates (send/archive/restore/export); archive+restore round-trip verified, no sends
- [x] Post-publish check: Home, Notifications, Coaching, Policies, People, Schedule imports load live data; notification read receipt saves

## Real paying club, end to end (plan Nov 10)
- [x] Nov 12: Home setup checklist, Settings contract contact/seat counts, partial schedule commit and coach CSV handoff built. Existing-student lesson creation/readback, unmatched-row retention, CSV download, empty-club isolation and unauthorized access denial verified; 39 targeted tests pass, automatic checks build OK; no emails sent.
- [x] Club access follows contract dates (club tier only while contract is active); app onboarding unchanged
- [x] Internal admin → Organizations → "Contract & admins": add/remove club admins by email (first becomes owner); not test-sent
- [x] People: change admin roles, release seats, give waiting coaches a seat (invite resend/cancel already on Roster)
- [x] Schedule import: existing-roster student matching, explicit transactional lesson creation, duplicate protection and handoff to Lessons/invites. Buddy's existing-lesson import verified (0 added, 1 skipped); 20 tests pass, no emails sent.
- [x] Schedule import follow-up: fresh lesson created/read back; new students handed to each coach's existing onboarding via CSV, then rosters can be refreshed/matched. Adult invitations stay with the adult flow. Temporary lesson/imports cleaned up.
- [ ] Real email test (coach invite, family invite, reminders template choice, verification on)
- [x] Settings contract contact and Home checklist; empty-club isolation verified. Temporary empty QA club deactivated/unlisted because last-admin safeguards prevent deletion; original demo clubs preserved.
- [ ] Fresh-account signup/invite end-to-end delivery check — blocked by the standing no-test-email instruction; no new signup or invitation was sent.
- [x] Contract/seat access audit: database tier now requires an occupied seat; profile/billing reads authoritative tier and removes stale club entitlement without changing mobile signup.
- [x] No open seat: coach finishes sign-up on their own plan; club admins get a "Coach joined without a seat" notice (clears when they get a seat)
