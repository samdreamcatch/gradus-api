## Goal

Set up multi-coach + club testing on the two test accounts.

## Changes (all data-only, no schema)

**1. Dev panel access (admin role)**
- Insert `user_roles` rows for both users so the dev panel unlocks immediately:
  - `coach@test.dev` (Tami, `dec8fc92…`) → `admin`
  - `coach2@test.dev` (David, `0234d72e…`) → `admin`
- Also add both emails to `admin_allowlist` so the trigger re-grants admin if the accounts are ever recreated.

**2. Tami joins Test Club**
- `UPDATE coach_profiles SET organization_id = '07cfbb37-e558-4f08-85f2-9304b5d3aad0' WHERE id = 'e82ce1b6…'` (Tami).
- Per `coach_effective_tier`, this promotes her to the `club` tier — bypassing the roster cap and giving her the multi-coach visibility surface.

**3. Two shared athletes between Tami and David**

Both athletes are already on Tami's roster; adding them to David's roster in sports David already offers (`coach_levels` check by `validate_coach_athlete_sport`):

- **Dani California** (`c8e7e986…`) — shared under `figure_skating`.
- **Jamie Gilmore** (`5666dde4…`) — shared under `figure_skating` and `gymnastics` (both are in David's `coach_levels`, and both are already Jamie's sports with Tami).

Per athlete:
- Insert `coach_athletes (coach_id = David, athlete_id = <id>)`.
- Insert matching `coach_athlete_sports` rows for David.

Tami's existing links stay untouched, so both athletes end up rostered by both coaches.

## Not changing

- No schema migration, no RLS changes, no code changes.
- David's tier stays `coach`; existing rosters unchanged beyond the two new shared links.
- `athlete_primary_coaches` untouched.

## Rollback

- `DELETE FROM coach_athletes WHERE coach_id = '303f66c6…' AND athlete_id IN ('c8e7e986…','5666dde4…')` (cascades sports rows).
- `UPDATE coach_profiles SET organization_id = NULL WHERE id = 'e82ce1b6…'`.
- `DELETE FROM user_roles WHERE user_id IN (…) AND role = 'admin'` and matching `admin_allowlist` rows.
