## Goal

Two small changes so coaches can share plans to socials the same way athletes/parents can, and their public plans read cleanly in the plans list.

## 1. Persistent share-to-socials button in the coach plan editor

**File:** `src/routes/_authenticated/coach.plans.$planId.tsx`

Today the `ShareToSocialsButton` only renders when the editor is in "Public" assignment mode (as the primary Publish & Share action). Athlete and parent plan pages, by contrast, show a chip-style share button in the header on any viewable plan.

Add the same chip-style button to the coach editor header (next to the existing Back/close control), rendered whenever the plan is shareable:

- `plan.status === "active"` (any assignment — assigned to an athlete OR public), OR
- `isTemplate === true`

Skip it for drafts and benched plans (nothing meaningful to share yet).

Reuse `<ShareToSocialsButton planId={plan.id} planTitle={plan.title || "Untitled plan"} />` with default `variant="chip"`. No changes to the `getOrCreateShareToken` server fn — it already authorizes the owning coach and works for templates and athlete-assigned actives (the plan's `share_token` column is per-plan regardless of `kind`/`athlete_id`).

Leave the existing bottom "Publish & Share" primary button in Public mode untouched — it's the activation+share combo for first publish. The new header chip covers re-sharing thereafter and sharing of already-active/template plans.

## 2. "Shared" caption + colored edge for active public plans

**File:** `src/routes/_authenticated/coach.plans.tsx` (in `PlanRow` and `edgeTone` derivation, ~lines 446–476)

Public plans (published to socials, no athlete) already fall into the "Active" filter because `listPlans` only checks `status: "active"`. They just render as "Unassigned" with a muted grey edge, which is indistinguishable from an unfinished plan.

Update the caption logic so:

- `kind === "plan"` AND `status === "active"` AND no `athleteName` → caption **"Shared"**
- Draft/benched with no athlete → **still "Unassigned"** (unchanged)
- All other branches unchanged (Template, Draft, Benched, or athlete-name-only)

Update the `edgeTone` derivation so an active plan with no athlete is treated as **"active"** (colored edge — tennis/pool per the pen system) instead of falling into "muted". Assigned actives still get "active"; templates still get "template"; drafts/benched still muted.

## Out of scope

- No schema, RLS, or server-function changes — the `plans.share_token` column, `getOrCreateShareToken` authorization, and `listPlans` filtering already support this.
- No changes to athlete/parent share surfaces.
- No new filter or separate "Shared" tab — public actives continue to live in the existing Active list.

## Files touched

- `src/routes/_authenticated/coach.plans.$planId.tsx` — add header `ShareToSocialsButton` gated on `status==="active" || isTemplate`.
- `src/routes/_authenticated/coach.plans.tsx` — caption + `edgeTone` tweak in `PlanRow`.
