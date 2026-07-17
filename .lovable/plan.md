## Goal

Give `coach` / `coach_pro` / `club` real, enforced meaning in the database:

- Roster caps: **Coach 25**, **Coach Pro 75**, **Club unlimited**.
- **Coach Pro and Club coaches** can read plans another coach has assigned to an athlete they also roster.

Founding Coach (promo-free, `subscription_tier IS NULL`) continues to behave as the free Coach plan → capped at 25.

## Tier resolution

There is no `club` value in `coach_profiles.subscription_tier` today; a Club coach is one attached to an organization. Effective tier for enforcement:

```
club     ← coach_profiles.organization_id IS NOT NULL
coach_pro ← subscription_tier = 'coach_pro'
coach    ← everything else (includes Founding / promo_free / null)
```

Encapsulated in a new SQL helper `public.coach_effective_tier(_coach_id uuid) returns text` (SECURITY DEFINER, stable). Used by both the roster-cap trigger and the plan-visibility policy so the rule lives in one place.

## 1. Roster caps (DB-enforced)

New `BEFORE INSERT` trigger `enforce_coach_roster_cap` on `public.coach_athletes`:

- Look up effective tier of `NEW.coach_id`.
- Count existing rows in `coach_athletes` for that coach.
- If tier = `coach` and count ≥ 25 → `RAISE EXCEPTION` with a friendly message + `ERRCODE = 'check_violation'`.
- If tier = `coach_pro` and count ≥ 75 → same.
- `club` → no cap.

Enforced in the DB so every insert path (`parent-signup`, `adult-athlete-signup`, `athlete-signup`, `parent-settings`, `adult-athlete-invite.functions`) is covered without touching each site. `dbError()` already surfaces these to the UI.

App-side polish (small, non-blocking):

- Extend `CoachProfileDTO` in `src/lib/coach-profile.functions.ts` with `effectiveTier: "coach" | "coach_pro" | "club"` and `athleteLimit: number | null` (null = unlimited) so settings/roster can show "24 / 25 athletes" and disable "Add athlete" affordances before the DB rejects. No new code paths — surfaces the same helper.

## 2. Cross-coach plan visibility for Pro / Club

New SELECT policy on `public.plans`:

```
"Pro and Club coaches view plans on shared athletes" - SELECT
  kind = 'plan'
  AND status IN ('active','benched')
  AND EXISTS (
    SELECT 1
    FROM coach_profiles viewer
    JOIN coach_athletes viewer_link ON viewer_link.coach_id = viewer.id
    WHERE viewer.user_id = auth.uid()
      AND viewer_link.athlete_id = plans.athlete_id
      AND public.coach_effective_tier(viewer.id) IN ('coach_pro','club')
  )
```

Additive to existing "Coaches manage own plans - select"; owning coach still sees everything regardless of tier. The **viewer** must be Pro or Club; the **owner's** tier doesn't matter (a basic Coach's plans become visible to Pro/Club co-coaches on the shared athlete). Templates and drafts are excluded via the `kind`/`status` filter — matches the parent/athlete policies.

No UI wiring in this change: the existing plan queries in `plans.functions.ts` / `coach-athlete-detail.functions.ts` will simply return more rows for Pro/Club coaches once the policy is live. Surfacing "plan by Coach X" in the athlete detail view is a follow-up.

## 3. What is deliberately NOT in this change

- No new `subscription_tier` value for `club` — organization membership already models it and `entitlement = 'club_covered'` is downstream of that.
- No pricing / Stripe / paywall changes. Coach Pro purchase flow is still gated by `VITE_COACH_PRO_ENABLED`.
- No backfill of `subscription_tier` for existing coaches. Founding Coaches remain `null` → effective tier `coach` → 25 cap, which matches the current messaging.
- No changes to `Manage subscription`, `UpgradeToProRow`, or the paywall route.

## Files touched

- **Migration** (single): `coach_effective_tier` function, `enforce_coach_roster_cap` trigger on `coach_athletes`, new SELECT policy on `plans`. `GRANT EXECUTE ... TO authenticated` on the helper (used inside RLS as `SECURITY DEFINER`, so anon is not granted).
- `src/lib/coach-profile.functions.ts`: extend `CoachProfileDTO` with `effectiveTier` and `athleteLimit`, computed server-side using the same rule as the DB helper (kept in sync by convention; the DB is authoritative).
- `src/routes/_authenticated/coach.roster.tsx` (or the roster settings card): show `used / limit` counter and disable "Add athlete" when at cap. Small copy-only.

## Open question I'm assuming an answer to

The user said "Coach Pro and Club can view each other's plans." I'm reading that as **viewer-side gating only** — a Pro/Club viewer sees any co-coach's plans on a shared athlete, including plans owned by a basic Coach. Say the word if it should instead require **both** coaches to be Pro/Club (I'd add an `AND coach_effective_tier(plans.coach_id) IN ('coach_pro','club')` clause).
