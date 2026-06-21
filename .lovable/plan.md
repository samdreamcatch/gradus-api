
# Internal Admin Area

Scope: read-only overview + user lookup, gated to mariah@gradussports.com and alyson@gradussports.com via a roles table, auto-granted the first time they sign up. Admin accounts are pure — no coach or parent profile.

## 1. Roles infrastructure (migration)

Following the project's `user_roles` convention:

- `CREATE TYPE public.app_role AS ENUM ('admin')` (start with one; extendable later).
- `CREATE TABLE public.user_roles (id, user_id → auth.users, role app_role, created_at, UNIQUE(user_id, role))`.
- GRANTs: `SELECT` to `authenticated`, `ALL` to `service_role`. No `anon`.
- RLS on. Policy: a user can `SELECT` their own role rows (`auth.uid() = user_id`). No insert/update/delete from clients — role grants are server-side only.
- `public.has_role(_user_id uuid, _role app_role)` security-definer function (per project standard).
- `public.admin_allowlist` table with one column `email citext PRIMARY KEY`, seeded with the two emails. RLS on, no client access (only service_role). Storing the allowlist in the DB means future admins can be added without a code change.
- Trigger on `auth.users` AFTER INSERT: if `NEW.email` (lowercased) is in `admin_allowlist`, insert `(NEW.id, 'admin')` into `user_roles`. Security definer.
- Backfill: any existing `auth.users` matching the allowlist gets an `admin` row immediately (no-op today since neither account exists).

## 2. Admin-only signup path

New route `src/routes/signup.admin.tsx`:

- Email + password form (matches existing visual language). No beta code field — the allowlist is the gate.
- Server fn `startAdminSignup` (`src/lib/admin-signup.functions.ts`):
  - Validates the email is in `admin_allowlist` BEFORE creating the auth user (prevents orphan auth users for non-admins).
  - Calls `supabase.auth.signUp` with email/password.
  - The DB trigger from step 1 handles the role grant on `auth.users` insert; the server fn does not need elevated privileges for that.
  - Returns success/error; client redirects to `/auth` (or straight in if email auto-confirm is on — it isn't, so they get the standard confirmation flow).
- No Google sign-in on this page for v1 (keeps the allowlist check simple and avoids Google-provider edge cases for the founders' first login). Email/password only.
- Page is unlinked from any nav. Founders reach it via the direct URL `/signup/admin`.

## 3. Route gate

New pathless layout `src/routes/_authenticated/_admin/route.tsx`:

- `beforeLoad`: calls a new server fn `requireAdmin` (uses `requireSupabaseAuth` + `has_role(userId, 'admin')`); on false, `throw redirect({ to: '/' })`.
- Renders `<Outlet />`.

Admin pages live under `src/routes/_authenticated/_admin/`. URL stays `/admin` (underscore layouts don't appear in URLs).

## 4. /admin page (v1)

`src/routes/_authenticated/_admin/admin.index.tsx` → URL `/admin`.

Two sections, server-fed via `createServerFn` + `requireSupabaseAuth` + admin check:

### A. Overview (read-only)
Counts and recent activity, all from a single `getAdminOverview` server fn:
- Total coaches, parents, athletes, plans (active / total).
- Signups in the last 7 days (coaches, parents).
- Beta-code vs coach-code signups (from existing `coach_invite_codes` joins + null `coach_id` on parent_profiles).
- 10 most recent coach signups, 10 most recent parent signups (name, email, created_at).

Rendered as cards using the Gradus design system (paper surfaces, no pen-color flooding — pen accents only on key numbers).

### B. User lookup
- Search input → `searchUsers` server fn. Matches across `coach_profiles` (first_name, last_name, email via `auth.users` join) and `parent_profiles` similarly.
- Results list: kind (coach/parent), name, email, signup date, primary stats (e.g. coach: # athletes, # plans; parent: # athletes).
- Click a result → `/admin/users/$userId` detail page: shows their full profile, related athletes, coach/parent links, plans, recent activity. All read-only. No edit, no delete, no impersonation in v1.

`searchUsers` and `getUserDetail` both run as the admin user through `requireSupabaseAuth`, with an explicit `has_role` check at the top of each handler. For cross-table reads that RLS would normally block for a non-owner, these handlers load `supabaseAdmin` (`await import('@/integrations/supabase/client.server')`) AFTER the admin check passes. That is the documented pattern for privileged reads.

## 5. Discoverability

- No public link to `/signup/admin` or `/admin`.
- I'll share the two URLs with you separately so you can pass them to mariah and alyson.

## Technical details (for reference)

**Files created**
- Migration (roles enum, `user_roles`, `has_role`, `admin_allowlist` + seed, signup trigger).
- `src/lib/admin-signup.functions.ts` — `startAdminSignup`, `checkEmailAllowlisted`.
- `src/lib/admin.functions.ts` — `requireAdmin`, `getAdminOverview`, `searchUsers`, `getUserDetail`.
- `src/routes/signup.admin.tsx`.
- `src/routes/_authenticated/_admin/route.tsx` (gate).
- `src/routes/_authenticated/_admin/admin.index.tsx`.
- `src/routes/_authenticated/_admin/admin.users.$userId.tsx`.

**Files unchanged**
- `signup.coach.tsx`, `signup.parent.tsx`, beta code logic, all existing role/profile tables.

**Out of scope (v1, by your choice)**
- Destructive actions (delete user, force-unlink, reset onboarding).
- Beta code management UI (rotate, generate one-off codes, attribution).
- True impersonation (sign in as another user).
- Admin audit log.

All four are straightforward follow-ups on top of this foundation when you want them.
