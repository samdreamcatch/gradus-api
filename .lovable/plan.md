# Fix: Athletes can update own row (missing WITH CHECK)

## What the finding means, in plain English

Row-level security has two separate gates on an UPDATE:

- **USING** decides *which rows you're allowed to touch*.
- **WITH CHECK** decides *what the row is allowed to look like after your edit*.

Today the `athletes` policy has only the USING gate:

```
USING (auth.uid() = user_id)
```

Translation: "you may edit any athlete row whose `user_id` is you." That's fine for picking the row. But because there is no WITH CHECK, once you're editing you can also change `user_id`, `parent_id`, or `self_managed` to whatever you want. Postgres will still let the write through — the USING gate already passed before the row changed.

Concretely, a self-managed adult athlete who is signed in could send an UPDATE that:

- flips `user_id` to a different auth user (hand their account to someone else, or take over an unclaimed row),
- sets `parent_id` to some other parent's id (attach themselves under a parent who never invited them),
- flips `self_managed` off (change the account type),
- changes `is_test` (evade the test-account filters in admin views).

None of this is exposed through the app UI — our server functions never write those columns. But RLS is the last line of defense: anyone with a valid session can hit PostgREST directly with a hand-crafted PATCH. So the finding is real even though no UI triggers it.

## The fix

Two small changes on the `athletes` table, both database-only:

### 1. Add a WITH CHECK to "Athletes can update own row"

Mirror the USING clause and also freeze the identity/relationship columns so the athlete can't rewrite them mid-update:

```
USING  (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id                      -- still your row after the edit
  AND user_id       IS NOT DISTINCT FROM (SELECT user_id       FROM athletes WHERE id = athletes.id)
  AND parent_id     IS NOT DISTINCT FROM (SELECT parent_id     FROM athletes WHERE id = athletes.id)
  AND self_managed  IS NOT DISTINCT FROM (SELECT self_managed  FROM athletes WHERE id = athletes.id)
  AND is_test       IS NOT DISTINCT FROM (SELECT is_test       FROM athletes WHERE id = athletes.id)
)
```

Athletes keep the columns they legitimately touch — `first_name`, `last_name`, `birthdate`, `motivation`, `username`, `promo_code`. They lose the ability to rewrite the four columns that define who the row belongs to.

### 2. Same tightening on "Parents can update own athletes" (same class of bug, not yet flagged)

The parent policy has the same shape — USING only, no WITH CHECK — so a parent could flip `parent_id` to a different parent and give the athlete away, or flip `self_managed` to true. We should close it in the same migration:

```
USING  (parent owns this athlete)
WITH CHECK (
  parent still owns this athlete
  AND parent_id, user_id, self_managed, is_test unchanged
)
```

Parents keep editing profile fields, birthdate, motivation, username, promo_code — no UI change.

## Why this doesn't break anything

I audited every write path in the codebase against these four frozen columns:

- **`user_id`** is only set by two server functions during signup (`adult-athlete-signup`, `athlete-signup`), both using the service-role client which bypasses RLS. No client code updates it.
- **`parent_id`** is only set by parent-signup, athlete-signup, and parent-invite claim flows, all via server functions with service-role. No client code updates it.
- **`self_managed`** is only set at row creation (adult signup sets `true`, parent-created rows default to `false`). No update paths.
- **`is_test`** is only written by admin/dev tooling running as service-role.

Everything the app actually does through client-authenticated writes stays on the "editable" side of the line: name, birthdate, motivation, username, promo_code — for athletes editing their own row and parents editing their kids.

## Deliverable

A single migration that drops and recreates the two UPDATE policies with the WITH CHECK clauses above. No code changes, no schema changes, no data migration. After it runs, this finding clears and its parent-side sibling is closed at the same time.

## What I'm not doing (and why)

- **Not adding column-level GRANTs.** They'd double-enforce the same rule but complicate future schema changes and confuse the admin/service-role paths. RLS WITH CHECK is the right tool here.
- **Not touching the other five findings.** Same root cause across `coach_invite_codes`, `coach_levels`, `coach_profiles`, `moves`, and the `Function Search Path Mutable` linter warning — worth a follow-up sweep, but out of scope for this specific request.
