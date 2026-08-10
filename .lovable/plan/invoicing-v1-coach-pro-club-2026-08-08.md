# Invoicing v1 — Coach Pro & Club

A thin billing layer that removes the tally. One tap from a student, a review screen, a plain-text invoice out the share sheet. No money moves in v1.

## How a coach experiences it

1. **Billing tab on `/coach/roster`**, alongside Schedule and Athletes. It lists every invoice across the roster, newest first, with an unpaid total at the top. Tapping a row opens the invoice. There is also a **Billing** section inside the athlete detail sheet with that student's rate, a **Generate invoice** button, and their past invoices.
2. **Rate**, set per student. The coach picks either a flat per-session amount or an hourly rate (multiplied by each lesson's scheduled length). If no rate exists, the Generate button opens the rate prompt first, inline — no trip to settings.
3. **First invoice** asks for a start date, prefilled to 30 days back and changeable. Every invoice after that starts the day after the last invoice's end date, automatically.
4. **Review screen** lists each lesson in the window, one line per date, with amount and a checkbox:
   - Scheduled lessons are **pre-checked**. Each line is badged `Confirmed` if the coach did an end-of-practice wrap-up, or `Scheduled` if not, so unverified lines are visible at a glance.
   - Lessons the coach marked "didn't happen", and dates canceled on the calendar, are listed **unchecked** with an editable amount defaulting to the full rate — that's the late-cancel fee.
   - Unchecking or editing a line updates the total live.
5. **Confirm** saves the invoice and opens the native share sheet with plain text: student name, date range, one line per session with date and amount, total. Drops straight into SMS, email, or a Venmo request.
6. **Paid** is a manual flip from the invoice row. Unpaid invoices can be deleted, which returns their sessions to the billable pool. Paid invoices cannot.

Coaches on the basic Coach tier see the Billing tab with a `PRO & CLUB` pill that routes to `/coach/paywall`, matching how other-coach plans are gated today.

## Behavior decisions worth naming

- **A session is never offered twice.** Every generated invoice line stores its date, so the next window starts after the last invoice's `period_end` and any date already on a line is excluded.
- **Late confirmations catch up.** Because windows are date ranges and lines are keyed by date, a lesson confirmed after its window closed simply appears in the next generation.
- **Amounts are frozen.** Lines snapshot the amount at generation. Changing a student's rate only affects future invoices.
- **The rate is per student**, so two students at different rates work with no extra setup.

## Technical notes

**Why lines are keyed by date, not session id.** The calendar stores recurring templates in `athlete_lesson_slots` (weekly / biweekly / twice-monthly / monthly, with `weeks_of_month`), not per-date rows. The only per-date records are `lesson_slot_overrides` (canceled / rescheduled) and `lesson_wrap_ups` (the coach's end-of-practice action). There is no session row to point at, so `invoice_lines` stores `(slot_id, occurrence_date)` — the same key the schedule and override tables already use.

**Migration** (Cloud, with GRANTs + RLS scoped to the owning coach, `updated_at` triggers):

- `coach_athlete_rates` — `coach_id`, `athlete_id`, `rate_kind` (`per_session` | `hourly`), `rate_cents`, unique on the pair.
- `invoices` — `coach_id`, `athlete_id`, `period_start`, `period_end`, `total_cents`, `status` (`unpaid` | `paid`), `paid_at`, `created_at`. Seam for later payments: status flips stay a single column a webhook can own.
- `invoice_lines` — `invoice_id`, `slot_id` (nullable), `occurrence_date`, `amount_cents`, `included_reason` (`completed` | `manual_add`), unique on `(invoice_id, occurrence_date, slot_id)`.

RLS: coach owns all three via `coach_profiles.user_id = auth.uid()`; no parent or athlete access in v1.

**Server functions** in a new `src/lib/invoicing.functions.ts`, all `requireSupabaseAuth`, tier-checked against `coach_effective_tier` server-side (the UI pill is not the gate):

- `getAthleteBilling` — rate, last invoice, invoice list for one athlete.
- `previewInvoice({ athleteId, periodStart?, periodEnd? })` — expands recurrence over the window, joins overrides and wrap-ups, excludes dates already invoiced, returns priced draft lines with `confirmed` / `scheduled` / `canceled` / `did_not_happen` state.
- `createInvoice` — persists header plus the lines the coach confirmed, recomputing amounts server-side from the submitted line set.
- `setInvoiceStatus`, `deleteInvoice` (unpaid only), `setAthleteRate`.
- `getCoachInvoices` — roster-wide list for the Billing tab.

Recurrence expansion currently lives inline in `WeekScheduleView`; this extracts it into a shared `src/lib/lesson-recurrence.ts` used by both the schedule view and the preview function, so the two can never disagree about which dates exist.

**UI**, all from the existing design system: `SegmentedToggle` for the roster tab, `Sheet` (bottom, `paper-surface`) for generation and rate entry, `Checkbox` + `Input` for lines, `Chip`/`Tag` for the Confirmed / Scheduled badges, `Button`, `AlertDialog` for delete, `Calendar` in a `Popover` for the start date, `press` / `press-soft` for feedback, `navigator.share` with a clipboard fallback as used in `share-to-socials-button.tsx`.

## Out of scope, as specified

No payment processing, PDFs, invoice numbers, due dates, reminders, partial payments, tax fields, or auto-send.
