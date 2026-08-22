# Fix schedule-import athlete matching

## What's wrong

Two separate issues in the "match your lessons to athletes" step.

**1. Wrong athletes show up as "Email match."**
The matcher looks up every email in the whole import at once, collects the athletes belonging to those accounts into one shared pool, and then — for each lesson row — marks an athlete as an email match if *any* email on that row belongs to *any* account in the pool. It never checks that the athlete actually belongs to the account behind that specific row's email.

Confirmed against the data: Leon Gillespie has no guardian email on his record; he is linked to the account `mariah.slone+1@gmail.com`. Florence Machine is linked to `testparent@test.dev`. Both were pulled in by other rows in the same import, then offered to Andy Samberg because the account-match check is not scoped per row.

**2. A confident match still shows alternatives.**
Even when a row's name and email both match one athlete exactly, the other weaker candidates are still listed, which invites a mistaken pick.

## The fix

- Track which athlete belongs to which email (guardian email on the athlete record, the athlete's own sign-in email, and the parent account's email). Only offer an athlete as an email match to a row whose email resolves to that athlete.
- When a row has exactly one candidate whose name matches exactly *and* whose email matches, treat it as a confirmed match: auto-select it and show no other options for that row.
- Otherwise, behavior stays as it is today — candidates listed with their reason, coach picks.

## Technical detail

In `src/lib/schedule-import.functions.ts` (`matchImportAthletes` handler):

- Build `emailToAthleteIds: Map<string, Set<string>>` while collecting the pools:
  - athletes whose `guardian_email` equals the email
  - athletes whose `user_id` is the account for that email
  - athletes whose `parent_id` is the parent profile for that account
- Replace the current `accountHit` check (`rowEmails.some((e) => userIdByEmail.has(e))`) with membership in `emailToAthleteIds` for that row's own emails.
- After the candidate list is built, if a candidate has `reason === "email"` and its normalized first/last name equals the row's, return `status: "exact"` with `candidates: [thatCandidate]` only. Preserve the existing on-roster / email-first ordering and the `exact` / `possible` / `new` statuses for every other case.

No schema, UI, or commit-step changes.
