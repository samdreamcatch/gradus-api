# Coach invite code — MVP (reusable per-coach)

## Behavior summary
- Each coach owns exactly one reusable invite code, generated automatically at the end of onboarding.
- Coach can copy it and rotate it manually from onboarding (new final step) and from settings.
- Rotation invalidates the previous code immediately.
- No expiry, no max-uses, no per-parent invites in this slice. Per-parent targeted invites land with the roster slice.
- Auto-join on redeem (with coach revoke later) is a parent-side concern → not built here.

## Data model (one new table)

`coach_invite_codes`
- `id uuid` (pk)
- `coach_id uuid` (FK → `coach_profiles.id`, **unique** — one code per coach)
- `code text` (**unique**, 8 chars, Crockford base32 excluding I/L/O/0/1 to avoid lookalikes, generated server-side)
- `created_at`, `updated_at` (with the standard trigger)

RLS — scoped through `coach_profiles.user_id = auth.uid()`, same pattern as `coach_levels`:
- SELECT / INSERT / UPDATE / DELETE: only the owning coach.
- No public read. Redemption lookup will happen later inside an `auth`-elevated server fn on the parent flow, so no broad anon policy needed.

Code generation lives in a Postgres helper (`public.generate_invite_code()` returning text) so we get a single source of truth and a retry-on-collision loop inside one transaction.

### Why a separate table (not a column on `coach_profiles`)
- Keeps the unique index on `code` isolated and cheap to look up by parents later.
- Lets us extend with `kind`, `target_email`, `redeemed_at`, `max_uses` for per-parent invites in the roster slice without reshaping `coach_profiles`.
- Rotation timestamp (`updated_at`) gives a free audit trail.

## Server functions (`src/lib/coach-invite.functions.ts`)

Both protected by `requireSupabaseAuth`. Both resolve the caller's `coach_profiles.id` first (same `ensureProfile` helper pattern already in `coach-profile.functions.ts`).

- `getCoachInviteCode()` → returns `{ code }`. Creates a row on first call (so the wizard can render the code without a separate "generate" click). Idempotent.
- `rotateCoachInviteCode()` → calls `generate_invite_code()`, updates the row, returns the new `{ code }`. Server-side only — never let the client propose the code.

## Hook (`src/hooks/use-coach-invite.ts`)
- `coachInviteQueryOptions` (queryKey `["coach-invite"]`)
- `useCoachInvite()` → suspense-friendly query
- `useRotateCoachInvite()` → mutation that invalidates the query and shows a sonner toast

## UI

### Onboarding — new step between "Practice hours" and "Review"
Step 5 of 6: **"Invite parents"**
- Headline: "Share this code with parents to add their athlete to your roster."
- Big monospace code chip, "Copy code" button, subtle "Generate a new code" link with a confirmation dialog ("This will invalidate the old code. Continue?")
- "Continue" advances to Review. Review step gets a small "Your invite code" line at the bottom so it's visible before Finish.

### Settings page — new section "Invite code"
Same component as the wizard step, dropped into the settings stack with its own card and "Save" affordance unnecessary (rotation is the only action).

### Coach dashboard
Add a small "Invite code" line under the header: the code in mono, with a "Copy" button. Keeps it one tap away when a parent asks.

All three surfaces consume the same `<InviteCodeCard />` component to avoid drift.

## Design system adherence
- Code chip: `bg-elevated` border `border-divider` rounded `rounded-md`, `font-mono` `text-h3`, generous letter-spacing.
- Copy/Rotate use existing shadcn `Button` with `variant="outline"` and `variant="ghost"` respectively.
- Confirmation uses shadcn `AlertDialog`.
- Toasts via existing sonner Toaster.
- Caveat is reserved for the supporting "share this with parents" annotation under the code, at `text-lg` per the AAA rules we just landed.

## Files
**New**
- `supabase/migrations/<ts>_coach_invite_codes.sql` (table + RLS + generator function + updated_at trigger)
- `src/lib/coach-invite.functions.ts`
- `src/hooks/use-coach-invite.ts`
- `src/components/onboarding/invite-card.tsx` (shared display + copy + rotate dialog)
- `src/components/onboarding/invite-step.tsx` (thin wizard step wrapping `<InviteCard />`)

**Edited**
- `src/routes/_authenticated/onboarding.tsx` — insert the new step in the wizard, bump total-step count, thread state.
- `src/routes/_authenticated/coach.settings.tsx` — add the section.
- `src/routes/_authenticated/coach.tsx` — add the inline invite code line in the header card.

## Out of scope (deferred to roster slice)
- Parent-side redemption page, parent accounts, athlete records.
- Per-parent targeted invites with `target_email` / `redeemed_at`.
- Coach roster view, revoking individual links, link history.
- Shareable `/join/CODE` URLs and QR codes — user chose copyable code only.

## Open question (non-blocking)
Format preference: `A3K9F2X7` (8 char, no prefix, easiest to type) vs `GRADUS-A3K9F2` (branded, slightly more to type). I'll default to **`A3K9F2X7`** for typing speed unless you'd rather brand it.
