## Optional promo-code attribution for signup

Add a promo code field to every signup entry point. Codes are optional (never block signup), validated against a managed list you control, and stored per user so you can attribute conversions to a specific source.

### Database

New table `public.promo_codes`:

- `code` (text, PK, uppercase) — the code shared with users, e.g. `JANESMITH`
- `label` (text) — human name shown in admin, e.g. "Jane Smith"
- `active` (boolean, default true)
- `notes` (text, nullable) — campaign, platform, etc.
- `created_at` (timestamptz)

New column on `parent_profiles`, `coach_profiles`, and `athletes`:

- `promo_code` (text, nullable, FK → `promo_codes.code` with `ON DELETE SET NULL`)

Adult athletes without a parent already flow through athlete/coach records, so those three tables cover every signup path (parent, coach, adult athlete, under‑18 athlete, admin — admin gets it on their coach/parent profile if applicable; we can add to `admin_allowlist` too if you want, but it's usually not needed).

RLS + grants:

- `promo_codes`: `SELECT` for `authenticated` (so the signup form can validate the code the user typed) — read-only for everyone except `service_role`. Only admins insert/update via the admin UI (`has_role(auth.uid(), 'admin')`).
- The new `promo_code` column on profile/athlete tables is covered by their existing owner + admin policies.

### Signup UX (all roles)

On each signup form (`signup.parent.tsx`, `signup.coach.tsx`, `signup.athlete.account.tsx`, `signup.athlete.adult.tsx`, `signup.admin.tsx`), add an optional field:

- Label: **"Promo code (optional)"** — no helper text.
- Uppercased on input, max 32 chars, trimmed.
- On submit, if the field is non-empty, validate against `promo_codes` (must exist AND `active = true`):
  - Valid → save `promo_code` on the profile row being created.
  - Invalid/inactive → show inline **"We don't recognize that code — you can leave it blank or double‑check."** Do NOT block signup: the user can clear the field and continue, and account creation proceeds normally. (No silent write of an invalid code.)
- Empty field → skip validation entirely, create account as today.

Validation runs in the existing signup server functions, so it's a single round‑trip per submit.

### Admin UI

New admin page at `/admin/promo-codes`:

- Table of codes with `code`, `label`, `active`, `notes`, `created_at`, and **signup count** (aggregate across the three profile tables).
- "New code" form (code, label, notes, active).
- Toggle active/inactive and edit label/notes; codes themselves are immutable once created (to avoid orphaning attributions).
- Server functions guarded by `has_role(auth.uid(), 'admin')`.

Add a link from the existing admin index.

### Reporting

A small server function `getPromoCodeStats` (admin-only) returns `{ code, label, parents, coaches, athletes, total }` for the admin page. Fine to start there — export/CSV can come later if you need it.

### Files touched

- `supabase/migrations/<ts>_promo_codes.sql` — table, columns, RLS, grants.
- `src/lib/promo-codes.functions.ts` — `validatePromoCode`, `listPromoCodes`, `createPromoCode`, `updatePromoCode`, `getPromoCodeStats`.
- `src/components/signup/promo-code-field.tsx` — reusable input + inline validation state.
- Each signup route file: mount the field and pass its value into the existing signup server fn.
- Signup server fns (`parent-signup.functions.ts`, `coach-profile.functions.ts` / coach signup path, `adult-athlete-signup.functions.ts`, `athlete-signup.functions.ts`, `admin-signup.functions.ts`): accept optional `promoCode`, validate, persist.
- `src/routes/_authenticated/admin.promo-codes.tsx` — new admin page.
- Link on `src/routes/_authenticated/admin.index.tsx`.

### Not in scope (per your answer)

- No `?ref=` URL auto-capture, no session/localStorage persistence, no landing-page pre-fill. Users always type the code on the signup screen.

### Open question

Should we also let existing users add a promo code retroactively (e.g. a "Promo code" row in their settings), or is this signup-only?
