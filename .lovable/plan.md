## Goal

Replace the current "Club" branch (single opaque code input) with the workspace-picker pattern coaches already recognize from Slack/Notion/Linear: **search your org → confirm it → prove you belong**. If the club isn't listed, one tap sends a share-sheet message to their leadership and drops them into the existing Individual path so momentum isn't lost. At the same time, model organizations richly enough that Gradus can later push **club-owned move libraries, plan templates, and resources** to every coach in that org.

## Reuse-first component rules (non-negotiable)

Every new UI piece must lean on existing primitives before anything bespoke gets built:

| Need                              | Existing primitive to reuse                                              |
| --------------------------------- | ------------------------------------------------------------------------ |
| Two-choice picker (Individual/Club) | `CoachPathChoice` + inner `PathCard` — already built, don't fork          |
| Search combobox                   | shadcn `Command` inside `Popover` — the same pair used by move/sport pickers, top-anchored on mobile per overlay doctrine |
| Selected-org "chip"               | `<Chip>` primitive (see `sport-chip.tsx`) with a "Change" affordance      |
| 8-char code input                 | Reuse the existing `OrgCodeField` block inside `coach-path-choice.tsx` — extract it into `src/components/onboarding/org-code-field.tsx` so the not-listed → listed flow and admin tools can share it |
| Outreach card                     | Standard `bg-card` + `border-divider` + `shadow-card` shell, `Button` (primary/secondary), `Textarea`, `Label` — no new surface tokens |
| Confirmation toast                | Existing `sonner` toast used across admin pages                          |
| Admin "Club requests" tab         | Reuse the exact table pattern in `admin.organizations.tsx` and `admin.promo-codes.tsx` (Eyebrow headers, `Switch`, `Copy`/`RefreshCw` icon buttons) |

Any new file must be pure composition of the above — no new color tokens, no new shadow variants, no new radii. Reject bespoke styling in code review.

## New onboarding flow (Club branch only)

```text
[ Individual coach ]   [ Part of a club ]
                          │
                          ▼
                ┌────────────────────────┐
                │  Find your club        │
                │  🔍 [ Search box     ] │  ← Command + Popover
                │  ─ Elite FSC · Ashburn │
                │  ─ Rockville Skating…  │
                │  My club isn't listed →│  ← always-visible row
                └────────────────────────┘
                  │                   │
       club picked│                   │not listed / no code
                  ▼                   ▼
        ┌─────────────────┐   ┌────────────────────┐
        │ [Chip: Elite ×] │   │ Message my club    │
        │ Enter club code │   │ [ Share ] [ Copy ] │
        │ [• • • • • • •]│   │ mailto: · sms: fallback
        │ No code? Message│   │ ↓ after send       │
        └─────────────────┘   │ Continue as        │
                              │ Individual         │
                              └────────────────────┘
```

### Sub-step A — Find your club

- `Command` combobox, debounced against `searchOrganizations` (public read-only server fn).
- Each row: org name + city/region (avoids "Ashburn Ice House" vs "Ashburn FSC" confusion).
- Empty-search state: recent/popular orgs (top 8 by coach count).
- No-results state ends with a persistent **"My club isn't listed — tell them about Gradus →"** row. Same link sits below the input at all times.

### Sub-step B1 — Club found → enter code

- Selected club renders as a `Chip` at the top with a "Change" affordance.
- Reused `OrgCodeField` validates via `verifyOrgCodeForOrg({ orgId, code })` (new signature — the old "any code works" claim is replaced so a coach can't accidentally join the wrong club with someone else's code).
- Secondary link: **"I don't have a code yet — message my club"** → sub-step B2 with the club pre-selected.

### Sub-step B2 — Not listed (or no code) → outreach

Single card with:

- Headline: *"Let's get {Club name / your club} on Gradus."*
- Message preview (editable `Textarea`, default copy pre-filled):
  > "Hey — I want to use Gradus to plan lessons and track progress for the athletes I coach at {Club}. It's free for coaches if the club joins. Take a look? gradus.training/for-clubs"
- Editable club name (pre-filled if picked from list).
- Primary **Share with my club** → `navigator.share({...})`; falls back to **Copy message** with `mailto:` + `sms:` links underneath on desktop / unsupported browsers.
- After share/copy (or "I'll send it later"), confirmation state with primary CTA **"Continue as Individual for now"** and helper: *"When {Club} joins, we'll switch you over automatically — no double-charging."*

Choosing that CTA sets `path = "individual"` and drops into the existing PromoCode + Stripe paywall. Nothing about the Individual branch changes.

## Data model — built for future club-level content pushes

This is the part that unlocks "clubs can ship move libraries, plan templates, and resources to their coaches later." We put the ownership column in place now, even though only Gradus admins write to it initially.

### `organizations` — additive columns

- `city text`, `region text`, `logo_url text null`
- `is_listed boolean default true` — admins can hide test/dead orgs from search
- `content_version int default 0` — bumped when the org pushes new shared content, used later to trigger per-coach sync

### `organization_leads` (new)

- `requested_org_name`, `requested_org_city`
- `coach_user_id`, `coach_email`
- `channel` (`share` | `copy` | `mailto` | `sms` | `later`)
- `message_body`
- `status` (`pending` | `contacted` | `converted` | `dismissed`) — admin-managed
- RLS: coach INSERT/SELECT own; admins SELECT/UPDATE all via `has_role`
- GRANTs: `SELECT, INSERT` to `authenticated`; `ALL` to `service_role`

### Content ownership — forward-compatible, no coach-facing UI yet

Three existing tables (`moves`, `plans`, `resources`) each get **two nullable columns in the same migration**:

- `organization_id uuid null references organizations(id) on delete set null`
- `is_org_template boolean default false`

Semantics:

- `organization_id IS NULL, coach_id IS NOT NULL` — today's normal per-coach row. Unchanged.
- `organization_id IS NOT NULL, is_org_template = true, coach_id IS NULL` — a **club template**, authored by a Gradus admin (later: by a club admin). Not visible to athletes directly.
- `organization_id IS NOT NULL, coach_id IS NOT NULL, is_org_template = false` — a **coach's copy** of a club template, materialized when they join or when the club pushes an update.

Fan-out mechanism (built later, but reserved now):

- A `seed_org_library(_coach_id, _organization_id)` function mirroring the existing `seed_coach_library` — runs on club-code claim, inserts a per-coach copy of every `is_org_template` row for that org whose `sport` matches the coach's `coach_levels`, respecting name-dedupe.
- When admins push updates, they bump `organizations.content_version` and a follow-up job re-runs the seed for coaches whose `last_synced_content_version < content_version`.
- Coach's own edits fork (copy-on-write): editing an org-sourced row nulls its `organization_id` link so future pushes don't overwrite personal changes. Details land with the actual push feature — the column is enough for now.

RLS additions on `moves` / `plans` / `resources`:

- Coaches SELECT org-template rows for their `organization_id` (read-only, so admin tooling can preview coach-facing content) — narrow policy, no writes.
- All existing per-coach policies continue to work because `coach_id` still drives them.

### `coach_profiles` — one column for future sync

- `last_synced_content_version int default 0` — lets us push updates incrementally later. Zero UI impact today.

Skipping this now means a schema migration on every table when the push feature ships. Doing it in the same migration as the search redesign is nearly free and avoids a second heavy migration.

## Server functions (`src/lib/coach-org.functions.ts`)

- `searchOrganizations({ query })` — public read-only via server publishable client + narrow `TO anon` SELECT policy on `organizations` (columns: `id, name, city, region, logo_url`, filtered `is_listed = true, active = true`). Returns up to 8 prefix-weighted matches.
- `getPopularOrganizations()` — same shape, top 8 by coach count, for empty-search state.
- `verifyOrgCodeForOrg({ orgId, code })` — replaces "any code works." Validates code belongs to the chosen org before entitlement flips.
- `claimOrganizationInviteCode({ code })` — existing; unchanged externally, internally also stamps `last_synced_content_version = organizations.content_version` so the first push after this coach joins is scoped correctly.
- `createOrganizationLead({ requestedOrgName, requestedOrgCity, channel, messageBody })` — auth-required.
- **Reserved names** (empty stubs OK, not built now): `listOrgTemplates(kind)`, `pushOrgContent({ orgId })` — so the admin route can already link to placeholder tabs without churn later.

## UI components (all composed from existing primitives)

- `src/components/onboarding/org-search-combobox.tsx` — `Command` + `Popover` wrapper, top-anchored on mobile.
- `src/components/onboarding/org-code-field.tsx` — **extracted** from the current inline block in `coach-path-choice.tsx` so it's reusable in both flows and testable in isolation. No visual change.
- `src/components/onboarding/org-not-listed-card.tsx` — outreach card built from `bg-card` shell + `Textarea` + `Button` pair + toast.
- `src/components/ui/chip.tsx` — already exists; reuse for the selected-org chip (do not create a new "OrgChip").
- Refactor `coach-path-choice.tsx` so the "Club" branch is a small state machine: `search → (enter_code | not_listed) → confirmed | fell_back_to_individual`. The existing `PathCard` and card shell are untouched.

## Admin surface

Extend `src/routes/_authenticated/admin.organizations.tsx` with three tabs (using the existing table + Eyebrow header pattern already in that file — do not introduce a new tabs component if `Tabs` from shadcn isn't already imported nearby; reuse whichever pattern the sibling admin pages use):

1. **Organizations** — today's table (name, code, coach count, active toggle) + new inline fields for `city`, `region`, `logo_url`, `is_listed`.
2. **Club requests** — `organization_leads` list with quick actions: *Mark contacted*, *Create org from lead* (prefills name/city), *Dismiss*.
3. **Content** (stub, reserved) — empty tab labelled "Move libraries, plan templates, resources" with a "Coming soon" state, wired to the reserved server fns above so the route doesn't need a rewrite when the push feature ships.

## Copy (final)

- Search placeholder: *"Search by club, academy, or association name"*
- Empty search: *"No matches. Your club may not be on Gradus yet — [tell them about it]."*
- Not-listed headline: *"Let's get your club on Gradus."*
- Post-share confirmation: *"Nice — we'll notify you if {Club} joins. Keep going as an Individual coach for now."*

## Explicitly out of scope (this turn)

- The actual push mechanic for org-owned moves/plans/resources — the columns and RLS land now, the fan-out UI ships in a follow-up.
- Club-admin self-serve dashboard — org + content authoring stays Gradus-admin-only.
- "Waiting for club" entitlement state — per prior answer, coaches fall back to Individual.
- Any change to the Individual branch, promo codes, Stripe wiring, or existing design tokens.
