## Problem

The parent Resources page only lists sports the parent has set as **goals** for an athlete (`athlete_goals.sport`). If a coach trains an athlete in another sport (recorded in `coach_athlete_sports.sport`), no library shows up for that sport.

Example from the database: parent `3e823fcb…` has athlete Ava with goal `tennis`, but coaches train her in `equestrian` and `gymnastics` — those libraries are currently hidden.

## Fix

Treat an athlete as "connected to" a sport when it appears in **either** `athlete_goals` **or** `coach_athlete_sports` for that athlete. Apply this consistently in two places:

### 1. Database (RLS)

Update the security-definer function `public.parent_has_athlete_in_sport(_sport)` so it returns true when any of the parent's athletes have the sport in either table:

```sql
SELECT EXISTS (
  SELECT 1 FROM athletes a
  JOIN parent_profiles pp ON pp.id = a.parent_id
  WHERE pp.user_id = auth.uid()
    AND (
      EXISTS (SELECT 1 FROM athlete_goals g
              WHERE g.athlete_id = a.id AND g.sport = _sport)
      OR EXISTS (SELECT 1 FROM coach_athlete_sports cas
                 WHERE cas.athlete_id = a.id AND cas.sport = _sport)
    )
);
```

This unblocks the existing `resources` RLS policy without changing the policy itself.

### 2. Server function

In `src/lib/parent-resources.functions.ts`, `getParentResources`: query both `athlete_goals` and `coach_athlete_sports` for the parent's athlete IDs, union the `sport` values, then fetch `resources` filtered by that union (as today).

## Out of scope

- Athlete-side `getAthleteResources` — user only mentioned the parent view. Can be aligned later if desired.
- UI changes — the sport selector and library list will naturally include the additional sports.