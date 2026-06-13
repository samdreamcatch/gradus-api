## Goal

Parents can sign up without a coach code, complete the full wizard (athletes → sport + goals → schedule) coach-agnostic, then invite their coach(es) via a shareable link + 8-char code. When the coach signs up through that link, they're automatically linked to the parent's athletes, sports, goals, and schedule slots.

## User flow

### Parent (no coach yet)
1. `/signup/parent` — coach code field becomes optional. New secondary action: **"I don't have a coach code — set up on my own"**.
2. Goes through the existing wizard, but coach-agnostic:
   - `/signup/parent/athletes` — name + birthdate (unchanged).
   - `/signup/parent/goals` — pick sport, current level, season goal, long-term goal (currently keyed by coach; we'll store with `coach_id = NULL`).
   - `/signup/parent/schedule` — weekly slots (also stored with `coach_id = NULL`).
3. Lands on `/parent` dashboard with a prominent **"Invite your coach"** card:
   - Shareable URL: `https://gradus.training/signup/coach?invite=ABC23XYZ`
   - Visible 8-char code with copy buttons (one for the link, one for the code)
   - Short copy explaining what the coach will see when they accept.

### Coach (joining via parent invite)
1. Opens the link → `/signup/coach?invite=ABC23XYZ`. We show "You're joining {Parent Name}'s account" above the existing form.
2. Coach creates their account normally. On success, the existing coach onboarding kicks in (sports they coach), but on completion we **claim** the parent's pending records:
   - Insert `coach_athletes` rows for every athlete under the parent.
   - For each athlete + sport the coach offers: insert `coach_athlete_sports`, fill `athlete_goals.coach_id`, fill `athlete_lesson_slots.coach_id`, set `athlete_primary_coaches`.
3. Parent dashboard surfaces the new coach the next time it loads.

A coach who already has an account can also paste the parent code from their roster screen ("Add an athlete → I was invited by a parent") — same claim logic.

## Schema changes (one migration)

```text
parent_profiles.coach_id          -> NULL allowed
athlete_goals.coach_id            -> NULL allowed
athlete_lesson_slots.coach_id     -> NULL allowed
coach_athlete_sports.coach_id     -> NULL allowed  (compound PKs adjusted)
```

- New table `parent_invite_codes (id, parent_id unique, code unique, created_at)` with the same Crockford alphabet used for coach codes. RLS: parent reads their own row; coach reads via a security-definer RPC `get_parent_by_invite_code(_code)` returning `{ parent_id, first_name, last_name, athlete_count }`.
- Rate-limit reuse of `invite_lookup_attempts` for `/signup/coach?invite=…` lookups.
- Adjust `validate_athlete_primary_coach` and `validate_coach_athlete_sport` triggers so the `coach_id IS NULL` rows skip the coach-link check.
- RLS on goals/slots already keys off `is_parent_of_athlete`, so coach-less rows remain accessible to the parent.

## Server functions

New / changed in `src/lib/parent-signup.functions.ts` + `src/lib/coach-invite.functions.ts`:

- `startParentSignup` — `code` becomes optional; when absent, write `parent_profiles` with `coach_id = NULL`.
- `getCoachByInviteCode`, `linkAthletesToCoach`, `listAthletesForCode`, `saveAthleteGoals`, `saveAthleteSchedule` — accept `code: string | null`; when null, resolve coach as null and skip coach-link inserts.
- New `getOrCreateParentInviteCode()` — like `getCoachInviteCode` but for parents.
- New `getParentByInviteCode(code)` (public, rate-limited) for the coach signup landing.
- New `claimParentInvite({ code })` — coach-authenticated, called at the end of coach onboarding (or immediately if the coach was already onboarded). Does the bulk link/claim transaction described above.

## Frontend changes

- `src/routes/signup.parent.tsx`: code field optional, secondary "Skip — I'll invite my coach later" button that routes straight to `/signup/parent/athletes` with no `code` search param.
- Wizard pages (`athletes`, `goals`, `schedule`): treat missing `code` search param as the coach-agnostic path; sport selector on `goals` falls back to a static list (current sport options) instead of the coach's `coach_levels`.
- `src/routes/_authenticated/parent.index.tsx`: new "Invite your coach" card (hidden once the parent has at least one linked coach) showing the link, the code, copy buttons, and a "How this works" sub-line.
- `src/routes/signup.coach.tsx`: read `?invite=…`, fetch parent name, show pre-account banner, persist invite to localStorage through the email-verification redirect.
- `src/routes/_authenticated/coach.onboarding.tsx` (or completion handler): after onboarding finishes, if an invite is pending → call `claimParentInvite`.
- Coach roster: add an "Add by parent invite code" entry point for already-onboarded coaches.

## Out of scope

- No email/SMS send. Sharing is copy-link/copy-code only (per your choice).
- No coach directory / search.
- No re-issuing / rotating of parent codes in this pass (we can add it later, same shape as coach code rotation).

## Risks / things to watch

- Existing data: any rows in goals/slots/sports today are coach-scoped; the migration only widens nullability, so nothing breaks. Validation triggers need updating in the same migration or inserts will still fail.
- Sport choices on the coach-less goals step: today they come from `coach_levels`. We'll source from a shared sport constants list (it should already exist for coach onboarding — we'll reuse it) so parents can pick any sport the platform supports.
- Claim race: if two coaches accept the same parent invite simultaneously, both should succeed for distinct sports they offer; we'll use `ON CONFLICT DO NOTHING` on `coach_athletes` / `coach_athlete_sports` / `athlete_primary_coaches`, and only fill `athlete_goals.coach_id` / `athlete_lesson_slots.coach_id` when currently NULL.
