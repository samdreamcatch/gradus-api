
# Athlete flow split: minor vs. adult (18+)

## Goals

- Preserve today's under-18 flow byte-for-byte: parent creates the athlete, parent gets the invite code, athlete claims a username, parent owns messaging visibility, goals, and coach linking.
- Add a first-class 18+ path: adult signs up for themselves (email + password), optionally enters a coach's 8-char invite code, and can message/roster with a coach directly — no parent record required.
- Keep the safety envelope around minors intact: no code path lets an under-18 athlete acquire adult permissions, message a coach outside the parent-mediated room, or be created without a parent owner.

## User-facing flow

Landing page → "I'm an athlete" now asks a single question first:

```text
        Are you 18 or older?
        ┌──────────┐   ┌──────────┐
        │  Yes     │   │  No      │
        └────┬─────┘   └────┬─────┘
             │              │
   /signup/athlete/adult    /signup/athlete   (today's code-entry screen)
```

**Under-18 (unchanged).** Enter parent-issued 8-char code → confirm athlete → pick username + password → into the app.

**18+ (new).** Three-field form: email, password, birthdate (must resolve to ≥18 server-side). Same captcha rules and Terms checkbox as the parent flow. Optional field: coach invite code (same 8-char format coaches already have). On submit:

1. Server verifies birthdate ≥18 and captcha, creates auth user.
2. Server creates an `athletes` row with `parent_id = NULL`, `self_managed = true`, `user_id = auth.uid()`, `birthdate` stored.
3. If a coach code was supplied, the server calls the existing coach-invite claim path and inserts the `coach_athletes` link.
4. Adult onboarding: sport selection + goals + schedule (reuses the existing onboarding components; skips anything parent-only).

**Aging up is out of scope for this change** per your answer — a minor stays a minor in the data model until a parent or admin explicitly converts them. We'll add a "Convert to self-managed account" action later; today's parent flow keeps working unchanged.

## Data model

One migration touches `athletes`:

- `parent_id uuid` → drop `NOT NULL`. Foreign key to `parent_profiles` stays with `ON DELETE CASCADE`.
- Add `self_managed boolean NOT NULL DEFAULT false`.
- `birthdate date` already exists; make it `NOT NULL` for `self_managed = true` rows via a CHECK: `(self_managed = false) OR (birthdate IS NOT NULL AND parent_id IS NULL)`.
- Add the inverse invariant for minors: `(self_managed = true) OR (parent_id IS NOT NULL)`.
- Add a `BEFORE INSERT/UPDATE` trigger that rejects `self_managed = true` when the computed age is <18 based on `birthdate`. This is the server-side age gate — even if a client tampers with the request, the DB refuses.
- Index on `(self_managed) WHERE self_managed = true` for admin listings.

No new tables. All existing FKs (`plans.athlete_id`, `coach_athletes.athlete_id`, `athlete_goals.athlete_id`, `message_rooms.athlete_id`, etc.) already point at `athletes.id` and keep working.

## RLS and safety boundaries

The rule of thumb: any policy that today reads "the parent of this athlete can see/write X" gets an OR branch "…or the athlete is self-managed and is the caller." Any policy that today reads "the athlete can see/write X directly" stays as-is. Nothing new is granted to minors.

Concrete changes:

- `athletes` — existing "Athletes can update own row" already scopes to `auth.uid() = user_id`; still correct. Add nothing.
- `athlete_goals` — today's "parent manages goals" policy stays. Add a second policy: `INSERT/UPDATE/DELETE` allowed when `EXISTS (select 1 from athletes a where a.id = athlete_id AND a.self_managed AND a.user_id = auth.uid())`. Under-18 athletes never match this branch.
- `message_rooms` / `messages` — today rooms are (coach, athlete, parent) triples and `is_room_participant` allows the parent's user_id. Extend `is_room_participant` so a self-managed athlete's `user_id` counts as a participant when their room has no parent. Room creation for self-managed athletes skips the parent leg entirely — the room becomes (coach, athlete).
- `coach_athletes` — today an insert requires the parent to own the athlete. Add: a self-managed athlete may insert their own row when claiming a coach invite code (server-side function does this under `requireSupabaseAuth`; RLS backs it up).
- `athlete_invite_codes` — unchanged. This table is the parent → athlete handoff; adult athletes never touch it.
- `athlete_primary_coaches`, `coach_athlete_sports`, `plans`, `lesson_wrap_ups`, `pre_lesson_briefings` — coach-side policies are unchanged (coach sees rostered athletes regardless of parent). Parent-side policies stay parent-only; adult-side reads route through `athletes.user_id = auth.uid()`.
- `parent_has_athlete_in_sport` / `is_parent_of_athlete` — unchanged; they simply return false for self-managed athletes.

The two invariants we lean on:
1. `self_managed = true` ⇒ `parent_id IS NULL` (enforced by CHECK).
2. `self_managed = true` ⇒ `age >= 18` (enforced by trigger).

Together those mean no policy branch keyed on `self_managed` can ever grant a minor adult-level access.

## Server functions

New file `src/lib/adult-athlete-signup.functions.ts`:

- `signupAdultAthlete({ email, password, birthdate, captchaToken, coachInviteCode? })` — verifies captcha, calls `supabase.auth.signUp`, then under `requireSupabaseAuth` (post-sign-in) inserts the `athletes` row and, if a code was passed, claims the coach invite.
- `claimCoachInviteAsAdult({ code })` — thin wrapper the onboarding "add a coach later" screen calls.

`src/lib/athlete-signup.functions.ts` stays the invite-code path for minors and gets no behavior changes.

## Routes

- `src/routes/signup.athlete.tsx` — replace the current single "enter code" screen with the age question, then route to either the existing `/signup/athlete/confirm` (minor) or the new `/signup/athlete/adult` (adult). The current parent-flow "your athlete needs a code from you" copy stays on the minor branch.
- `src/routes/signup.athlete.adult.tsx` — new form (email, password, DOB, optional coach code, terms, captcha). Mirrors `signup.parent.tsx` for the shared captcha/terms/loading UX so the two entry points feel identical.
- `src/routes/_authenticated/athlete.onboarding.tsx` — new; a trimmed version of `coach.onboarding` that collects sports and initial goals for self-managed athletes. Skipped entirely for minors (they onboard through the parent).
- Route guards: the existing `_authenticated/athlete.*` routes work for both minors and adults because they key off `athletes.user_id`. No new gate needed; components that assume a parent (e.g. "Ask your parent to add a coach") get a `self_managed`-aware branch or a small `<IfSelfManaged>` helper.

## UI touch points

- Landing role picker: add the 18+/under-18 fork copy.
- Athlete settings: adults see "Manage my coaches" (enter/remove coach codes directly); minors keep today's "Ask your parent" copy.
- Athlete home / messages: for adults, no parent chip in the message room header; conversation is coach ↔ athlete.
- Coach roster and athlete-detail sheet: show a small "self-managed" badge instead of the parent name, and hide the "Message parent" affordance for those rows.
- Admin console: filter/sort by minor vs self-managed; the existing parent-based listing keeps working for minors.

## What we're deliberately not doing in this change

- No automatic age-up. A minor at 17y364d stays a minor until an explicit conversion; we can add that later without another schema change (flip `self_managed`, null out `parent_id`, keep history in place).
- No new adult-only tables. If we later need adult-specific fields (billing, waivers, etc.) we add columns then, not now.
- No change to Google/OAuth broker plumbing — adult signup uses email/password like the parent flow does today.

## Rollout

1. Migration: nullable `parent_id`, add `self_managed`, CHECK constraints, age trigger, RLS additions. Existing rows all become `self_managed = false` (minors), preserving current behavior.
2. Server function + adult signup route + landing fork.
3. Adult onboarding screen and settings/messages UI branches.
4. Coach-side badge + "no parent" affordance handling.
5. Smoke test both flows end-to-end in preview (create a minor via parent code, create an adult with and without a coach code, verify a minor cannot reach any self-managed code path even with a hand-crafted request).

