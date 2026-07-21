## Log 4 hours of sessions this week on George Henry's Spin Development plan

Insert 5 rows into `public.plan_sessions` for:
- plan_id: `266adc90-646c-43d3-a7b4-b04a1ea57655` (Spin Development, Coach Alyson)
- athlete_id: `41aa4fa5-3310-4a79-a517-4e8955c88f11` (George Henry)
- parent_id: `c80c4d7e-56cc-4c9b-83e9-f06dbd5e96db` (Sophia Slone) — parent-logged

Sessions across this week (Mon–Fri), totaling 240 minutes, with a natural mix of flow states and short notes:

| Day (this week) | Duration | State | Note |
|---|---|---|---|
| Mon | 45m | pushing (1) | Warm-up drills, worked on entry position |
| Tue | 60m | steady (2) | Consistent reps on the basic spin |
| Wed | 30m | frustrated (0) | Kept losing balance out of the spin |
| Thu | 50m | lockedIn (3) | Cleaner exits, felt sharper |
| Fri | 55m | flowing (4) | Best session yet — landed several clean |

Total: 240 minutes (4h).

### Technical
- Uses `supabase--insert` with `logged_at` set to specific timestamps within the current week (Mon–Fri, afternoon local-ish UTC).
- `state_index` matches `STATE_KEYS` order in `plan-sessions.functions.ts`.
- `parent_id` populated (marks as parent-logged per existing summary logic).

No code changes.