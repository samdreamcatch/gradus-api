# Make schedule import painfully easy

Two parts: collect the missing birthdate at claim time (not at import time), and rebuild the template + review step so a coach never has to guess a format.

## Part 1 — Birthdate moves to the claim flow

Today a coach-imported athlete is created with no birthdate, and the guardian claim page (`/g/<token>`) only asks for the guardian's first/last name. Nothing later asks for the athlete's birthdate, so imported athletes stay birthdate-less forever.

Change:

- The claim page adds a required **athlete date of birth** field (shown with the athlete's name so the guardian knows whose birthday it is). Pre-filled and skipped when the record already has one.
- The claim server function writes the birthdate and rejects the claim if it is missing or implausible (future date, older than 100 years).
- If the birthdate turns out to be 18+, the athlete is still linked to the claiming adult — no behavior change, just accurate age data.
- Same requirement on the athlete-side claim path so an adult athlete claiming their own imported record enters their DOB during signup.

Net effect: the coach never types a birthdate; the person who actually knows it does, before they can finish.

## Part 2 — A template that explains itself

Current template is a bare header row plus two examples. Replace with a downloadable CSV that carries its own instructions:

- A first comment/instruction block (lines prefixed so the parser skips them) spelling out, per column, what is accepted:

```text
day            Mon / Monday / Tue ... (any spelling)
start_time     4:00 PM, 4pm, 16:00, 1600
length_minutes 45, 60, "1 hr", "1.5 hours"
frequency      weekly | every other week | twice a month | monthly
guardian_email required for anyone under 18
athlete_email  use instead of guardian_email for adult athletes
sport          leave blank to use your sport
```

- Three example rows covering the common shapes: a minor with a guardian email, an adult athlete with their own email, and a biweekly lesson.
- The CSV parser learns to skip instruction/comment lines and blank lines so the file downloads, gets filled in, and re-uploads without the coach deleting anything.
- The file also opens cleanly in Excel/Numbers/Sheets (quoted fields, UTF-8 BOM).

## Part 3 — The review step does the explaining

Most coaches will not read a template. The review table carries the same guidance inline:

- Each column header gets a one-line hint under it ("Mon–Sun", "e.g. 4:00 PM", "minutes", "Required for under 18").
- Day and frequency are pickers, not free text; start time is a time input; length is a chips row (30 / 45 / 60 / 90) plus a custom field — so the only truly typed fields are names and emails.
- A "sport" picker defaults to the coach's sport and is hidden entirely when the coach teaches one sport.
- Errors are summarized at the top ("2 rows need a fix") with a tap-to-jump, and each bad cell shows the specific reason plus an example of what would be accepted.
- Anything the CSV or photo could not read is highlighted as "couldn't read — please confirm" rather than silently defaulted, so a misread time is visible instead of imported wrong.
- A first-time-only explainer line at the top of the review step: "Check these rows, fix anything highlighted, then match people. Guardians get an invite email as soon as you import."

## Part 4 — Smaller frictions

- Paste support: a "Paste from a spreadsheet" option on the source step accepts tab- or comma-separated text straight out of Excel/Sheets — no file saving.
- The source step gains one-line reassurance under each option ("We'll show you every row before anything is saved").
- Duplicate rows (same athlete, same day and time) are flagged in review instead of only being silently skipped at commit.

## Technical notes

- `src/lib/schedule-import.ts`: new instruction-aware CSV template, comment-line skipping in `splitCsv`/`parseScheduleCsv`, a TSV/paste parser, per-field "unreadable" flags on `ImportRow`, and duplicate detection in `validateRow`/grouping.
- `src/components/coach/schedule-import-sheet.tsx`: review-table header hints, chip/picker inputs, error summary, paste option, first-run explainer. Existing Sheet/AlertDialog overlay doctrine and `press` interaction utilities unchanged; no new primitives.
- `src/lib/guardian.functions.ts` + `src/routes/g.$token.tsx`: birthdate field and validation on claim; same for the athlete-side claim path.
- No schema migration — `athletes.birthdate` is already nullable and the relaxed `athletes_self_managed_shape` constraint already allows a coach-added, unclaimed athlete without one.
