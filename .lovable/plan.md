## Remove athlete phone collection & disconnect Twilio

### Migration
- `ALTER TABLE public.athletes DROP COLUMN phone;`
- `DROP TABLE public.athlete_otp_challenges;`

### Frontend copy
- `src/routes/_authenticated/parent.tsx` line 79: replace "only needed if your athlete has their own phone" with "only needed if your athlete will sign in to their own account".

### Twilio cleanup
- Delete `TWILIO_FROM_NUMBER` runtime secret.
- Disconnect the Twilio connector (removes `TWILIO_API_KEY` from this project).

### Verification
- Re-run security scan to confirm the "coaches can read athlete phone" finding is gone.
- Confirm no code still references `athletes.phone` or `athlete_otp_challenges` (already checked — only the parent.tsx copy and the auto-generated types file reference phone).
