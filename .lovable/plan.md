# Admin users page: clickable rows + connections column

Two additions to the internal admin users table, both admin-only.

## 1. Click into a user's profile

Today the only way into a user's detail page is the row's "..." menu. The name cell will become a link to that user's detail page, styled like the existing admin links (accent ink, underline on hover), so clicking a name opens the full profile. The "..." actions menu stays exactly as it is.

## 2. "Connected to" column

A new column between Type and Plan showing who each user is linked to, based on their role:

- Coach — the athletes on their roster, e.g. "Addie DiMuro, Lisa Simpson +3 more"
- Parent — their athletes, plus each athlete's linked coaches
- Athlete (any kind) — their linked coaches, and their parent/guardian when one is attached
- Internal admin / unknown — em dash

Names are truncated to the first two or three, with a "+N more" hint so the column stays readable; the full picture stays on the detail page. Each name is plain text (not a link) to keep the row's single click target unambiguous.

## Technical notes

- `listAllUsers` in `src/lib/admin.functions.ts` gains three batched lookups alongside the existing profile queries: `coach_athletes` joined to athlete names, `athletes` grouped by `parent_id`, and coach names from `coach_profiles`. These are fetched once and joined in memory, matching how organizations and promo codes are already resolved — no per-row queries.
- The `UserRow` type gains a `connections: { label: string; count: number }` style field (a short display list plus total count) so the table renders without extra logic.
- `src/routes/_authenticated/admin.users.index.tsx`: name cell wrapped in `<Link to="/admin/users/$userId">`, one new `TableHead`/`TableCell` pair, and the two `colSpan={10}` empty/loading cells bumped to 11.
- No schema, RLS, grant, or non-admin code changes.
