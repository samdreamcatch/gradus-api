# Diagnosis

**No — it's not because the email already exists in auth.** Google sign-in itself succeeded (the auth log shows a clean login). The failure happens on the next step, when parent signup tries to insert a `parent_profiles` row for that user.

That user (`mariah.slone@gmail.com`) already has a **coach_profiles stub row** in the database:

- `first_name: Mariah`, `last_name: Gillespie`
- `is_test: true`, `onboarded_at: null` (never finished coach onboarding)
- Created 2026-06-23 — a leftover from earlier dev/test seeding

There's a DB trigger `prevent_dual_role_on_parent_profiles` that raises:

> `This account is registered as a coach, not a parent.`

whenever anyone tries to insert a parent row for a `user_id` that already has a coach row. That's what's blowing up the signup — but the UI swallows the real message and shows the generic "Something went wrong. Please try again."

# Plan

1. **Delete the stale coach stub** for user `3c279baf-a305-478a-9492-9be3362f64d7` (mariah.slone@gmail.com) so she can complete parent signup. Safe because the row is `is_test: true` and never onboarded — no coach data hangs off it worth keeping.

2. **Surface the real error message in the parent signup form.** Right now `handleSubmit` in `src/routes/signup.parent.athletes.tsx` catches the thrown Error and shows `e.message`, but the trigger's `RAISE EXCEPTION` string gets wrapped by PostgREST and reduced to a generic string in `dbError()`. Update `dbError` (or the specific handler) so known dual-role errors return their PostgreSQL message intact, and any parent-signup dual-role hit shows "This account is registered as a coach, not a parent." instead of "Something went wrong."

3. **Optional follow-up (not in this change):** if you actually want mariah.slone@gmail.com to be *both* a coach and a parent long-term, we'd need to relax the dual-role trigger — but that's a bigger product decision. For now assume the stub was accidental and just delete it.

# Technical notes

- Trigger source (confirmed): `prevent_dual_role_parent()` in `public`, raises `check_violation` when `coach_profiles.user_id = NEW.user_id`.
- Delete uses `supabase--insert` with a scoped `DELETE FROM public.coach_profiles WHERE user_id = '3c279baf-...' AND is_test = true AND onboarded_at IS NULL;` — narrow enough that it can't nuke a real coach.
- Error surfacing lives in `src/lib/db-error.ts` (or wherever `dbError` is defined) plus a small message tweak in `startParentSignup`'s catch path.
