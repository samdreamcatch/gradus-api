## Delivery stages

### 1. Seats, contract, admins and Settings
- Add contracted coach/admin seats, storefront terms, contract dates and optional agreement reference only where no equivalent exists.
- Add explicit seat rows and invite reservations. Keep seat claims, acceptance, release and reallocation transactional so concurrent invites cannot exceed capacity.
- Backfill existing memberships without revoking access or overwriting existing contract values. Reconcile legacy seat limits before sizing seat rows; do not default existing clubs to zero usable seats.
- Preserve the departing coach's existing 90-day access grace when a seat is reassigned. Prevent releasing filled seats merely to shrink the contracted inventory.
- Admins occupy admin capacity, not coach capacity. Keep authorization roles separate from free-text club job titles; enforce last-owner and last-admin protections server-side.
- Staff edits contract terms in Internal Admin → Organizations. Club admins see them read-only.
- Put staff, seats, invites and release actions in **People**; Settings keeps **Club page and Contract**. This follows the brief's explicit “seats and admins move here from Settings” direction rather than duplicating management on both pages.
- Establish shared table/search/filter/view patterns and the new navigation as their real pages are delivered; preserve old URLs with redirects.

### 2. Notifications and Home
- Keep **notifications** separate from underlying safeguarding cases/notes. Define each clearly instead of creating two competing copies of the same feed.
- Add read state **per admin**, not one shared read flag that marks notifications read for every admin.
- Gather actionable signals from unjoined guardians, reports, blocks, held uploads, messaging pauses, acknowledgements, expiring grace and outstanding coach invites. Import/payout signals follow when those systems exist.
- Sweep source conditions idempotently; auto-resolve cleared conditions. Report rows expose status only, never private message content, and withhold coach attribution.
- Reuse existing guardian invite paths. Notes append-only; send actions explicit. No new push or email templates.
- Add coach-week aggregates and source-backed historical comparisons. Audit practice logs, expectations, difficulty, level history, mastery and results first. Show unavailable comparisons as unavailable, never fabricate them.
- Home: Practice, Development and Notifications metrics; coach rollup table; three actionable notifications; handbook, seats and import status. Eight-week sparklines use actual available history.

### 3. Library and versioned acknowledgement
- Consolidate Resources, Moves, Template plans and Levels under Library tabs, preserving current pages and legacy links.
- Resources presentation: document inventory, selected document group coverage, person standing and version history, stacked vertically.
- Reconcile existing `resource_*` and staged `club_resource_*` policy/evidence models before adding version references; preserve every historical signature and Gradus-owned resource isolation.
- Major/minor version flow with required change summary and upload review before publication. Minor versions retain standing; major versions requiring reacknowledgement make prior signers outdated.
- Signing records typed name, role, represented minor, version, summary shown and time. One parental signature per minor; signatures remain append-only.
- Reminders reuse an existing suitable template, log one send per click and enforce seven days between sends per version. Ask only if no existing template fits.

### 4. Coaches analytics and profile
- Replace roster presentation with week/sport-filtered coach totals and last-season comparisons. Reuse the existing invite flow with seat enforcement.
- Full coach profile page: aggregate KPI strip, profile facts, development by level, eight-week practice and CSV export.
- Existing coach message action and Open in People. No athlete identities or seat-release action on this analytics page.

### 5. Schedule import
- Reuse current photo/PDF/CSV/XLSX parsing with club-scoped imports and rows.
- Upload → match coach names to seated coaches → review grouped lessons/skaters → explicitly send invites. Unmatched coaches can be invited into available seats; their rows wait for acceptance.
- Decisions and missing email requirements block sending. Validate adult/minor routing using existing age/guardian rules; uncertain ages require a decision.
- Existing athletes receive lessons without duplicate invites. Send only through existing guardian/adult invite paths and honor the no-new-email-template rule for coach change notices.
- Import history and calendar tab; waiting invites link to Notifications, not a new Safeguarding navigation item.

### 6. Storefront read side
- Inspect actual marketplace tables before wiring listings, sales, split breakdowns, reviews, payouts and member codes. Do not simulate unavailable marketplace data.
- Contract club cut applies only to coaches currently on club seats. Display the specified platform → club → coach split and coach-paid card fees.
- Monthly payouts on the third, payment activation and marketplace creation are **not silently enabled** by this panel work. Member-code writes require the corresponding marketplace capabilities.

## Technical and acceptance checks
- Retain authenticated TanStack server functions; authorize the organization via the caller before importing privileged clients. New role, capacity and seat changes must be transactionally enforced.
- Stage additive migrations in this draft; **database changes apply when the draft is accepted**, not during preview. Each stage needs its database update accepted before dependent end-to-end checks and the next stage's activation.
- Every new organization-owned table has organization scope, explicit GRANTs and RLS, no anonymous reads, and member-own reads only where required. Child notes/version/reminder rows carry verifiable organization scope. New organizations columns include authenticated column SELECT grants.
- No live bulk backfills, schedules, email sends or payment changes without required confirmation. No missing-schema stubs to make preview appear operational.
- Pure tests for grace/capacity/last-owner rules, version standing and reminder cooldown; privacy response tests; anonymous and cross-org access checks; existing column-grants test. Run relevant tests and lint, then inspect automatic typecheck/build results.
- Verify real authorized flows, coach-without-seat independence, both themes, desktop tables and smaller screens. Leaf pages each get distinct Gradus metadata.

**Before implementation:** review the PDF mockups when attached. The current upload contains the written brief only. Marketplace availability and some historical metric sources need code/schema verification; they do not block Stage 1.