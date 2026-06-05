## Tighten RLS roles: `{public}` → `{authenticated}`

Migrate all existing RLS policies on 6 tables from the `public` role grant to `authenticated`. Pure defense-in-depth; audit confirmed zero functional impact.

### Tables
- `coach_athletes`
- `coach_levels`
- `athletes`
- `parent_profiles`
- `coach_profiles`
- `plan_moves`

### Approach
For each policy on the above tables: `DROP POLICY` then `CREATE POLICY ... TO authenticated` with the identical `USING` / `WITH CHECK` clause. No changes to policy logic, table grants, or helper functions.

### Verification
After migration, re-run the security scan to confirm the `{public}` warnings clear and no new findings appear.

### Out of scope
- Leaked Password Protection (declined)
- `lesson_wrap_ups` parent visibility (confirmed coach-only)
- `SECURITY DEFINER` function warnings (accepted)