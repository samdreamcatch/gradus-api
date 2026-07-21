## Reset Leon Gillespie's athlete invite

Leon's existing invite code `Z8TGQJF5` (parent: Mariah.Slone+1@gmail.com) has never been used but expired on 2026-07-07. Since the code was never claimed, the simplest reset is to extend its expiration another 30 days rather than rotate to a new code.

### Change
Run a single data update against `public.athlete_invite_codes` for `athlete_id = b4e3c8d9-50cd-4e64-b5de-94ccf116febd`:
- `expires_at = now() + interval '30 days'`
- `used_at = NULL` (defensive, already null)
- `claimed_at = NULL`, `claimed_by = NULL` (defensive)

### What you'll get back
- Code: `Z8TGQJF5`
- Invite link: `https://gradus.training/i/Z8TGQJF5`

This works in the live app immediately — no publish, no code changes.

### Alternative (only if you'd prefer a fresh code)
Delete the current row and let a new one regenerate on next parent-side view. Say the word and I'll do that instead.
