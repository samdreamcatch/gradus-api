
# Share a plan to socials (coach-only, permanent link)

Coach taps **"Share to socials"** on any of their plans, gets a permanent public link they can drop into iMessage, Instagram, or TikTok. The link opens a public, athlete-anonymized view. Any signed-in **coach** can tap "Save to my library" and get a template + any custom moves copied into their own library.

## Why this fits the current architecture

- `plans.kind` already supports `'template'`, and `createPlan({ fromPlanId })` already snapshots title/notes/plan_moves. The import flow reuses both.
- `plan_moves` are already denormalized (name/cue/why/target) with an optional `move_id` link to the source coach's library. That is exactly what we need to (a) render publicly with zero library joins and (b) materialize "custom" moves into the importer's own library.
- Nothing athlete-specific lives on `plan_moves`; the only PII on a `plan` is `athlete_id`. Stripping = ignoring that column on the public read. "Always shared as a template" falls out for free.

## Button placement and label

The existing plan detail header already uses **"Assign to athlete"** for the athlete-side action. The new social action sits next to it, styled as a secondary button:

- **Assign to athlete** (existing) — unchanged.
- **Share to socials** (new) — `Share2` icon, no helper text.

## Coach-only, permanent link

- Link is generated once and never revoked. No "Stop sharing" affordance.
- Importing is gated to accounts with a `coach_profiles` row. Signed-out or non-coach viewers see the read-only template view; import button is disabled for non-coaches, and signed-out viewers get a "Sign in to save" button that routes to `/auth?redirect=/p/{token}`.

## User flow

1. Coach opens a plan → header shows **Assign to athlete** and **Share to socials**.
2. First tap on Share to socials generates a random `share_token`, stamps `shared_at`, and opens the OS share sheet with `https://gradus.training/p/{token}` and caption `"{title} — a workout I put together on Gradus."` Subsequent taps reuse the same token. If `navigator.share` isn't available (desktop), we fall back to copy-link with a toast.
3. Public route `/p/$token` (top-level, SSR, no auth) renders: coach first name, plan title, notes, ordered move list (name, cue, description, why, target). No athlete name anywhere. OG/twitter meta set from the plan for link previews in iMessage/IG DMs.
4. Footer CTA: **Save to my library**.
   - Signed out → routes to `/auth?redirect=/p/{token}`.
   - Signed in as coach → import runs, redirect to `/coach/plans/{newId}`.
   - Signed in but not a coach → button disabled.

## Import semantics (custom-moves-follow-the-plan)

When a coach imports:

- Insert a new `plans` row: `kind='template'`, `status='benched'`, `athlete_id=null`, title `"{source title} (from Coach {firstName})"`.
- For each source `plan_move`:
  - If importer already has a library move with matching `sport` + `name`, link `plan_moves.move_id` to it.
  - Otherwise insert a new row into `moves` under importer's `coach_id` (copying name, description, cue, why, sport, category, default targets) and link the new `plan_moves.move_id` to it.
- Net effect: importer's library gains any moves they didn't already have, and the imported template's moves point at their own library rows — ready to reuse.

## Public read: one SECURITY DEFINER RPC, no anon RLS changes

To avoid loosening RLS on `plans` / `plan_moves`, expose one Postgres function `public.get_shared_plan(_token text) returns jsonb` (security definer). It resolves the token, joins the coach's first name, and returns the safe shape with `athlete_id` explicitly dropped. `GRANT EXECUTE ... TO anon, authenticated`. Import uses a second RPC `public.import_shared_plan(_token text) returns uuid` that runs under `requireSupabaseAuth`, verifies caller has a `coach_profiles` row, and does the insert + move-library reconcile in one transaction. All anonymization and coach-only gating live in these two functions.

## Schema change (single migration)

```text
plans:
  + share_token  text unique  (nullable)
  + shared_at    timestamptz  (nullable)

RPCs (same migration):
  public.get_shared_plan(_token text)     returns jsonb  -- security definer, EXECUTE to anon+authenticated
  public.import_shared_plan(_token text)  returns uuid   -- security definer, coach-only, EXECUTE to authenticated
```

No changes to existing RLS policies on `plans`, `plan_moves`, or `moves`.

## New / changed files

- Migration: columns + two RPCs + grants.
- `src/lib/plan-share.functions.ts` — `getOrCreateShareToken`, `getSharedPlanPublic`, `importSharedPlan`.
- `src/routes/p.$token.tsx` — public SSR route; loader → `getSharedPlanPublic`; sets OG head; renders template view + import CTA.
- `src/components/plans/share-to-socials-button.tsx` — button + `navigator.share` with copy-link fallback.
- `src/routes/_authenticated/coach.plans.$planId.tsx` — mount the new button next to "Assign to athlete" in the header. No other changes.

Everything else (list views, athlete/parent views, template concept, existing `createPlan` fromPlanId path) is untouched.
