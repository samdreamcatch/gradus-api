## Plan

No code or database changes. Just close out the security scan findings we discussed and document the reasoning so future scans don't keep re-flagging them.

### 1. Mark the 4 `SECURITY DEFINER` findings as accepted

The scanner flagged 4 instances of `SUPA_authenticated_security_definer_function_executable` — one each for:

- `activate_plan` — mutation; self-authorizes via `auth.uid()` check against `coach_profiles.user_id`. Definer is required to bypass RLS on the cross-row UPDATE that benches other active plans. Safe.
- `seed_coach_library` — mutation; self-authorizes via `auth.uid()` check against `coach_profiles.user_id`. Definer is required to insert into `moves` from `seed_moves`. Safe.
- `coach_has_rostered_athlete_of_parent` — read helper used inside RLS policies; uses `auth.uid()`. Definer is required so the policy itself can query across `athletes` / `coach_athletes` / `coach_profiles` without recursive RLS. Safe.
- `is_parent_of_athlete` — read helper used inside RLS policies; uses `auth.uid()`. Same pattern as above. Safe.

Each will be marked **ignored** with an explanation that names the authorization check and why definer is required.

`record_invite_lookup_attempt` is not in this scan's findings list (it doesn't trip the linter the same way), but it's covered in the memory update below as intentionally callable by `anon` and `authenticated` so a parent who already has an account can connect to a second coach via invite code.

### 2. Update `@security-memory`

Refresh the memory document so future scans and future agent sessions have the project's security posture in writing:

- App model: coach / parent / athlete roles. Coaches and parents are authenticated app users; athletes are profiles owned by parents.
- A parent can be connected to multiple coaches and can add new coach relationships **while already authenticated**, using an invite code. This is why `record_invite_lookup_attempt` is intentionally executable by both `anon` and `authenticated`.
- All 5 `SECURITY DEFINER` functions follow the "definer + self-authorize via `auth.uid()`" pattern (or, for `record_invite_lookup_attempt`, the "rate-limit primitive intentionally reachable by any caller" pattern). Future scans should not re-flag them unless the authorization check inside the function body is removed.
- Leaked-password protection is intentionally **off** per product decision.
- The two TanStack findings from this scan (`CLIENT_SIDE_AUTH_ONLY` on `_authenticated.tsx`, `BEARER_TOKEN_FROM_GETSESSION` on `auth-attacher.ts`) are **not** being closed out here — they're informational notes about defense-in-depth and we'll revisit them separately if you want.

### 3. Verification

After applying, I'll confirm the 4 definer findings are gone from the scan results and that the security memory reflects the new posture. No app behavior changes.
