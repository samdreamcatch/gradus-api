## Goal

Add weekly Friday lesson slots with Tami Taylor for:
- **Beverly Cleaver** — 11:00 AM (60 min)
- **Jamie Gilmore** — 12:00 PM (60 min)

## Context found

- Tami Taylor coach_id: `e82ce1b6-c2c3-4c66-8d31-7b6ccb3a25cd`
- Beverly athlete_id: `ccff0f5e-…f207bb` — already rostered with Tami ✅
- Jamie athlete_id: `5666dde4-…cebab21` — already rostered with Tami ✅
- `athlete_lesson_slots` stores times as local clock minutes (no TZ conversion in UI), so "11 AM MT" → `start_minute=660`, "12 PM MT" → `start_minute=720`. Day-of-week is 0=Sun…6=Sat, so **Friday = 5**.
- Neither athlete has an existing Friday slot with Tami, so no conflict.

## Data change

Insert two rows into `athlete_lesson_slots` (weekly, no `starts_on`, default `weeks_of_month`):

```text
(athlete=Beverly, coach=Tami, day_of_week=5, start=660, end=720, frequency='weekly')
(athlete=Jamie,   coach=Tami, day_of_week=5, start=720, end=780, frequency='weekly')
```

No schema, code, or RLS changes needed — this is a pure data seed via the insert tool. After insert, the coach roster's Schedule view will show both on Friday automatically.

## Assumptions to confirm

- Each lesson is **60 minutes** (matches existing slot durations like Jamie's Thursday 75-min outlier aside).
- Beverly at 11 AM, Jamie at 12 PM (back-to-back). If you wanted them swapped or both at the same time on different courts, say the word.