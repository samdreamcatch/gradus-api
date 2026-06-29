## Goal

Add a final "Accept Terms of Service" step to coach and parent onboarding. New signups must click through Common Paper TOS before reaching the app. Existing users are grandfathered.

## Schema

New migration adds `public.terms_acceptances`:
- `user_id uuid` (auth.users)
- `role text` ('coach' | 'parent')
- `terms_version text` (e.g. `'2026-06-29'`)
- `accepted_at timestamptz default now()`
- `user_agent text`, `ip text` (nullable, for audit)
- unique on `(user_id, terms_version)`
- RLS: users can insert/select their own rows; service_role full.
- GRANTs per project convention.

## Constants & content

- `src/lib/terms.ts` — exports `CURRENT_TERMS_VERSION = '2026-06-29'` and a short summary string used on the click-through screen.
- `src/routes/terms.tsx` — public route rendering the full Common Paper TOS (from the uploaded doc) as styled markdown. Linked to from the checkbox label and from settings/footer.

## Server functions (`src/lib/terms.functions.ts`)

- `acceptTerms({ role })` — authed via `requireSupabaseAuth`, inserts a row with `CURRENT_TERMS_VERSION` (idempotent on conflict).
- `getTermsStatus()` — returns `{ accepted: boolean, version: string }` for the current user against `CURRENT_TERMS_VERSION`.

## UI — shared component

`src/components/onboarding/terms-step.tsx`:
- Page card with heading "One last thing", short summary (what they're agreeing to: subscription, governing law = Delaware, contact email), checkbox "I have read and agree to the Gradus Terms of Service" with `<Link to="/terms" target="_blank">`, primary CTA "Agree & continue", secondary "Open full terms".
- Calls `acceptTerms` then navigates to the destination passed in via prop.

## Coach flow

- New route `src/routes/_authenticated/coach.onboarding.terms.tsx` (or inline as final step inside existing `coach.onboarding.tsx` wizard — whichever matches current pattern).
- After `completeOnboarding` succeeds, navigate to terms step instead of `/coach`. Only call `acceptTerms` then route to `/coach`.

## Parent flow

- New route `src/routes/signup.parent.terms.tsx`.
- `signup.parent.schedule.tsx` `finish()` currently navigates to `/parent`. Change destination to `/signup/parent/terms` (preserving any code), which on accept navigates to `/parent`.

## Grandfathering

- No backfill needed. `getTermsStatus` only blocks brand-new flows because the gate lives inside the signup wizards, not as a global guard. Existing users who already reached `/coach` or `/parent` are unaffected.
- (Optional future: a global gate keyed off `CURRENT_TERMS_VERSION` for re-acceptance on updates — not in scope now.)

## Files touched

New:
- `supabase` migration (terms_acceptances)
- `src/lib/terms.ts`
- `src/lib/terms.functions.ts`
- `src/routes/terms.tsx`
- `src/components/onboarding/terms-step.tsx`
- `src/routes/signup.parent.terms.tsx`
- `src/routes/_authenticated/coach.onboarding.terms.tsx` (or modify existing coach.onboarding.tsx as final step)

Modified:
- `src/routes/signup.parent.schedule.tsx` — change final navigate target.
- `src/routes/_authenticated/coach.onboarding.tsx` — append terms step / change post-complete navigation.

## Out of scope

- Athlete signup (parent acceptance covers minors).
- Re-prompting existing users on version bumps.
- Storing signed PDFs / DocuSign-style receipts (DB row + version is the record).
