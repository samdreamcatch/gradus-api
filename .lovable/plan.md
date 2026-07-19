## Add "Buddy Garrity" org-admin test user to the dev panel

### What gets built

1. **Seed migration** (idempotent):
   - Insert auth user `orgadmin@test.dev` with password `VITE_DEV_SEED_PASSWORD` (matches other seeded accounts). Skip if already present.
   - Look up the existing **Test Club** organization by name; do not create a new org.
   - Insert an `org_admins` row linking the new user to Test Club.

2. **`src/lib/parent-signup.functions.ts`** — extend `getMyRole` to check `org_admins` (via `is_any_org_admin`) and return `"org_admin"` when matched. Without this, the root `/` redirect and role guard won't route Buddy into `/org-admin`.

3. **`src/components/dev/dev-accounts.ts`**:
   - Add `"org_admin"` to the `DevRole` union.
   - Add `ONBOARDING_STEPS.org_admin = []` (no onboarding flow).
   - Append a new `DevAccount`:
     ```
     { email: "orgadmin@test.dev", label: "Buddy Garrity",
       role: "org_admin", note: "Org admin — Test Club", home: "/org-admin" }
     ```

4. **`src/components/dev/dev-tools.tsx`** — if the switcher UI groups accounts by role or filters on the `DevRole` union, add an "Org admin" section so Buddy renders. (Quick read to confirm before editing; no visible change if it already iterates generically.)

### Not in scope
- No new organization, no Stripe, no email, no changes to the `/org-admin` UI itself.
- Coach linking (Tami / David already sit in Test Club per prior seeds) — untouched.
