# Export users to CSV from the admin users page

The admin Users table already loads everything you'd want in an export — email, name, user type, who each person is connected to, guardian email, plan, org, flags, promo codes — and it already supports filtering by type, plan, admin/org-admin, test, and deleted. The cleanest answer is an **Export CSV** button on that page that downloads exactly the rows currently on screen, respecting whatever filters and search you've applied.

## How it works

- A small "Export CSV" button sits next to the search/filter controls.
- It exports the current filtered result set (so "all coaches" or "all parents with no connections" is just: filter, then export).
- Filename encodes the filter, e.g. `gradus-users-coach-2026-08-24.csv`.

## Columns in the export

Identity: Name, Email, User type, Created at, Last sign-in.

Connections (typed, so a spreadsheet can pivot on them):

- Connection status — `connected` / `unconnected` / `n/a`
- Connection count — total links
- Coaches — names of linked coaches (athletes, parents)
- Athletes — names of linked athletes (coaches, parents)
- Parents / guardians — linked parent or guardian names (athletes), plus guardian email and guardian status (claimed / invited / none) for athlete rows
- Organization — club name for coaches in a club

Each cell is filled only where it applies to that user type; other cells stay blank.

Plan and activity:

- Plan tier — coach / coach pro / club / team / free, plus subscription status (trialing, active, past_due, canceled) and trial or period end date
- Last sign-in — from the auth record
- Sessions logged — count of practice sessions attributable to that user, and the date of the most recent one
- Flags — admin, org admin, test, soft-deleted
- Promo codes

## Technical notes

- `listAllUsers` in `src/lib/admin.functions.ts` already returns `connections: { names, total }` as a flat display list. It gains a typed breakdown (`coaches[]`, `athletes[]`, `parents[]`) built from the same batched `coach_athletes` / `athletes` / `athlete_guardians` joins it already runs — no per-row queries and no schema change.
- Plan status comes from existing `coach_profiles` / `parent_profiles` billing columns (`subscription_status`, `subscription_tier`, `current_period_end`, `trial_ends_at`) already fetched there.
- "Sessions logged" needs one new batched aggregate over `plan_sessions` (count + max `logged_at`, grouped by the logging user — athlete or parent). Coaches get the sessions logged across their roster instead, labelled as such.
- Add an optional `connection: "all" | "connected" | "unconnected"` input to `listAllUsers`, filtered in memory after the joins, and a matching chip group in `src/routes/_authenticated/admin.users.index.tsx`.
- The extra fields ride along on `UserRow` and go into the CSV; the on-screen table keeps its current columns so it stays readable.
- CSV generation is client-side in a new `src/lib/csv.ts` helper (RFC-4180 quoting, `Blob` + object URL download) — the data is already in the browser.
- Admin-only, unchanged auth path (`assertAdmin`).


## Alternative if you want it once, not repeatedly

If this is a one-off pull rather than an ongoing need, I can instead run a single query against the database and hand you a CSV file directly, with no UI change.
