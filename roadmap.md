
## Open
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
