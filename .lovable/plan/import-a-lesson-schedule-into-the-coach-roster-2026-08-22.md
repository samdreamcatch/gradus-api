# Import a lesson schedule into the coach roster

Let coaches build their roster and weekly schedule in one pass: upload a CSV, snap a photo of a paper/screenshot schedule, or type rows in by hand. Every path lands in the same editable review table, then a match step, then a single "Import" action that creates athletes, sends guardian invites, and writes recurring lesson slots.

## Entry point

A "Import schedule" action on `/coach/roster` (next to the existing add-athlete affordance) opens a bottom Sheet — the same overlay pattern the roster already uses. The sheet runs a hub → step flow like the existing Add-athlete drawer:

```text
Source          →  Review rows      →  Match people     →  Confirm
CSV / Photo /      editable table      per-row match       summary + Import
Manual             with errors         confirm/reject
```

## Step 1 — Source

Three cards in the sheet:

- **Upload CSV** — file input. A "Download template" link gives the exact header row.
- **Take a photo** — camera/file input (`accept="image/*" capture`). Image is sent to Lovable AI vision, which returns the same row shape as the CSV parser. Coach sees a progress state, then the parsed rows.
- **Enter manually** — starts the review table with one blank row and an "Add row" button.

## Step 2 — Review rows

One editable table (reusing existing field/chip primitives), one row per lesson:

| Field | Required | Notes |
| --- | --- | --- |
| Athlete first / last name | yes | |
| Day of week | yes | Mon–Sun |
| Start time | yes | |
| Length (minutes) | yes | end time derived |
| Frequency | yes | weekly / biweekly / twice monthly / monthly (existing slot options) |
| Guardian email | yes, unless athlete email given | |
| Athlete email | required only when no guardian email | |
| Sport | no | defaults to the coach's sport when they only teach one |

Rows failing validation are flagged inline and cannot be imported until fixed or removed. Multiple lessons for the same athlete (same name + email) collapse into one athlete with several slots.

## Step 3 — Match people

For each distinct athlete the server returns a match verdict:

- **Exact email match** (guardian email on a parent account or on an existing athlete record, or athlete email on an athlete account) → shown as "Matched", coach can reject.
- **Fuzzy name match** among athletes already reachable by the coach's sport → shown as "Possible match" with confirm / reject.
- **No match** → "New athlete".

Coach can also "Match manually" — a search field over athletes/parents the same lookup allows. Rejecting a match keeps the row as a new athlete.

Athletes already on the coach's roster are shown as "Already on roster — lessons will be added" and never duplicated.

## Step 4 — Confirm and import

Summary line: "3 new athletes, 2 matched, 9 lessons". One button runs the import. Per-row results come back as success / skipped / failed with reasons, shown in the sheet; failures do not roll back successes. Invites are sent immediately to guardians (and to adult athletes with only an athlete email) using the existing guardian-invite email.

## Technical notes

- New sheet `src/components/coach/schedule-import-sheet.tsx` plus small step components; overlay = Sheet (bottom), destructive confirms = AlertDialog, per doctrine. No new UI primitives.
- CSV parsing is done client-side with a tiny hand-rolled parser (no new dependency); the parsed row shape is shared with the vision path via a `src/lib/schedule-import.ts` module holding the zod row schema, time/day parsers, and the CSV template.
- New `src/lib/schedule-import.functions.ts`:
  - `parseScheduleImage` — server fn, sends the image as a base64 `image_url` block to the Lovable AI Gateway with a strict JSON schema matching the row shape; returns rows plus a per-field confidence-free "needs review" flag. Errors surface per the gateway error semantics (no silent retries).
  - `matchScheduleRows` — server fn, resolves exact-email and fuzzy-name candidates via the privileged client, returning only minimal display data (name + masked email) for candidates.
  - `commitScheduleImport` — server fn, transactional per athlete: link existing athlete or create a new one (reusing the `addAthleteWithGuardian` logic, extracted into a shared server-only helper so birthdate is optional on the import path), attach sport, then insert `athlete_lesson_slots` rows with `frequency` / `weeks_of_month` / `starts_on` exactly as the existing lesson-slot sheet writes them. Duplicate slots (same athlete/day/start) are skipped.
- No schema migration is needed: `athletes.guardian_email`, `added_by_coach_id`, and the `athlete_lesson_slots` frequency columns already exist. `athletes.birthdate` is nullable, so imported minors get a guardian invite and the guardian supplies the birthdate on claim.
- Roster cap trigger still applies; an import that exceeds the coach's plan cap reports the remaining rows as skipped with an upgrade link to `/coach/paywall`.
- Server-side zod validation mirrors the client rules; emails normalized and length-capped.
