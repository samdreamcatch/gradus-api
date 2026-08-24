# Export users to CSV from the admin users page

The admin Users table already loads everything you'd want in an export — email, name, user type, who each person is connected to, guardian email, plan, org, flags, promo codes — and it already supports filtering by type, plan, admin/org-admin, test, and deleted. The cleanest answer is an **Export CSV** button on that page that downloads exactly the rows currently on screen, respecting whatever filters and search you've applied.

## How it works

- A small "Export CSV" button sits next to the search/filter controls.
- It exports the current filtered result set (so "all coaches" or "all parents with no connections" is just: filter, then export).
- Filename encodes the filter, e.g. `gradus-users-coach-2026-08-24.csv`.

## Columns in the export

Name, Email, User type, Connection status, Connected to, Guardian email, Guardian status, Plan tier, Organization, Admin, Org admin, Test, Soft-deleted, Promo codes, Created at, Last sign-in.

"Connection status" is a new derived field so you can sort/pivot in a spreadsheet:

- `connected` — has at least one linked coach/athlete/parent
- `unconnected` — none
- `n/a` — internal admin or unknown type

That same value also becomes a filter chip on the page (All / Connected / Unconnected), so you can export just unconnected users directly.

## Technical notes

- No new server function and no schema change. `listAllUsers` in `src/lib/admin.functions.ts` already returns `connections: { names, total }`; connection status derives from `total > 0`.
- Add an optional `connection: "all" | "connected" | "unconnected"` input to `listAllUsers`, filtered in memory after the existing joins, and a matching chip group in `src/routes/_authenticated/admin.users.index.tsx`.
- CSV generation is client-side in a new `src/lib/csv.ts` helper (RFC-4180 quoting, `Blob` + object URL download) — the data is already in the browser from the existing query, so no extra round trip.
- Admin-only, unchanged auth path (`assertAdmin`).

## Alternative if you want it once, not repeatedly

If this is a one-off pull rather than an ongoing need, I can instead run a single query against the database and hand you a CSV file directly, with no UI change.
