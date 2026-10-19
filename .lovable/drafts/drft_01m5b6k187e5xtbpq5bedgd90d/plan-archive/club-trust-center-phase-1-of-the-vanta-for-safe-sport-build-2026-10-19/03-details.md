## Later phases (not in this build)
- **Phase 2: People readiness.** A profile for each coach (sports, levels, sign-offs, and certifications with expiry dates and reminders) and a "what I need to do" list for coaches.
- **Phase 3: Communications safety.** Coverage and policy settings only, with no message content shown by default.
- **Phase 4: Safeguarding cases.** Only after the club safety-officer roles and retention rules are agreed.
- **Phase 5: Season campaigns.** Season-long sign-off drives with reports frozen at the start and end of the season.

## Wording guardrail
Copy says "readiness" and "records", never "compliant" or "certified". Gradus shows the club's state; it does not give legal approval.

## Technical details
- **Staged migration (applied when the draft is accepted):**
  - `policy_packs(org_id, name, category, audiences text[], due_at, renew_months, archived_at)`
  - `policy_pack_items(pack_id, resource_id)`
  - Extend `resource_ack_requirements` with `due_at` and `pack_id`, and allow the `resource_id` of a Gradus resource (scoped by `org_id`).
  - GRANTs plus RLS in the same migration. Writes go through the server only and check `has_org_admin`, as in Stage 1.
- **Server:** `src/lib/trust-center.server.ts` and `trust-center.functions.ts`:
  - `getClubReadiness` combines existing data (acknowledgements, invites, `coach_athletes`, guardian links, held resource reviews, admin audit) into the counts and needs-attention items.
  - `listPolicyMatrix`, `savePolicyPack`, `exportProofPacket` (CSV, plus a PDF using the existing PDF library), and `getClubActivity`.
- **Routes:**
  - `org-admin.index.tsx` becomes the Trust Center instead of redirecting.
  - New: `org-admin.policies.tsx` and `org-admin.policies.$packId.tsx`.
  - "Soon" pages reuse `stub-page.tsx`.
- **UI:**
  - Reuse Card, Table, Tag, Eyebrow, PageTitle, FilterPill, Progress, Sheet (right side for row details, bottom sheet on mobile), AlertDialog, and sonner.
  - New shared parts in `components/org-admin/`: `StatTile`, `AttentionItem`, `StatusTag`, `ActivityFeed`, `DataTableToolbar`.
  - Add a `density="dense"` variant to Table and Card through tokens in `styles.css`.
  - Wider admin layout: `max-w-7xl` and a 12-column grid at `lg`.
  - No hover effects (`press` only), no plain Dialog, and semantic tokens only.
- **Checks:**
  - Tests for the readiness calculation (counts and overdue logic) and for non-admins being rejected.
  - Lint, typecheck and build.
  - A browser walk-through as Buddy at 1440px and at 390px.
