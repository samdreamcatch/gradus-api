## Changes

### 1. Sanitize AI gateway error in `src/lib/coach-athlete-detail.functions.ts`
In `getCoachAthleteAiSummary`, the `catch` block currently re-throws the raw AI provider error message to the browser. Replace with:
- `console.error("[AI summary]", err)` — keeps full detail in server logs
- `throw new Error("Could not generate summary. Please try again later.")` — generic message to the client

### 2. Mark the `message_rooms` scanner finding as ignored
Using `security--manage_security_finding` with operation `ignore`, justification: "All writes to `message_rooms` go through `createServerFn` handlers using `supabaseAdmin` (service role) and are gated by `requireSupabaseAuth`. No client code touches the table directly; verified all 14 references live in `*.server.ts` / `*.functions.ts`. Missing client INSERT/UPDATE/DELETE policies are intentional — the Data API correctly denies any direct client write."

### 3. Update security memory
Add a short note via `security--update_memory` documenting:
- App access model: coach/athlete/parent roles with RLS on user-facing tables
- `message_rooms` is intentionally server-managed only (no client-side INSERT/UPDATE/DELETE policies needed)
- Server functions return generic error messages; raw provider errors stay in server logs

No new files, no migrations.
