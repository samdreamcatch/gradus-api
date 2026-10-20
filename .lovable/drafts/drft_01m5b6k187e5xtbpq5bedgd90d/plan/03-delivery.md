## Technical details
- Stage additive per-club requirement storage and club-scoped acknowledgement identity under this draft’s migration folder. Preserve existing append-only sign-offs and versions; backfill associations without rewriting historical evidence.
- Update all acknowledgement paths together: resource listing, requirement changes, signer roster, pending tasks, document opening, signing, reminders, activity, pack membership and exports. Authorize club-admin operations through the existing server-side organization check; authorize member actions against their applicable requirement and membership.
- Keep deadline selection and readiness rules in pure, tested helpers. Share deadline results between the matrix and overview.
- Use a Worker-compatible PDF library and return a downloadable result from an authorized server function. Do not expose private storage addresses or another club’s records.

## Checks and delivery
Test club isolation, guardian attribution, version preservation and deadline rules with concrete cases. Run existing affected tests and lint; inspect automatic build results. Verify currently available flows as Buddy, including desktop and phone layouts.

**New requirement storage and pack-dependent functionality take effect when you accept the draft.** Those new paths cannot be tested against the live data before acceptance; report them as awaiting verification rather than presenting a simulated working result.

## Next milestone
After this policy slice, proceed to People: coach profiles with sports, levels and policy sign-off status, then credential evidence, expiry dates and reminders. Communications follows; Cases waits until safety-officer access and retention rules are settled. Template plans and the AI resource builder remain separate later content stages.
